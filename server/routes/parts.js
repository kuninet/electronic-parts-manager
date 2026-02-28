const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');
const { resizeImageBuffer } = require('../utils/image');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Configure Multer for file uploads (memoryStorage for S3 support)
const storage = multer.memoryStorage();
const uploadMiddleware = multer({ storage: storage });
const upload = uploadMiddleware.fields([
    { name: 'image', maxCount: 1 },
    { name: 'datasheet', maxCount: 1 }
]);

const s3Images = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET;

// GET /api/parts - List parts with filters
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const { category_id, location_id, tag_id, search, status, sort, order } = req.query;
        let query = `
      SELECT p.*, c.name as category_name, l.name as location_name,
      (SELECT GROUP_CONCAT(t.name, ',') FROM tags t JOIN part_tags pt ON t.id = pt.tag_id WHERE pt.part_id = p.id) as tags
      FROM parts p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN locations l ON p.location_id = l.id
      WHERE 1=1
    `;
        const params = [];

        if (status === 'trash') {
            query += ` AND p.deleted_at IS NOT NULL`;
        } else {
            query += ` AND p.deleted_at IS NULL`;
        }

        if (category_id) {
            query += ` AND p.category_id = ?`;
            params.push(category_id);
        }

        if (location_id) {
            query += ` AND p.location_id = ?`;
            params.push(location_id);
        }

        if (tag_id) {
            query += ` AND EXISTS (SELECT 1 FROM part_tags pt WHERE pt.part_id = p.id AND pt.tag_id = ?)`;
            params.push(tag_id);
        }

        if (search) {
            query += ` AND (p.name LIKE ? OR p.description LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        // Sorting
        let sortColumn = 'p.id';
        let sortOrder = 'DESC';

        if (sort === 'name') sortColumn = 'p.name';
        else if (sort === 'category') sortColumn = 'category_name';
        else if (sort === 'location') sortColumn = 'location_name';
        else if (sort === 'created_at') sortColumn = 'p.created_at';
        else if (sort === 'quantity') sortColumn = 'p.quantity';

        if (order && order.toUpperCase() === 'ASC') sortOrder = 'ASC';

        query += ` ORDER BY ${sortColumn} ${sortOrder}`;

        const parts = await db.all(query, params);
        res.json(parts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/parts/:id - Get single part
router.get('/:id', async (req, res) => {
    try {
        const db = getDb();
        const part = await db.get(`
      SELECT p.*, c.name as category_name, l.name as location_name,
      (SELECT GROUP_CONCAT(t.name, ',') FROM tags t JOIN part_tags pt ON t.id = pt.tag_id WHERE pt.part_id = p.id) as tags
      FROM parts p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN locations l ON p.location_id = l.id
      WHERE p.id = ?
    `, [req.params.id]);

        if (!part) return res.status(404).json({ error: 'Part not found' });
        res.json(part);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts - Create part
router.post('/', upload, async (req, res) => {
    try {
        const db = getDb();
        const { name, description, category_id, location_id, quantity, datasheet_url } = req.body;
        const tags = req.body.tags ? req.body.tags.split(',').map(t => t.trim()).filter(t => t) : [];

        let image_path = null;
        if (req.files['image']) {
            const file = req.files['image'][0];
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
        let datasheet_path = null;
        if (req.files['datasheet']) {
            const dsFile = req.files['datasheet'][0];
            const dsFilename = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(dsFile.originalname);
            const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
            await fs.promises.writeFile(path.join(uploadsDir, dsFilename), dsFile.buffer);
            datasheet_path = '/uploads/' + dsFilename;
        }

        const result = await db.run(`
      INSERT INTO parts (name, description, category_id, location_id, quantity, image_path, datasheet_url, datasheet_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, description, category_id, location_id, quantity, image_path, datasheet_url, datasheet_path]);

        const partId = result.lastID;

        // Process Tags
        for (const tagName of tags) {
            let tag = await db.get('SELECT id FROM tags WHERE name = ?', [tagName]);
            if (!tag) {
                const tagResult = await db.run('INSERT INTO tags (name) VALUES (?)', [tagName]);
                tag = { id: tagResult.lastID };
            }
            await db.run('INSERT INTO part_tags (part_id, tag_id) VALUES (?, ?)', [partId, tag.id]);
        }

        res.status(201).json({ id: partId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/parts/:id - Update part
router.put('/:id', upload, async (req, res) => {
    try {
        const db = getDb();
        const { name, description, category_id, location_id, quantity, datasheet_url, qr_code } = req.body;
        const id = req.params.id; console.log("req.body:", req.body);

        const safeCategoryId = (category_id === '' || category_id === 'null' || category_id === undefined) ? null : category_id;
        const safeLocationId = (location_id === '' || location_id === 'null' || location_id === undefined) ? null : location_id;

        // QRコード重複チェック（自分自身は除外）
        const safeQrCode = (qr_code === '' || qr_code === 'null' || qr_code === undefined) ? null : qr_code;
        if (safeQrCode) {
            const dupPart = await db.get('SELECT id FROM parts WHERE qr_code = ? AND id != ? AND deleted_at IS NULL', [safeQrCode, id]);
            if (dupPart) return res.status(409).json({ error: 'このQRコードは別の部品に登録済みです' });
            const dupLoc = await db.get('SELECT id FROM locations WHERE qr_code = ?', [safeQrCode]);
            if (dupLoc) return res.status(409).json({ error: 'このQRコードは保管場所に登録済みです' });
        }

        let query = `UPDATE parts SET name = ?, description = ?, category_id = ?, location_id = ?, quantity = ?, datasheet_url = ?, qr_code = ?, updated_at = CURRENT_TIMESTAMP`;
        const params = [name, description, safeCategoryId, safeLocationId, quantity, datasheet_url, safeQrCode];

        // Fetch current file paths to delete old files if necessary
        const currentPart = await db.get('SELECT image_path, datasheet_path FROM parts WHERE id = ?', [id]);

        if (req.files['image']) {
            const file = req.files['image'][0];
            const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
            const resizedBuffer = await resizeImageBuffer(file.buffer);
            if (IMAGES_BUCKET) {
                await s3Images.send(new PutObjectCommand({
                    Bucket: IMAGES_BUCKET,
                    Key: 'uploads/' + filename,
                    Body: resizedBuffer,
                    ContentType: file.mimetype
                }));
                // Delete old image from S3
                if (currentPart && currentPart.image_path) {
                    const oldKey = currentPart.image_path.replace(/^\//, '');
                    await s3Images.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: oldKey })).catch(e => console.error('Failed to delete old image from S3:', e));
                }
            } else {
                const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
                await fs.promises.writeFile(path.join(uploadsDir, filename), resizedBuffer);
                if (currentPart && currentPart.image_path) {
                    const oldPath = path.join(__dirname, '../../', currentPart.image_path);
                    fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete old image:', err); });
                }
            }
            query += `, image_path = ?`;
            params.push('/uploads/' + filename);
        }

        if (req.files['datasheet']) {
            const dsFile = req.files['datasheet'][0];
            const dsFilename = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(dsFile.originalname);
            const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
            await fs.promises.writeFile(path.join(uploadsDir, dsFilename), dsFile.buffer);
            query += `, datasheet_path = ?`;
            params.push('/uploads/' + dsFilename);

            // Delete old datasheet
            if (currentPart && currentPart.datasheet_path) {
                const oldPath = path.join(__dirname, '../../', currentPart.datasheet_path);
                fs.unlink(oldPath, (err) => {
                    if (err) console.error('Failed to delete old datasheet:', err);
                });
            }
        }

        query += ` WHERE id = ?`;
        params.push(id);

        await db.run(query, params);

        // Update Tags
        if (req.body.tags !== undefined) {
            const tags = req.body.tags ? req.body.tags.split(',').map(t => t.trim()).filter(t => t) : [];

            // Clear existing tags
            await db.run('DELETE FROM part_tags WHERE part_id = ?', [id]);

            for (const tagName of tags) {
                let tag = await db.get('SELECT id FROM tags WHERE name = ?', [tagName]);
                if (!tag) {
                    const tagResult = await db.run('INSERT INTO tags (name) VALUES (?)', [tagName]);
                    tag = { id: tagResult.lastID };
                }
                await db.run('INSERT INTO part_tags (part_id, tag_id) VALUES (?, ?)', [id, tag.id]);
            }
        }

        res.json({ message: 'Updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/parts/:id - Soft Delete part
router.delete('/:id', async (req, res) => {
    try {
        const db = getDb();
        // ソフトデリート時にQRコードを解放（再利用可能にする）
        await db.run('UPDATE parts SET deleted_at = CURRENT_TIMESTAMP, qr_code = NULL WHERE id = ?', [req.params.id]);
        res.json({ message: 'Moved to trash' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/parts/:id/permanent - Permanent Delete
router.delete('/:id/permanent', async (req, res) => {
    try {
        const db = getDb();
        const id = req.params.id; console.log("req.body:", req.body);

        // Fetch current file paths to delete files
        const currentPart = await db.get('SELECT image_path, datasheet_path FROM parts WHERE id = ?', [id]);

        if (currentPart) {
            if (currentPart.image_path) {
                if (IMAGES_BUCKET) {
                    const key = currentPart.image_path.replace(/^\//, '');
                    s3Images.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: key })).catch(e => console.error('Failed to delete image from S3:', e));
                } else {
                    const oldPath = path.join(__dirname, '../../', currentPart.image_path);
                    fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete image:', err); });
                }
            }
            if (currentPart.datasheet_path) {
                const oldPath = path.join(__dirname, '../../', currentPart.datasheet_path);
                fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete datasheet:', err); });
            }
        }

        await db.run('DELETE FROM parts WHERE id = ?', [id]);
        res.json({ message: 'Permanently deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts/:id/restore - Restore part
router.post('/:id/restore', async (req, res) => {
    try {
        const db = getDb();
        await db.run('UPDATE parts SET deleted_at = NULL WHERE id = ?', [req.params.id]);
        res.json({ message: 'Restored successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts/bulk - Bulk actions
router.post('/bulk/action', async (req, res) => {
    try {
        const db = getDb();
        const { ids, action } = req.body; // action: 'trash', 'restore', 'delete'

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Invalid IDs' });
        }

        const placeholders = ids.map(() => '?').join(',');

        if (action === 'trash') {
            // ソフトデリート時にQRコードを解放（再利用可能にする）
            await db.run(`UPDATE parts SET deleted_at = CURRENT_TIMESTAMP, qr_code = NULL WHERE id IN (${placeholders})`, ids);
            res.json({ message: `Moved ${ids.length} items to trash` });
        } else if (action === 'restore') {
            await db.run(`UPDATE parts SET deleted_at = NULL WHERE id IN (${placeholders})`, ids);
            res.json({ message: `Restored ${ids.length} items` });
        } else if (action === 'delete') {
            // Permanent delete - need to handle file cleanup for each
            const parts = await db.all(`SELECT image_path, datasheet_path FROM parts WHERE id IN (${placeholders})`, ids);
            parts.forEach(part => {
                if (part.image_path) {
                    if (IMAGES_BUCKET) {
                        const key = part.image_path.replace(/^\//, '');
                        s3Images.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: key })).catch(() => {});
                    } else {
                        fs.unlink(path.join(__dirname, '../../', part.image_path), () => { });
                    }
                }
                if (part.datasheet_path) {
                    fs.unlink(path.join(__dirname, '../../', part.datasheet_path), () => { });
                }
            });
            await db.run(`DELETE FROM parts WHERE id IN (${placeholders})`, ids);
            res.json({ message: `Permanently deleted ${ids.length} items` });
        } else {
            res.status(400).json({ error: 'Invalid action' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts/bulk/update - Bulk update
router.post('/bulk/update', async (req, res) => {
    try {
        const db = getDb();
        const { ids, updates } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Invalid IDs' });
        }

        if (!updates) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        // 1. Update direct fields (Category, Location)
        const fieldsToUpdate = [];
        const params = [];

        if (Object.prototype.hasOwnProperty.call(updates, 'category_id')) {
            fieldsToUpdate.push('category_id = ?');
            // Handle null explicitly if passed, strictly checks for property existence
            const val = updates.category_id;
            const safeVal = (val === '' || val === 'null') ? null : val;
            params.push(safeVal);
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'location_id')) {
            fieldsToUpdate.push('location_id = ?');
            const val = updates.location_id;
            const safeVal = (val === '' || val === 'null') ? null : val;
            params.push(safeVal);
        }

        // Also update timestamp if any main field changes
        if (fieldsToUpdate.length > 0) {
            fieldsToUpdate.push('updated_at = CURRENT_TIMESTAMP');

            const placeholders = ids.map(() => '?').join(',');
            const sql = `UPDATE parts SET ${fieldsToUpdate.join(', ')} WHERE id IN (${placeholders})`;

            // params so far + ids
            await db.run(sql, [...params, ...ids]);
        }

        // 2. Handle Tags
        // Add Tags
        if (updates.add_tags && Array.isArray(updates.add_tags) && updates.add_tags.length > 0) {
            for (const tagName of updates.add_tags) {
                if (!tagName) continue;
                // Ensure tag exists
                let tag = await db.get('SELECT id FROM tags WHERE name = ?', [tagName]);
                if (!tag) {
                    const tagResult = await db.run('INSERT INTO tags (name) VALUES (?)', [tagName]);
                    tag = { id: tagResult.lastID };
                }

                // Add to all selected parts (ignore if exists)
                // Checking first is safer for bulk.
                for (const partId of ids) {
                    const exists = await db.get('SELECT 1 FROM part_tags WHERE part_id = ? AND tag_id = ?', [partId, tag.id]);
                    if (!exists) {
                        await db.run('INSERT INTO part_tags (part_id, tag_id) VALUES (?, ?)', [partId, tag.id]);
                    }
                }
            }
        }

        // Remove Tags
        if (updates.remove_tags && Array.isArray(updates.remove_tags) && updates.remove_tags.length > 0) {
            for (const tagName of updates.remove_tags) {
                if (!tagName) continue;
                const tag = await db.get('SELECT id FROM tags WHERE name = ?', [tagName]);
                if (tag) {
                    const placeholders = ids.map(() => '?').join(',');
                    await db.run(`DELETE FROM part_tags WHERE tag_id = ? AND part_id IN (${placeholders})`, [tag.id, ...ids]);
                }
            }
        }

        res.json({ message: `Updated ${ids.length} items` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/parts/:id/qr - 既存パーツにQRコード紐付け
router.put('/:id/qr', async (req, res) => {
    try {
        const db = getDb();
        const { qr_code } = req.body;
        const id = req.params.id; console.log("req.body:", req.body);

        // QRコード重複チェック
        const existing = await db.get('SELECT id FROM parts WHERE qr_code = ? AND id != ?', [qr_code, id]);
        if (existing) {
            return res.status(409).json({ error: 'このQRコードは別のパーツに登録済みです' });
        }

        await db.run('UPDATE parts SET qr_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [qr_code, id]);
        res.json({ message: 'QRコードを紐付けました' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
