const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { getDb } = require('../database');

// 画像アップロード設定（プロジェクトルート/uploads に保存）
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '..', '..', 'uploads'));
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// QRコード重複チェック（locationsとparts横断）
const checkQrCodeDuplicate = async (db, qrCode, excludeType, excludeId) => {
    // locationsテーブルをチェック
    const locQuery = excludeType === 'location'
        ? 'SELECT id, name FROM locations WHERE qr_code = ? AND id != ?'
        : 'SELECT id, name FROM locations WHERE qr_code = ?';
    const locParams = excludeType === 'location' ? [qrCode, excludeId] : [qrCode];
    const existingLoc = await db.get(locQuery, locParams);
    if (existingLoc) {
        return { exists: true, type: 'location', name: existingLoc.name };
    }

    // partsテーブルをチェック
    const partQuery = excludeType === 'part'
        ? 'SELECT id, name FROM parts WHERE qr_code = ? AND id != ? AND deleted_at IS NULL'
        : 'SELECT id, name FROM parts WHERE qr_code = ? AND deleted_at IS NULL';
    const partParams = excludeType === 'part' ? [qrCode, excludeId] : [qrCode];
    const existingPart = await db.get(partQuery, partParams);
    if (existingPart) {
        return { exists: true, type: 'part', name: existingPart.name };
    }

    return { exists: false };
};

// GET /api/qr/lookup/:qrCode - QRコードで検索（保管場所 or パーツ）
router.get('/lookup/:qrCode', async (req, res) => {
    try {
        const db = getDb();
        const qrCode = req.params.qrCode;

        // 保管場所を検索
        const location = await db.get('SELECT * FROM locations WHERE qr_code = ?', [qrCode]);
        if (location) {
            // 保管場所に入っているパーツも取得
            const parts = await db.all(`
                SELECT p.id, p.name, p.description, p.image_path, p.qr_code, p.quantity,
                       c.name as category_name
                FROM parts p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.location_id = ? AND p.deleted_at IS NULL
                ORDER BY p.name ASC
            `, [location.id]);
            return res.json({ type: 'location', data: { ...location, parts } });
        }

        // パーツを検索
        const part = await db.get(`
            SELECT p.*, c.name as category_name, l.name as location_name,
                   l.qr_code as location_qr_code
            FROM parts p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN locations l ON p.location_id = l.id
            WHERE p.qr_code = ? AND p.deleted_at IS NULL
        `, [qrCode]);
        if (part) {
            return res.json({ type: 'part', data: part });
        }

        // 未登録
        res.json({ type: 'unknown', data: null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/qr/store - パーツを保管場所に紐付け＋ログ記録
router.post('/store', async (req, res) => {
    try {
        const db = getDb();
        const { part_id, location_id, memo } = req.body;

        if (!part_id || !location_id) {
            return res.status(400).json({ error: 'part_idとlocation_idは必須です' });
        }

        // パーツの保管場所を更新
        await db.run(
            'UPDATE parts SET location_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [location_id, part_id]
        );

        // 入庫ログ記録
        await db.run(
            'INSERT INTO storage_logs (part_id, location_id, memo) VALUES (?, ?, ?)',
            [part_id, location_id, memo || null]
        );

        res.json({ message: '保管場所にしまいました' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/qr/register-location - QRスキャン画面から保管場所を新規登録
router.post('/register-location', upload.single('image'), async (req, res) => {
    try {
        const db = getDb();
        const { qr_code, name, description } = req.body;
        const image_path = req.file ? '/uploads/' + req.file.filename : null;

        // QRコード重複チェック（locations + parts横断）
        const dup = await checkQrCodeDuplicate(db, qr_code, null, null);
        if (dup.exists) {
            const typeLabel = dup.type === 'location' ? '保管場所' : '部品';
            return res.status(409).json({ error: `このQRコードは${typeLabel}「${dup.name}」に既に登録されています` });
        }

        const result = await db.run(
            'INSERT INTO locations (name, description, qr_code, image_path) VALUES (?, ?, ?, ?)',
            [name, description || '', qr_code, image_path]
        );

        res.status(201).json({ id: result.lastID, qr_code, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/qr/register-part - QRスキャン画面から部品を新規登録
router.post('/register-part', upload.single('image'), async (req, res) => {
    try {
        const db = getDb();
        const { qr_code, name, description, quantity, category_id, location_id } = req.body;
        const image_path = req.file ? '/uploads/' + req.file.filename : null;

        // QRコード重複チェック（locations + parts横断）
        const dup = await checkQrCodeDuplicate(db, qr_code, null, null);
        if (dup.exists) {
            const typeLabel = dup.type === 'location' ? '保管場所' : '部品';
            return res.status(409).json({ error: `このQRコードは${typeLabel}「${dup.name}」に既に登録されています` });
        }

        const result = await db.run(
            'INSERT INTO parts (name, description, quantity, category_id, location_id, qr_code, image_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, description || '', quantity || 0, category_id || null, location_id || null, qr_code, image_path]
        );

        res.status(201).json({ id: result.lastID, qr_code, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/qr/assign-location/:id - 既存保管場所にQRコード紐付け
router.put('/assign-location/:id', async (req, res) => {
    try {
        const db = getDb();
        const { qr_code } = req.body;
        const id = req.params.id;

        // QRコード重複チェック
        const dup = await checkQrCodeDuplicate(db, qr_code, 'location', id);
        if (dup.exists) {
            const typeLabel = dup.type === 'location' ? '保管場所' : '部品';
            return res.status(409).json({ error: `このQRコードは${typeLabel}「${dup.name}」に既に登録されています` });
        }

        await db.run('UPDATE locations SET qr_code = ? WHERE id = ?', [qr_code, id]);
        res.json({ message: 'QRコードを紐付けました' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/qr/assign-part/:id - 既存パーツにQRコード紐付け
router.put('/assign-part/:id', async (req, res) => {
    try {
        const db = getDb();
        const { qr_code } = req.body;
        const id = req.params.id;

        // QRコード重複チェック
        const dup = await checkQrCodeDuplicate(db, qr_code, 'part', id);
        if (dup.exists) {
            const typeLabel = dup.type === 'location' ? '保管場所' : '部品';
            return res.status(409).json({ error: `このQRコードは${typeLabel}「${dup.name}」に既に登録されています` });
        }

        await db.run('UPDATE parts SET qr_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [qr_code, id]);
        res.json({ message: 'QRコードを紐付けました' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/qr/storage-logs - 入庫ログ検索
router.get('/storage-logs', async (req, res) => {
    try {
        const db = getDb();
        const { part_id, location_id, limit } = req.query;
        const maxLimit = parseInt(limit) || 50;

        let query = `
            SELECT sl.*, p.name as part_name, p.qr_code as part_qr_code,
                   l.name as location_name, l.qr_code as location_qr_code
            FROM storage_logs sl
            JOIN parts p ON sl.part_id = p.id
            JOIN locations l ON sl.location_id = l.id
            WHERE 1=1
        `;
        const params = [];

        if (part_id) {
            query += ' AND sl.part_id = ?';
            params.push(part_id);
        }
        if (location_id) {
            query += ' AND sl.location_id = ?';
            params.push(location_id);
        }

        query += ' ORDER BY sl.created_at DESC LIMIT ?';
        params.push(maxLimit);

        const logs = await db.all(query, params);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
