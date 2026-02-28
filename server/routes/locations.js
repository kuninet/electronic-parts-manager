const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { resizeImageBuffer } = require('../utils/image');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer (memoryStorage for S3 support)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const s3Images = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET;

// GET /api/locations
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const locations = await db.all('SELECT * FROM locations ORDER BY display_order ASC');
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
        let image_path = null;
        if (req.file) {
            const file = req.file;
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

        const result = await db.run('INSERT INTO locations (name, description, image_path) VALUES (?, ?, ?)', [name, description, image_path]);
        res.status(201).json({ id: result.lastID, name, description, image_path });
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
router.delete('/:id', async (req, res) => {
    try {
        const db = getDb();

        // Check if used in parts
        const usage = await db.get('SELECT COUNT(*) as count FROM parts WHERE location_id = ?', [req.params.id]);
        if (usage.count > 0) {
            return res.status(400).json({ error: 'この保管場所は使用されているため削除できません' });
        }

        // Get image path first
        const loc = await db.get('SELECT image_path FROM locations WHERE id = ?', [req.params.id]);

        // Delete from DB first
        await db.run('DELETE FROM locations WHERE id = ?', [req.params.id]);

        // If DB delete successful, delete image
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

        res.json({ message: 'Location deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
