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
        const { category_id, location_id, tag_id, search, status } = req.query;
        let query = `
      SELECT p.*, c.name as category_name, l.name as location_name,
      (SELECT GROUP_CONCAT(t.name, ',') FROM tags t JOIN part_tags pt ON t.id = pt.tag_id WHERE pt.part_id = p.id) as tags
      FROM parts p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN locations l ON p.location_id = l.id
      WHERE 1=1
    `;
        const params = [];

        if (status === 'trash') {
            query += ` AND p.deleted_at IS NOT NULL`;
        } else {
            query += ` AND p.deleted_at IS NULL`;
        }

        if (category_id) {
            query += ` AND p.category_id = ?`;
            params.push(category_id);
        }

        if (location_id) {
            query += ` AND p.location_id = ?`;
            params.push(location_id);
        }

        if (tag_id) {
            query += ` AND EXISTS (SELECT 1 FROM part_tags pt WHERE pt.part_id = p.id AND pt.tag_id = ?)`;
            params.push(tag_id);
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
      SELECT p.*, c.name as category_name, l.name as location_name,
      (SELECT GROUP_CONCAT(t.name, ',') FROM tags t JOIN part_tags pt ON t.id = pt.tag_id WHERE pt.part_id = p.id) as tags
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
        const tags = req.body.tags ? req.body.tags.split(',').map(t => t.trim()).filter(t => t) : [];

        const image_path = req.files['image'] ? '/uploads/' + req.files['image'][0].filename : null;
        const datasheet_path = req.files['datasheet'] ? '/uploads/' + req.files['datasheet'][0].filename : null;

        const result = await db.run(`
      INSERT INTO parts (name, description, category_id, location_id, quantity, image_path, datasheet_url, datasheet_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, description, category_id, location_id, quantity, image_path, datasheet_url, datasheet_path]);

        const partId = result.lastID;

        // Process Tags
        for (const tagName of tags) {
            let tag = await db.get('SELECT id FROM tags WHERE name = ?', [tagName]);
            if (!tag) {
                const tagResult = await db.run('INSERT INTO tags (name) VALUES (?)', [tagName]);
                tag = { id: tagResult.lastID };
            }
            await db.run('INSERT INTO part_tags (part_id, tag_id) VALUES (?, ?)', [partId, tag.id]);
        }

        res.status(201).json({ id: partId });
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

        // Update Tags
        if (req.body.tags !== undefined) {
            const tags = req.body.tags ? req.body.tags.split(',').map(t => t.trim()).filter(t => t) : [];

            // Clear existing tags
            await db.run('DELETE FROM part_tags WHERE part_id = ?', [id]);

            for (const tagName of tags) {
                let tag = await db.get('SELECT id FROM tags WHERE name = ?', [tagName]);
                if (!tag) {
                    const tagResult = await db.run('INSERT INTO tags (name) VALUES (?)', [tagName]);
                    tag = { id: tagResult.lastID };
                }
                await db.run('INSERT INTO part_tags (part_id, tag_id) VALUES (?, ?)', [id, tag.id]);
            }
        }

        res.json({ message: 'Updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/parts/:id - Soft Delete part
router.delete('/:id', async (req, res) => {
    try {
        const db = getDb();
        await db.run('UPDATE parts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
        res.json({ message: 'Moved to trash' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/parts/:id/permanent - Permanent Delete
router.delete('/:id/permanent', async (req, res) => {
    try {
        const db = getDb();
        const id = req.params.id;

        // Fetch current file paths to delete files
        const currentPart = await db.get('SELECT image_path, datasheet_path FROM parts WHERE id = ?', [id]);

        if (currentPart) {
            if (currentPart.image_path) {
                const oldPath = path.join(__dirname, '../../', currentPart.image_path);
                fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete image:', err); });
            }
            if (currentPart.datasheet_path) {
                const oldPath = path.join(__dirname, '../../', currentPart.datasheet_path);
                fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete datasheet:', err); });
            }
        }

        await db.run('DELETE FROM parts WHERE id = ?', [id]);
        res.json({ message: 'Permanently deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts/:id/restore - Restore part
router.post('/:id/restore', async (req, res) => {
    try {
        const db = getDb();
        await db.run('UPDATE parts SET deleted_at = NULL WHERE id = ?', [req.params.id]);
        res.json({ message: 'Restored successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts/bulk - Bulk actions
router.post('/bulk/action', async (req, res) => {
    try {
        const db = getDb();
        const { ids, action } = req.body; // action: 'trash', 'restore', 'delete'

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Invalid IDs' });
        }

        const placeholders = ids.map(() => '?').join(',');

        if (action === 'trash') {
            await db.run(`UPDATE parts SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
            res.json({ message: `Moved ${ids.length} items to trash` });
        } else if (action === 'restore') {
            await db.run(`UPDATE parts SET deleted_at = NULL WHERE id IN (${placeholders})`, ids);
            res.json({ message: `Restored ${ids.length} items` });
        } else if (action === 'delete') {
            // Permanent delete - need to handle file cleanup for each
            const parts = await db.all(`SELECT image_path, datasheet_path FROM parts WHERE id IN (${placeholders})`, ids);
            parts.forEach(part => {
                if (part.image_path) {
                    fs.unlink(path.join(__dirname, '../../', part.image_path), () => { });
                }
                if (part.datasheet_path) {
                    fs.unlink(path.join(__dirname, '../../', part.datasheet_path), () => { });
                }
            });
            await db.run(`DELETE FROM parts WHERE id IN (${placeholders})`, ids);
            res.json({ message: `Permanently deleted ${ids.length} items` });
        } else {
            res.status(400).json({ error: 'Invalid action' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
