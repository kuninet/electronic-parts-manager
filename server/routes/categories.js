const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/categories
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const categories = await db.all('SELECT * FROM categories');
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/categories
router.post('/', async (req, res) => {
    try {
        const db = getDb();
        const { name } = req.body;
        const result = await db.run('INSERT INTO categories (name) VALUES (?)', [name]);
        res.status(201).json({ id: result.lastID, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const db = getDb();
        const { name } = req.body;
        await db.run('UPDATE categories SET name = ? WHERE id = ?', [name, req.params.id]);
        res.json({ message: 'Category updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/categories/:id
router.delete('/:id', async (req, res) => {
    try {
        const db = getDb();

        // Check if used in parts
        const id = parseInt(req.params.id);

        const usage = await db.get('SELECT COUNT(*) as count FROM parts WHERE category_id = ?', [id]);

        if (usage && usage.count > 0) {
            return res.status(400).json({ error: 'このカテゴリは使用されているため削除できません' });
        }

        await db.run('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
