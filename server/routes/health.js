const express = require('express');
const database = require('../database');

const router = express.Router();

// 更新スクリプト（scripts/update-and-restart.ps1）の起動確認用
router.get('/', async (req, res) => {
    try {
        await database.getDb().get('SELECT 1 AS ok');
        res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
    } catch (err) {
        console.error('Health check failed:', err.message);
        res.status(503).json({ status: 'error' });
    }
});

module.exports = router;
