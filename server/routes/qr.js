const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database');
const { normalizePartNumber } = require('../utils/partNumber');
const { resizeImageBuffer, validateImage } = require('../utils/image');

// 画像アップロード設定（メモリ上でリサイズしてから保存）
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});
const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

async function ensureValidImage(file) {
    const ext = path.extname(file.originalname).toLowerCase();

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
        return '許可されていない画像ファイル形式です (対応: JPG, PNG, GIF, WEBP)';
    }

    if (!(await validateImage(file.buffer))) {
        return '画像データが破損しているか、不正なファイルです';
    }

    return null;
}

async function saveUploadedImage(file) {
    const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const resizedBuffer = await resizeImageBuffer(file.buffer);

    await fs.promises.mkdir(uploadsDir, { recursive: true });
    await fs.promises.writeFile(path.join(uploadsDir, filename), resizedBuffer);

    return '/uploads/' + filename;
}

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
                SELECT p.id, p.name, p.part_number, p.description, p.image_path, p.qr_code, p.quantity,
                       c.name as category_name
                FROM parts p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.location_id = ? AND p.deleted_at IS NULL AND p.used_at IS NULL
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
            WHERE p.qr_code = ? AND p.deleted_at IS NULL AND p.used_at IS NULL
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

// 正の整数を検証するヘルパー関数
function parsePositiveInt(val) {
    if (val === null || val === undefined || val === '') return null;
    const n = Number(val);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
}

