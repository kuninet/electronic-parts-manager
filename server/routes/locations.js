const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { resizeImageBuffer, validateImage } = require('../utils/image');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer (memoryStorage for S3 support)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const s3Images = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET;
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

// GET /api/locations
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const locations = await db.all(
            'SELECT * FROM locations ORDER BY display_order ASC, name COLLATE NOCASE ASC, id ASC'
        );
        res.json(locations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/locations
router.post('/', upload.single('image'), async (req, res) => {
    try {
        const db = getDb();
        const { name, description } = req.body;
        const { next_display_order } = await db.get(
            'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_display_order FROM locations'
        );
        let image_path = null;
        if (req.file) {
            const file = req.file;
            if (file.size > MAX_IMAGE_FILE_SIZE) {
                return res.status(413).json({ error: '画像ファイルサイズは20MB以下にしてください' });
            }
            const validationError = await ensureValidImage(file);
            if (validationError) return res.status(400).json({ error: validationError });
            const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
            const resizedBuffer = await resizeImageBuffer(file.buffer);
            if (IMAGES_BUCKET) {
                await s3Images.send(new PutObjectCommand({
                    Bucket: IMAGES_BUCKET,
                    Key: 'uploads/' + filename,
                    Body: resizedBuffer,
                    ContentType: file.mimetype
                }));
            } else {
                const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
                await fs.promises.writeFile(path.join(uploadsDir, filename), resizedBuffer);
            }
            image_path = '/uploads/' + filename;
        }

        const result = await db.run(
            'INSERT INTO locations (name, description, image_path, display_order) VALUES (?, ?, ?, ?)',
            [name, description, image_path, next_display_order]
        );
        res.status(201).json({ id: result.lastID, name, description, image_path, display_order: next_display_order });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/locations/:id
router.put('/:id', upload.single('image'), async (req, res) => {
    try {
        const db = getDb();
        const { name, description, qr_code } = req.body;
        const id = req.params.id;

        // QRコード重複チェック（自分自身は除外）
        if (qr_code) {
            const dupLoc = await db.get('SELECT id FROM locations WHERE qr_code = ? AND id != ?', [qr_code, id]);
            if (dupLoc) return res.status(409).json({ error: 'このQRコードは別の保管場所に登録済みです' });
            const dupPart = await db.get('SELECT id FROM parts WHERE qr_code = ? AND deleted_at IS NULL', [qr_code]);
            if (dupPart) return res.status(409).json({ error: 'このQRコードは部品に登録済みです' });
        }

        let query = 'UPDATE locations SET name = ?, description = ?, qr_code = ?';
        const params = [name, description || '', qr_code || null];

        if (req.file) {
            const file = req.file;
            if (file.size > MAX_IMAGE_FILE_SIZE) {
                return res.status(413).json({ error: '画像ファイルサイズは20MB以下にしてください' });
            }
            const validationError = await ensureValidImage(file);
            if (validationError) return res.status(400).json({ error: validationError });
            const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
            const resizedBuffer = await resizeImageBuffer(file.buffer);

            // Delete old image
            const oldLoc = await db.get('SELECT image_path FROM locations WHERE id = ?', [id]);

            if (IMAGES_BUCKET) {
                await s3Images.send(new PutObjectCommand({
                    Bucket: IMAGES_BUCKET,
                    Key: 'uploads/' + filename,
                    Body: resizedBuffer,
                    ContentType: file.mimetype
                }));
                if (oldLoc && oldLoc.image_path) {
                    const oldKey = oldLoc.image_path.replace(/^\//, '');
                    await s3Images.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: oldKey })).catch(e => console.error('Failed to delete old image from S3:', e));
                }
            } else {
                const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
                await fs.promises.writeFile(path.join(uploadsDir, filename), resizedBuffer);
                if (oldLoc && oldLoc.image_path) {
                    const oldPath = path.join(__dirname, '../../', oldLoc.image_path);
                    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                }
            }

            query += ', image_path = ?';
            params.push('/uploads/' + filename);
        }

        query += ' WHERE id = ?';
        params.push(id);

        await db.run(query, params);
        res.json({ message: 'Location updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/locations/:id
// ゴミ箱外（通常・使用済み）のパーツが無ければ削除できる。
// ゴミ箱内パーツの location_id は NULL に外し、この場所への入庫ログ（storage_logs）は削除する。
router.delete('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid ID' });
        }

        const db = getDb();

        const loc = await db.get('SELECT id, image_path FROM locations WHERE id = ?', [id]);
        if (!loc) {
            return res.status(404).json({ error: '保管場所が見つかりません' });
        }

        // ゴミ箱内のパーツは「使用中」と数えない
        const usage = await db.get('SELECT COUNT(*) as count FROM parts WHERE location_id = ? AND deleted_at IS NULL', [id]);
        if (usage.count > 0) {
            return res.status(400).json({ error: `この保管場所には ${usage.count} 件のパーツがあるため削除できません（使用済みを含む）` });
        }

        // parts.location_id / storage_logs.location_id は ON DELETE CASCADE ではないため、先に参照を外す。
        // node-sqlite3 は接続を共有するため、トランザクションはベストエフォート。
        let detachedTrashedParts = 0;
        let deletedLogs = 0;
        await db.exec('BEGIN');
        try {
            const detached = await db.run(
                'UPDATE parts SET location_id = NULL WHERE location_id = ? AND deleted_at IS NOT NULL',
                [id]
            );
            detachedTrashedParts = detached.changes;
            const logs = await db.run('DELETE FROM storage_logs WHERE location_id = ?', [id]);
            deletedLogs = logs.changes;
            await db.run('DELETE FROM locations WHERE id = ?', [id]);
            await db.exec('COMMIT');
        } catch (err) {
            await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
            throw err;
        }

        // DB の削除が確定してから画像を削除する
        if (loc && loc.image_path) {
            if (IMAGES_BUCKET) {
                const key = loc.image_path.replace(/^\//, '');
                s3Images.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: key })).catch(e => console.error('Failed to delete image from S3:', e));
            } else {
                const oldPath = path.join(__dirname, '../../', loc.image_path);
                if (fs.existsSync(oldPath)) {
                    try {
                        fs.unlinkSync(oldPath);
                    } catch (e) {
                        console.error('Failed to delete image file:', e);
                    }
                }
            }
        }

        res.json({ message: 'Location deleted', detachedTrashedParts, deletedLogs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const { multerErrorHandler } = require('../utils/multerErrorHandler');
router.use(multerErrorHandler);

module.exports = router;
