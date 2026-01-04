const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../../uploads'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// GET /api/locations
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const locations = await db.all('SELECT * FROM locations');
        res.json(locations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/locations
router.post('/', upload.single('image'), async (req, res) => {
    try {
        const db = getDb();
        const { name, description } = req.body;
        const image_path = req.file ? '/uploads/' + req.file.filename : null;

        const result = await db.run('INSERT INTO locations (name, description, image_path) VALUES (?, ?, ?)', [name, description, image_path]);
        res.status(201).json({ id: result.lastID, name, description, image_path });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/locations/:id
router.put('/:id', upload.single('image'), async (req, res) => {
    try {
        const db = getDb();
        const { name, description } = req.body;
        const id = req.params.id;

        let query = 'UPDATE locations SET name = ?, description = ?';
        const params = [name, description || ''];

        if (req.file) {
            query += ', image_path = ?';
            params.push('/uploads/' + req.file.filename);

            // Delete old image
            const oldLoc = await db.get('SELECT image_path FROM locations WHERE id = ?', [id]);
            if (oldLoc && oldLoc.image_path) {
                const oldPath = path.join(__dirname, '../../', oldLoc.image_path);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
        }

        query += ' WHERE id = ?';
        params.push(id);

        await db.run(query, params);
        res.json({ message: 'Location updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/locations/:id
router.delete('/:id', async (req, res) => {
    try {
        const db = getDb();

        // Check if used in parts
        const usage = await db.get('SELECT COUNT(*) as count FROM parts WHERE location_id = ?', [req.params.id]);
        if (usage.count > 0) {
            return res.status(400).json({ error: 'この保管場所は使用されているため削除できません' });
        }

        // Get image path first
        const loc = await db.get('SELECT image_path FROM locations WHERE id = ?', [req.params.id]);

        // Delete from DB first
        await db.run('DELETE FROM locations WHERE id = ?', [req.params.id]);

        // If DB delete successful, delete image
        if (loc && loc.image_path) {
            const oldPath = path.join(__dirname, '../../', loc.image_path);
            if (fs.existsSync(oldPath)) {
                try {
                    fs.unlinkSync(oldPath);
                } catch (e) {
                    console.error('Failed to delete image file:', e);
                    // Don't fail the request since DB delete was successful
                }
            }
        }

        res.json({ message: 'Location deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
