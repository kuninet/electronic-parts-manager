const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/tags - List all tags
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const tags = await db.all('SELECT * FROM tags ORDER BY name ASC');
        res.json(tags);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
