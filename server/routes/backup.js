const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { stringify } = require('csv-stringify/sync');
const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');
const multer = require('multer');
const upload = multer({ dest: 'tmp/' });
const fs = require('fs');

// GET /api/backup/export/csv
router.get('/export/csv', async (req, res) => {
    try {
        const db = getDb();
        const parts = await db.all('SELECT * FROM parts');
        const csv = stringify(parts, { header: true });

        res.header('Content-Type', 'text/csv');
        res.attachment('parts_backup.csv');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/backup/import/csv
router.post('/import/csv', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const fileContent = fs.readFileSync(req.file.path);
        const records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true
        });

        const db = getDb();

        // Transaction for restore
        await db.run('BEGIN TRANSACTION');

        // Optional: Truncate parts table if you want full restore
        // await db.run('DELETE FROM parts');

        const stmt = await db.prepare(`
      INSERT OR REPLACE INTO parts (id, name, description, category_id, location_id, quantity, image_path, datasheet_url, datasheet_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        for (const record of records) {
            await stmt.run(
                record.id, record.name, record.description, record.category_id,
                record.location_id, record.quantity, record.image_path,
                record.datasheet_url, record.datasheet_path, record.created_at, record.updated_at
            );
        }

        await stmt.finalize();
        await db.run('COMMIT');

        fs.unlinkSync(req.file.path); // Cleanup
        res.json({ message: `Imported ${records.length} records` });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        const db = getDb();
        await db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

// POST /api/backup/import/excel
router.post('/import/excel', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const records = xlsx.utils.sheet_to_json(sheet);

        const db = getDb();

        // NOTE: Excel import might not match schema perfectly. 
        // We assume columns: Name, Description, Quantity, Datasheet
        // We might need to resolve Category/Location names to IDs.

        await db.run('BEGIN TRANSACTION');

        const stmt = await db.prepare(`
        INSERT INTO parts (name, description, quantity, datasheet_url)
        VALUES (?, ?, ?, ?)
    `);

        for (const record of records) {
            // Mapping logic (adjust based on user's excel format)
            // Assuming keys: Name, Description, Quantity, URL
            const name = record['Name'] || record['name'] || 'Unknown';
            const description = record['Description'] || record['description'] || '';
            const quantity = record['Quantity'] || record['quantity'] || 0;
            const url = record['URL'] || record['url'] || '';

            await stmt.run(name, description, quantity, url);
        }

        await stmt.finalize();
        await db.run('COMMIT');

        fs.unlinkSync(req.file.path);
        res.json({ message: `Imported ${records.length} records from Excel` });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        const db = getDb();
        await db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