// POST /api/qr/store - パーツを保管場所に紐付け＋ログ記録
router.post('/store', async (req, res) => {
    try {
        const db = getDb();
        const { part_id, location_id, memo } = req.body;

        const parsedPartId = parsePositiveInt(part_id);
        const parsedLocationId = parsePositiveInt(location_id);

        if (!parsedPartId || !parsedLocationId) {
            return res.status(400).json({ error: 'part_idとlocation_idは正の整数で指定してください' });
        }

        // 部品を確認（ゴミ箱・使用済みは除外）
        const part = await db.get(
            `SELECT p.id, p.name, p.location_id, l.name AS location_name
             FROM parts p
             LEFT JOIN locations l ON p.location_id = l.id
             WHERE p.id = ? AND p.deleted_at IS NULL AND p.used_at IS NULL`,
            [parsedPartId]
        );
        if (!part) {
            return res.status(404).json({ error: '部品が見つかりません（ゴミ箱・使用済みを含む）' });
        }

        // 保管場所を確認
        const location = await db.get('SELECT id, name FROM locations WHERE id = ?', [parsedLocationId]);
        if (!location) {
            return res.status(404).json({ error: '保管場所が見つかりません' });
        }

        // すでにその保管場所にある場合は更新もログ追加もしない
        if (part.location_id === parsedLocationId) {
            return res.json({
                message: '既にこの保管場所にあります',
                log_id: null,
                part_id: parsedPartId,
                location_id: parsedLocationId,
                previous_location_id: part.location_id,
                previous_location_name: part.location_name || null,
                unchanged: true
            });
        }

        // node-sqlite3 は接続を共有するため、トランザクションはベストエフォート。
        await db.exec('BEGIN');
        let logId;
        try {
            await db.run(
                'UPDATE parts SET location_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [parsedLocationId, parsedPartId]
            );
            const logResult = await db.run(
                'INSERT INTO storage_logs (part_id, location_id, previous_location_id, memo) VALUES (?, ?, ?, ?)',
                [parsedPartId, parsedLocationId, part.location_id, memo || null]
            );
            logId = logResult.lastID;
            await db.exec('COMMIT');
        } catch (err) {
            await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
            throw err;
        }

        res.json({
            message: '保管場所にしまいました',
            log_id: logId,
            part_id: parsedPartId,
            location_id: parsedLocationId,
            previous_location_id: part.location_id,
            previous_location_name: part.location_name || null,
            unchanged: false
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/qr/store/undo - 保管場所への格納を取り消し（元の保管場所に戻す）
router.post('/store/undo', async (req, res) => {
    try {
        const db = getDb();
        const { log_id } = req.body;

        const parsedLogId = parsePositiveInt(log_id);
        if (!parsedLogId) {
            return res.status(400).json({ error: 'log_idは正の整数で指定してください' });
        }

        // ログを確認
        const log = await db.get('SELECT * FROM storage_logs WHERE id = ?', [parsedLogId]);
        if (!log) {
            return res.status(404).json({ error: 'この記録は既に取り消されたか、存在しません' });
        }

        // 部品を確認（ゴミ箱・使用済みも含めて id だけで取得）
        const part = await db.get('SELECT id, name, location_id, deleted_at FROM parts WHERE id = ?', [log.part_id]);
        if (!part) {
            return res.status(404).json({ error: '部品が見つかりません' });
        }

        // 部品の現在の location_id がログの location_id と異なれば 409
        if (part.location_id !== log.location_id) {
            return res.status(409).json({ error: 'この部品はその後ほかの保管場所に移されているため、戻せません' });
        }

        // M-1: 対象ログが該当部品の最新の入庫ログであるかを確認（A->B->C->Bなどの経路で古いログが誤適用されるのを防止）
        const latestLog = await db.get(
            'SELECT id FROM storage_logs WHERE part_id = ? ORDER BY id DESC LIMIT 1',
            [log.part_id]
        );
        if (latestLog && latestLog.id !== log.id) {
            return res.status(409).json({ error: 'この部品はその後さらに操作されているため、この記録からは戻せません' });
        }

        // 戻し先を決定（元の保管場所が存在するかチェック）
        let restoredLocationId = null;
        let restoredLocationName = null;
        let previousLocationMissing = false;

        if (log.previous_location_id) {
            const prevLoc = await db.get('SELECT id, name FROM locations WHERE id = ?', [log.previous_location_id]);
            if (prevLoc) {
                restoredLocationId = prevLoc.id;
                restoredLocationName = prevLoc.name;
                previousLocationMissing = false;
            } else {
                restoredLocationId = null;
                restoredLocationName = null;
                previousLocationMissing = true;
            }
        }

        // node-sqlite3 は接続を共有するため、トランザクションはベストエフォート。
        await db.exec('BEGIN');
        try {
            const updateRes = await db.run(
                'UPDATE parts SET location_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND location_id IS ?',
                [restoredLocationId, part.id, log.location_id]
            );
            if (updateRes.changes === 0) {
                await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
                return res.status(409).json({ error: 'この部品はその後ほかの保管場所に移されているため、戻せません' });
            }
            await db.run('DELETE FROM storage_logs WHERE id = ?', [parsedLogId]);
            await db.exec('COMMIT');
        } catch (err) {
            await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
            throw err;
        }

        res.json({
            message: '取り消しました',
            part_id: part.id,
            restored_location_id: restoredLocationId,
            restored_location_name: restoredLocationName,
            previous_location_missing: previousLocationMissing
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/qr/register-location - QRスキャン画面から保管場所を新規登録
router.post('/register-location', upload.single('image'), async (req, res) => {
    try {
        const db = getDb();
        const { qr_code, name, description } = req.body;
        if (req.file) {
            if (req.file.size > MAX_IMAGE_FILE_SIZE) {
                return res.status(413).json({ error: '画像ファイルサイズは20MB以下にしてください' });
            }
            const validationError = await ensureValidImage(req.file);
            if (validationError) return res.status(400).json({ error: validationError });
        }
        const image_path = req.file ? await saveUploadedImage(req.file) : null;

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
        const { qr_code, name, description, quantity, category_id, location_id, part_number } = req.body;

        const partNumberResult = normalizePartNumber(part_number);
        if (partNumberResult.error) {
            return res.status(400).json({ error: partNumberResult.error });
        }
        const safePartNumber = partNumberResult.value ?? null;

        // QRコード重複チェック（locations + parts横断）
        const dup = await checkQrCodeDuplicate(db, qr_code, null, null);
        if (dup.exists) {
            const typeLabel = dup.type === 'location' ? '保管場所' : '部品';
            return res.status(409).json({ error: `このQRコードは${typeLabel}「${dup.name}」に既に登録されています` });
        }

        if (req.file) {
            if (req.file.size > MAX_IMAGE_FILE_SIZE) {
                return res.status(413).json({ error: '画像ファイルサイズは20MB以下にしてください' });
            }
            const validationError = await ensureValidImage(req.file);
            if (validationError) return res.status(400).json({ error: validationError });
        }
        const image_path = req.file ? await saveUploadedImage(req.file) : null;

        const result = await db.run(
            'INSERT INTO parts (name, description, quantity, category_id, location_id, qr_code, image_path, part_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, description || '', quantity || 0, category_id || null, location_id || null, qr_code, image_path, safePartNumber]
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

const { multerErrorHandler } = require('../utils/multerErrorHandler');
router.use(multerErrorHandler);

module.exports = router;
