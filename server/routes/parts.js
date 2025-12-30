const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../../uploads'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadMiddleware = multer({ storage: storage });

const upload = uploadMiddleware.fields([
    { name: 'image', maxCount: 1 },
    { name: 'datasheet', maxCount: 1 }
]);

// GET /api/parts - List parts with filters
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const { category_id, location_id, search } = req.query;
        let query = `
      SELECT p.*, c.name as category_name, l.name as location_name 
      FROM parts p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN locations l ON p.location_id = l.id
      WHERE 1=1
    `;
        const params = [];

        if (category_id) {
            query += ` AND p.category_id = ?`;
            params.push(category_id);
        }

        if (location_id) {
            query += ` AND p.location_id = ?`;
            params.push(location_id);
        }

        if (search) {
            query += ` AND (p.name LIKE ? OR p.description LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        query += ` ORDER BY p.id DESC`;

        const parts = await db.all(query, params);
        res.json(parts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/parts/:id - Get single part
router.get('/:id', async (req, res) => {
    try {
        const db = getDb();
        const part = await db.get(`
      SELECT p.*, c.name as category_name, l.name as location_name
      FROM parts p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN locations l ON p.location_id = l.id
      WHERE p.id = ?
    `, [req.params.id]);

        if (!part) return res.status(404).json({ error: 'Part not found' });
        res.json(part);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts - Create part
router.post('/', upload, async (req, res) => {
    try {
        const db = getDb();
        const { name, description, category_id, location_id, quantity, datasheet_url } = req.body;

        const image_path = req.files['image'] ? '/uploads/' + req.files['image'][0].filename : null;
        const datasheet_path = req.files['datasheet'] ? '/uploads/' + req.files['datasheet'][0].filename : null;

        const result = await db.run(`
      INSERT INTO parts (name, description, category_id, location_id, quantity, image_path, datasheet_url, datasheet_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, description, category_id, location_id, quantity, image_path, datasheet_url, datasheet_path]);

        res.status(201).json({ id: result.lastID });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/parts/:id - Update part
router.put('/:id', upload, async (req, res) => {
    try {
        const db = getDb();
        const { name, description, category_id, location_id, quantity, datasheet_url } = req.body;
        const id = req.params.id;

        let query = `UPDATE parts SET name = ?, description = ?, category_id = ?, location_id = ?, quantity = ?, datasheet_url = ?, updated_at = CURRENT_TIMESTAMP`;
        const params = [name, description, category_id, location_id, quantity, datasheet_url];

        // Fetch current file paths to delete old files if necessary
        const currentPart = await db.get('SELECT image_path, datasheet_path FROM parts WHERE id = ?', [id]);

        if (req.files['image']) {
            query += `, image_path = ?`;
            params.push('/uploads/' + req.files['image'][0].filename);

            // Delete old image
            if (currentPart && currentPart.image_path) {
                const oldPath = path.join(__dirname, '../../', currentPart.image_path);
                fs.unlink(oldPath, (err) => {
                    if (err) console.error('Failed to delete old image:', err);
                });
            }
        }

        if (req.files['datasheet']) {
            query += `, datasheet_path = ?`;
            params.push('/uploads/' + req.files['datasheet'][0].filename);

            // Delete old datasheet
            if (currentPart && currentPart.datasheet_path) {
                const oldPath = path.join(__dirname, '../../', currentPart.datasheet_path);
                fs.unlink(oldPath, (err) => {
                    if (err) console.error('Failed to delete old datasheet:', err);
                });
            }
        }

        query += ` WHERE id = ?`;
        params.push(id);

        await db.run(query, params);
        res.json({ message: 'Updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/parts/:id - Delete part
router.delete('/:id', async (req, res) => {
    try {
        const db = getDb();
        await db.run('DELETE FROM parts WHERE id = ?', [req.params.id]);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
