const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const multer = require('multer');
const upload = multer({ dest: 'tmp/' });
const fs = require('fs');
const path = require('path');

const archiver = require('archiver');
const admZip = require('adm-zip');
const { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { pipeline } = require('stream/promises');

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-northeast-1',
    requestChecksumCalculation: "when_required",
    responseChecksumValidation: "when_required"
});
const UPLOAD_BUCKET = process.env.S3_UPLOAD_BUCKET;

const s3Images = process.env.S3_IMAGES_BUCKET ? new S3Client({
    region: process.env.AWS_REGION || 'ap-northeast-1',
    requestChecksumCalculation: "when_required",
    responseChecksumValidation: "when_required"
}) : null;
const IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET;

// GET /api/backup/config
router.get('/config', (req, res) => {
    res.json({
        s3Enabled: !!UPLOAD_BUCKET,
        bucket: UPLOAD_BUCKET
    });
});

// GET /api/backup/export/full
router.get('/export/full', async (req, res) => {
    try {
        const db = getDb();
        const parts = await db.all(`
            SELECT p.*, 
            (SELECT GROUP_CONCAT(t.name, ',') FROM tags t JOIN part_tags pt ON t.id = pt.tag_id WHERE pt.part_id = p.id) as tags_list
            FROM parts p
        `);
        const categories = await db.all('SELECT * FROM categories');
        const locations = await db.all('SELECT * FROM locations');
        const tags = await db.all('SELECT * FROM tags');
        const partTags = await db.all('SELECT * FROM part_tags');

        const dbDump = { parts, categories, locations, tags, partTags };
        const archive = archiver('zip', { zlib: { level: 9 } });

        res.attachment(`full_backup_${new Date().toISOString().split('T')[0]}.zip`);
        archive.pipe(res);
        archive.append(JSON.stringify(dbDump, null, 2), { name: 'backup_data.json' });

        const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
        if (IMAGES_BUCKET) {
            const objects = await s3Images.send(new ListObjectsV2Command({ Bucket: IMAGES_BUCKET, Prefix: 'uploads/' }));
            if (objects.Contents && objects.Contents.length > 0) {
                for (const obj of objects.Contents) {
                    const data = await s3Images.send(new GetObjectCommand({ Bucket: IMAGES_BUCKET, Key: obj.Key }));
                    archive.append(data.Body, { name: obj.Key });
                }
            }
        } else {
            if (fs.existsSync(uploadsDir)) archive.directory(uploadsDir, 'uploads');
        }
        archive.finalize();
    } catch (err) {
        console.error('Full export failed', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

// POST /api/backup/import/full (Small files)
router.post('/import/full', upload.single('file'), async (req, res) => {
    let tempZipPath = null;
    const db = getDb();
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        tempZipPath = req.file.path;
        const zip = new admZip(tempZipPath);
        const zipEntries = zip.getEntries();
        const dataEntry = zipEntries.find(entry => entry.entryName === 'backup_data.json');
        if (!dataEntry) throw new Error('Invalid backup file: backup_data.json not found');
        const dbDump = JSON.parse(dataEntry.getData().toString('utf8'));

        await db.run('PRAGMA foreign_keys = OFF');
        await db.run('BEGIN TRANSACTION');
        await db.run('DELETE FROM storage_logs');
        await db.run('DELETE FROM part_tags');
        await db.run('DELETE FROM parts');
        await db.run('DELETE FROM categories');
        await db.run('DELETE FROM locations');
        await db.run('DELETE FROM tags');

        const restoreTable = async (table, rows) => {
            if (!rows || rows.length === 0) return;
            const tableInfo = await db.all(`PRAGMA table_info(${table})`);
            const validCols = tableInfo.map(c => c.name);
            const sourceCols = Object.keys(rows[0]);
            const intersectionCols = sourceCols.filter(c => validCols.includes(c));
            if (intersectionCols.length === 0) return;
            const placeholders = intersectionCols.map(() => '?').join(',');
            const sql = `INSERT INTO ${table} (${intersectionCols.join(',')}) VALUES (${placeholders})`;
            const stmt = await db.prepare(sql);
            for (const row of rows) {
                const values = intersectionCols.map(c => row[c]);
                await stmt.run(values);
            }
            await stmt.finalize();
        };

        if (dbDump.categories) await restoreTable('categories', dbDump.categories);
        if (dbDump.locations) await restoreTable('locations', dbDump.locations);
        if (dbDump.tags) await restoreTable('tags', dbDump.tags);
        if (dbDump.parts && dbDump.parts.length > 0) {
            const cleanParts = dbDump.parts.map(({ tags_list, category_name, location_name, ...rest }) => rest);
            await restoreTable('parts', cleanParts);
        }
        if (dbDump.partTags) await restoreTable('part_tags', dbDump.partTags);
        await db.run('COMMIT');

        const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
        const parentDir = path.join(uploadsDir, '../');
        zip.extractAllTo(parentDir, true);
        res.json({ message: 'Full restore successful' });
    } catch (err) {
        if (db) await db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        if (db) await db.run('PRAGMA foreign_keys = ON');
        if (tempZipPath && fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
    }
});

// GET /api/backup/import/presigned-url
router.get('/import/presigned-url', async (req, res) => {
    try {
        const bucket = UPLOAD_BUCKET;
        if (!bucket) return res.status(500).json({ error: 'S3_UPLOAD_BUCKET not set' });
        const fileName = req.query.fileName || `import_${Date.now()}.zip`;
        const key = `imports/${fileName}`;
        const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'application/zip' });
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        res.json({ url, key });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/backup/import/download (Step 1)
router.post('/import/download', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'S3 key is required' });
    const bucket = UPLOAD_BUCKET;
    if (!bucket) return res.status(500).json({ error: 'S3_UPLOAD_BUCKET not set' });

    const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const tempZipPath = IMAGES_BUCKET
        ? path.join(path.dirname(uploadsDir), 'tmp', 'import_temp.zip')
        : path.join(uploadsDir, 'import_temp.zip');

    try {
        const tempDir = path.dirname(tempZipPath);
        if (!fs.existsSync(tempDir)) {
            console.log(`Creating directory: ${tempDir}`);
            fs.mkdirSync(tempDir, { recursive: true });
        }
        console.log(`Downloading from S3: ${bucket}/${key} to ${tempZipPath}`);
        const command = new GetObjectCommand({ Bucket: bucket, Key: key });
        const response = await s3Client.send(command);
        await pipeline(response.Body, fs.createWriteStream(tempZipPath));
        res.json({ message: 'Download to EFS successful' });
    } catch (err) {
        console.error('S3 download failed', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/backup/import/restore (Step 2)
router.post('/import/restore', async (req, res) => {
    const { s3Key } = req.body;
    const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const tempZipPath = IMAGES_BUCKET
        ? path.join(path.dirname(uploadsDir), 'tmp', 'import_temp.zip')
        : path.join(uploadsDir, 'import_temp.zip');
    const db = getDb();

    if (!fs.existsSync(tempZipPath)) return res.status(404).json({ error: 'Temp file not found' });

    try {
        console.log('Starting restore from', tempZipPath);
        const zip = new admZip(tempZipPath);
        const zipEntries = zip.getEntries();
        const dataEntry = zipEntries.find(entry => entry.entryName === 'backup_data.json');
        if (!dataEntry) throw new Error('backup_data.json not found');
        const dbDump = JSON.parse(dataEntry.getData().toString('utf8'));

        await db.run('PRAGMA foreign_keys = OFF');
        await db.run('BEGIN TRANSACTION');
        await db.run('DELETE FROM storage_logs');
        await db.run('DELETE FROM part_tags');
        await db.run('DELETE FROM parts');
        await db.run('DELETE FROM categories');
        await db.run('DELETE FROM locations');
        await db.run('DELETE FROM tags');

        const restoreTable = async (table, rows) => {
            if (!rows || rows.length === 0) return;
            const tableInfo = await db.all(`PRAGMA table_info(${table})`);
            const validCols = tableInfo.map(c => c.name);
            const sourceCols = Object.keys(rows[0]);
            const intersectionCols = sourceCols.filter(c => validCols.includes(c));
            if (intersectionCols.length === 0) return;
            const placeholders = intersectionCols.map(() => '?').join(',');
            const sql = `INSERT INTO ${table} (${intersectionCols.join(',')}) VALUES (${placeholders})`;
            const stmt = await db.prepare(sql);
            for (const row of rows) {
                const values = intersectionCols.map(c => row[c]);
                await stmt.run(values);
            }
            await stmt.finalize();
        };

        if (dbDump.categories) await restoreTable('categories', dbDump.categories);
        if (dbDump.locations) await restoreTable('locations', dbDump.locations);
        if (dbDump.tags) await restoreTable('tags', dbDump.tags);
        if (dbDump.parts) {
            const cleanParts = dbDump.parts.map(({ tags_list, category_name, location_name, ...rest }) => rest);
            await restoreTable('parts', cleanParts);
        }
        if (dbDump.partTags) await restoreTable('part_tags', dbDump.partTags);
        await db.run('COMMIT');

        // Restore Upload Files
        if (IMAGES_BUCKET) {
            const tmpDir = `/tmp/restore_${Date.now()}`;
            fs.mkdirSync(tmpDir, { recursive: true });
            zip.extractAllTo(tmpDir, true);
            const extractedUploads = path.join(tmpDir, 'uploads');
            if (fs.existsSync(extractedUploads)) {
                for (const file of fs.readdirSync(extractedUploads)) {
                    const filePath = path.join(extractedUploads, file);
                    await s3Images.send(new PutObjectCommand({
                        Bucket: IMAGES_BUCKET,
                        Key: 'uploads/' + file,
                        Body: fs.readFileSync(filePath)
                    }));
                }
            }
            fs.rmSync(tmpDir, { recursive: true });
            console.log('S3 restore complete.');
        } else {
            const parentDir = path.join(uploadsDir, '../');
            console.log(`Extracting ZIP contents to parent directory: ${parentDir}`);
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            zip.extractAllTo(parentDir, true);
            console.log('Extraction complete.');
        }

        if (s3Key) {
            const delCmd = new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: s3Key });
            await s3Client.send(delCmd).catch(e => console.warn('S3 cleanup failed', e));
        }
        if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);

        res.json({ message: 'Restore successful' });
    } catch (err) {
        if (db) await db.run('ROLLBACK');
        console.error('Restore failed', err);
        res.status(500).json({ error: err.message });
    } finally {
        if (db) await db.run('PRAGMA foreign_keys = ON');
    }
});

// POST /api/backup/reset
router.post('/reset', async (req, res) => {
    const db = getDb();
    try {
        await db.run('PRAGMA foreign_keys = OFF');
        await db.run('BEGIN TRANSACTION');
        await db.run('DELETE FROM storage_logs');
        await db.run('DELETE FROM parts');
        await db.run('DELETE FROM part_tags');
        await db.run('COMMIT');

        const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
        if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir);
            for (const file of files) if (file !== '.gitkeep') fs.unlinkSync(path.join(uploadsDir, file));
        }
        res.json({ message: 'Reset successful' });
    } catch (err) {
        if (db) await db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        if (db) await db.run('PRAGMA foreign_keys = ON');
    }
});

module.exports = router;
