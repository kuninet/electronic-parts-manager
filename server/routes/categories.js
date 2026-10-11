const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/categories
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const categories = await db.all(
            'SELECT * FROM categories ORDER BY display_order ASC, name COLLATE NOCASE ASC, id ASC'
        );
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
        const { next_display_order } = await db.get(
            'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_display_order FROM categories'
        );
        const result = await db.run(
            'INSERT INTO categories (name, display_order) VALUES (?, ?)',
            [name, next_display_order]
        );
        res.status(201).json({ id: result.lastID, name, display_order: next_display_order });
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
// ゴミ箱外（通常・使用済み）のパーツが無ければ削除できる。ゴミ箱内パーツの category_id は NULL（未分類）に外す。
router.delete('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid ID' });
        }

        const db = getDb();

        const category = await db.get('SELECT id FROM categories WHERE id = ?', [id]);
        if (!category) {
            return res.status(404).json({ error: 'カテゴリが見つかりません' });
        }

        // ゴミ箱内のパーツは「使用中」と数えない
        const usage = await db.get('SELECT COUNT(*) as count FROM parts WHERE category_id = ? AND deleted_at IS NULL', [id]);
        if (usage.count > 0) {
            return res.status(400).json({ error: `このカテゴリには ${usage.count} 件のパーツがあるため削除できません（使用済みを含む）` });
        }

        // parts.category_id は ON DELETE CASCADE ではないため、先に参照を外す。
        // node-sqlite3 は接続を共有するため、トランザクションはベストエフォート。
        let detachedTrashedParts = 0;
        await db.exec('BEGIN');
        try {
            const detached = await db.run(
                'UPDATE parts SET category_id = NULL WHERE category_id = ? AND deleted_at IS NOT NULL',
                [id]
            );
            detachedTrashedParts = detached.changes;
            await db.run('DELETE FROM categories WHERE id = ?', [id]);
            await db.exec('COMMIT');
        } catch (err) {
            await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
            throw err;
        }

        res.json({ message: 'Category deleted', detachedTrashedParts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
