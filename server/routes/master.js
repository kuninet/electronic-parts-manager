const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// POST /api/master/reorder
// Body: { type: 'categories'|'locations'|'tags', ids: [1, 5, 2, 3] }
router.post('/reorder', async (req, res) => {
    try {
        const db = getDb();
        const { type, ids } = req.body;

        if (!['categories', 'locations', 'tags'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type' });
        }

        if (!Array.isArray(ids)) {
            return res.status(400).json({ error: 'Invalid IDs' });
        }

        // Use transaction to update all
        await db.run('BEGIN TRANSACTION');
        try {
            const stmt = await db.prepare(`UPDATE ${type} SET display_order = ? WHERE id = ?`);
            for (let i = 0; i < ids.length; i++) {
                await stmt.run([i, ids[i]]);
            }
            await stmt.finalize();
            await db.run('COMMIT');
            res.json({ message: 'Reordered' });
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
