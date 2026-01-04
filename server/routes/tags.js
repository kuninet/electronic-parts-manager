const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/tags - List all tags
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const tags = await db.all('SELECT * FROM tags ORDER BY display_order ASC');
        res.json(tags);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

// POST /api/tags - Add a new tag
router.post('/', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    try {
        const db = getDb();
        const result = await db.run('INSERT INTO tags (name) VALUES (?)', [name]);
        res.status(201).json({ id: result.lastID, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/tags/:id - Update a tag
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    try {
        const db = getDb();
        await db.run('UPDATE tags SET name = ? WHERE id = ?', [name, id]);
        res.json({ id, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/tags/:id - Delete a tag
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const db = getDb();
        await db.run('DELETE FROM tags WHERE id = ?', [id]);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
