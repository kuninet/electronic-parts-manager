const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const multer = require('multer');
const upload = multer({ dest: 'tmp/' });
const fs = require('fs');
const path = require('path');

const archiver = require('archiver');
const admZip = require('adm-zip');

// GET /api/backup/export/full
router.get('/export/full', async (req, res) => {
    try {
        const db = getDb();

        // 1. Fetch ALL data
        const parts = await db.all(`
            SELECT p.*, 
            (SELECT GROUP_CONCAT(t.name, ',') FROM tags t JOIN part_tags pt ON t.id = pt.tag_id WHERE pt.part_id = p.id) as tags_list
            FROM parts p
        `);
        const categories = await db.all('SELECT * FROM categories');
        const locations = await db.all('SELECT * FROM locations');
        const tags = await db.all('SELECT * FROM tags');
        const partTags = await db.all('SELECT * FROM part_tags');

        const dbDump = {
            parts,
            categories,
            locations,
            tags,
            partTags
        };

        // 2. Setup Archive
        const archive = archiver('zip', { zlib: { level: 9 } });

        res.attachment(`full_backup_${new Date().toISOString().split('T')[0]}.zip`);

        archive.pipe(res);

        // 3. Add DB Dump
        archive.append(JSON.stringify(dbDump, null, 2), { name: 'backup_data.json' });

        // 4. Add Uploads
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (fs.existsSync(uploadsDir)) {
            archive.directory(uploadsDir, 'uploads');
        }

        archive.finalize();

    } catch (err) {
        console.error('Full export failed', err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

// POST /api/backup/import/full POI
router.post('/import/full', upload.single('file'), async (req, res) => {
    let tempZipPath = null;
    const db = getDb();

    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        tempZipPath = req.file.path;

        const zip = new admZip(tempZipPath);
        const zipEntries = zip.getEntries();

        // 1. Validate structure
        const dataEntry = zipEntries.find(entry => entry.entryName === 'backup_data.json');
        if (!dataEntry) {
            throw new Error('Invalid backup file: backup_data.json not found');
        }

        // 2. Read DB Dump
        const dbDump = JSON.parse(dataEntry.getData().toString('utf8'));

        // Disable foreign key constraints temporarily for safe restore
        await db.run('PRAGMA foreign_keys = OFF');
        await db.run('BEGIN TRANSACTION');

        // 3. Clear existing data (FULL RESTORE)
        // Note: For full restore, we might want to clear master data too if it's in the dump.
        // The plan says "Truncate current tables".
        await db.run('DELETE FROM storage_logs');
        await db.run('DELETE FROM part_tags');
        await db.run('DELETE FROM parts');
        await db.run('DELETE FROM categories');
        await db.run('DELETE FROM locations');
        await db.run('DELETE FROM tags');

        // 4. Restore Master Data
        // Helper to insert with ID preservation
        const restoreTable = async (table, rows) => {
            if (!rows || rows.length === 0) return;
            const cols = Object.keys(rows[0]);
            const placeholders = cols.map(() => '?').join(',');
            const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`;
            const stmt = await db.prepare(sql);
            for (const row of rows) {
                await stmt.run(Object.values(row));
            }
            await stmt.finalize();
        };

        if (dbDump.categories) await restoreTable('categories', dbDump.categories);
        if (dbDump.locations) await restoreTable('locations', dbDump.locations);
        if (dbDump.tags) await restoreTable('tags', dbDump.tags);

        // 5. Restore Parts
        // Need to be careful: dbDump.parts might contain derived columns like 'tags' or 'category_name' if we used SELECT *.
        // The export query was: SELECT p.*, ... as tags_list.
        // We should select only actual columns for insertion.
        // Actually, restoreTable logic uses Object.keys(rows[0]). If export included extra columns, this will fail.
        // Export query: SELECT p.*, (SELECT ...) as tags_list FROM parts p
        // So parts rows HAVE 'tags_list'. We must remove it before inserting.

        if (dbDump.parts && dbDump.parts.length > 0) {
            const cleanParts = dbDump.parts.map(p => {
                const { tags_list, category_name, location_name, ...rest } = p; // Remove derived cols
                return rest;
            });
            await restoreTable('parts', cleanParts);
        }

        // 6. Restore PartTags
        if (dbDump.partTags) await restoreTable('part_tags', dbDump.partTags);

        await db.run('COMMIT');

        // 7. Restore Upload Files
        const uploadsDir = path.join(__dirname, '../../uploads');
        // We can use zip.extractAllTo
        // But we need to extract ONLY the 'uploads/' folder from zip to the uploadsDir.
        // adm-zip extracts preserving paths. If zip has 'uploads/file.jpg', extracting to ../../ will put it in ../../uploads/file.jpg.
        // That matches our structure!
        // First, optional: clear existing uploads?
        // Plan said: "restore to server's upload directory (overwrite)".
        // Let's unzip to the parent of uploadsDir to match the structure 'uploads/...'
        const parentDir = path.join(__dirname, '../../');
        zip.extractAllTo(parentDir, true); // true = overwrite

        res.json({ message: 'Full restore successful' });

    } catch (err) {
        await db.run('ROLLBACK');
        console.error('Full restore failed', err);
        res.status(500).json({ error: err.message });
    } finally {
        // Always re-enable foreign keys
        await db.run('PRAGMA foreign_keys = ON');
        if (tempZipPath && fs.existsSync(tempZipPath)) {
            fs.unlinkSync(tempZipPath);
        }
    }
});


// POST /api/backup/reset - Delete ALL data (Danger!)
router.post('/reset', async (req, res) => {
    const db = getDb();
    try {
        await db.run('PRAGMA foreign_keys = OFF');
        await db.run('BEGIN TRANSACTION');

        // Delete all parts and links
        await db.run('DELETE FROM storage_logs');
        await db.run('DELETE FROM parts');
        await db.run('DELETE FROM part_tags');
        // Note: Keeping categories, locations, and tags master data for now as requested.

        await db.run('COMMIT');

        // Clean uploads directory
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir);
            for (const file of files) {
                if (file !== '.gitkeep') {
                    fs.unlinkSync(path.join(uploadsDir, file));
                }
            }
        }

        res.json({ message: 'All parts data and files have been deleted.' });
    } catch (err) {
        await db.run('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        await db.run('PRAGMA foreign_keys = ON');
    }
});

module.exports = router;
