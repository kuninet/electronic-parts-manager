const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

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
router.post('/', async (req, res) => {
    try {
        const db = getDb();
        const { name, description } = req.body;
        const result = await db.run('INSERT INTO locations (name, description) VALUES (?, ?)', [name, description]);
        res.status(201).json({ id: result.lastID, name, description });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.put('/:id', async (req, res) => {
    try {
        const db = getDb();
        const { name, description } = req.body;
        // Allows updating name or description or both
        await db.run('UPDATE locations SET name = ?, description = ? WHERE id = ?', [name, description || '', req.params.id]);
        res.json({ message: 'Location updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/locations/:id
router.delete('/:id', async (req, res) => {
    try {
        const db = getDb();
        await db.run('DELETE FROM locations WHERE id = ?', [req.params.id]);
        res.json({ message: 'Location deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
