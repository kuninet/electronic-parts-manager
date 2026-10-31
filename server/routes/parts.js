const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');
const { normalizePartNumber } = require('../utils/partNumber');
const { normalizeShop, normalizePurchasedAt, normalizeUnitPrice, normalizePurchaseInfo } = require('../utils/purchaseInfo');
const { resizeImageBuffer, validateImage } = require('../utils/image');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Configure Multer for file uploads (memoryStorage for S3 support)
const storage = multer.memoryStorage();
const uploadMiddleware = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});
const upload = uploadMiddleware.fields([
    { name: 'image', maxCount: 1 },
    { name: 'datasheet', maxCount: 1 }
]);

const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const s3Images = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET;

// 一括操作で受け付ける ID の上限（client/src/constants.js の BULK_MAX_IDS と一致させること）
const BULK_MAX_IDS = 500;

const placeholders = (n) => Array(n).fill('?').join(',');

// 正の整数に変換し、重複を除いて返す。不正なら null
function normalizeIds(raw) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > BULK_MAX_IDS) return null;
    const out = new Set();
    for (const v of raw) {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) return null;
        out.add(n);
    }
    return [...out];
}

// パスパラメータの ID を検証する。不正なら null
function parseId(raw) {
    const ids = normalizeIds([raw]);
    return ids ? ids[0] : null;
}

// タグ名の配列またはカンマ区切り文字列を、trim・空除去・重複除去した配列にする
function normalizeTagNames(raw) {
    let list = [];
    if (Array.isArray(raw)) {
        list = raw.map(t => String(t).trim());
    } else if (typeof raw === 'string') {
        list = raw.split(',').map(t => t.trim());
    }
    return [...new Set(list.filter(Boolean))];
}

// 画像・データシートのファイルを削除する（完了を待たない。失敗はログのみ）
function removePartFiles(parts) {
    for (const part of parts) {
        if (part.image_path) {
            if (IMAGES_BUCKET) {
                const key = part.image_path.replace(/^\//, '');
                s3Images.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: key }))
                    .catch(e => console.error('Failed to delete image from S3:', e));
            } else {
                fs.unlink(path.join(__dirname, '../../', part.image_path), (err) => {
                    if (err) console.error('Failed to delete image:', err);
                });
            }
        }
        if (part.datasheet_path) {
            fs.unlink(path.join(__dirname, '../../', part.datasheet_path), (err) => {
                if (err) console.error('Failed to delete datasheet:', err);
            });
        }
    }
}

// ゴミ箱内のパーツを完全削除する。
// DB の削除が確定してからファイルを消す（外部キー違反などで DB 削除が失敗したときにファイルだけ消えるのを防ぐ）。
// node-sqlite3 は接続を共有するため、トランザクションはベストエフォート。安全性は処理順序で担保する。
async function permanentlyDeleteParts(db, ids) {
    const targets = await db.all(
        `SELECT id, image_path, datasheet_path FROM parts WHERE id IN (${placeholders(ids.length)}) AND deleted_at IS NOT NULL`,
        ids
    );
    if (targets.length === 0) return { affected: 0 };

    const targetIds = targets.map(t => t.id);
    const ph = placeholders(targetIds.length);
    let affected = 0;

    await db.exec('BEGIN');
    try {
        // storage_logs.part_id は ON DELETE CASCADE ではないため明示的に削除する
        await db.run(`DELETE FROM storage_logs WHERE part_id IN (${ph})`, targetIds);
        // purchase_records.part_id には外部キーがないため、購入履歴は残してひも付けだけ外す
        await db.run(
            `UPDATE purchase_records SET part_id = NULL, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE part_id IN (${ph})`,
            targetIds
        );
        // part_tags / ai_name_suggestions は ON DELETE CASCADE で削除される
        const result = await db.run(`DELETE FROM parts WHERE id IN (${ph}) AND deleted_at IS NOT NULL`, targetIds);
        affected = result.changes;
        await db.exec('COMMIT');
    } catch (err) {
        await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
        throw err;
    }

    removePartFiles(targets);
    return { affected };
}

// GET /api/parts - List parts with filters
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const { category_id, location_id, tag_id, search, status, sort, order, used_for, shop } = req.query;
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
        } else if (status === 'used') {
            query += ` AND p.deleted_at IS NULL AND p.used_at IS NOT NULL`;
        } else {
            query += ` AND p.deleted_at IS NULL AND p.used_at IS NULL`;
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
            query += ` AND (p.name LIKE ? OR p.description LIKE ? OR p.part_number LIKE ? OR p.shop LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (shop) {
            query += ` AND p.shop LIKE ?`;
            params.push(`%${shop}%`);
        }

        if (used_for) {
            query += ` AND p.used_for LIKE ?`;
            params.push(`%${used_for}%`);
        }

        // Sorting
        let sortColumn = 'p.id';
        let sortOrder = 'DESC';

        if (sort === 'name') sortColumn = 'p.name';
        else if (sort === 'category') sortColumn = 'category_name';
        else if (sort === 'location') sortColumn = 'location_name';
        else if (sort === 'created_at') sortColumn = 'p.created_at';
        else if (sort === 'quantity') sortColumn = 'p.quantity';
        else if (sort === 'used_for') sortColumn = 'p.used_for';
        else if (sort === 'used_at') sortColumn = 'p.used_at';

        if (order && order.toUpperCase() === 'ASC') sortOrder = 'ASC';

        if (sort === 'part_number') {
            query += ` ORDER BY (p.part_number IS NULL OR p.part_number = ''), p.part_number ${sortOrder}`;
        } else {
            query += ` ORDER BY ${sortColumn} ${sortOrder}`;
        }

        const parts = await db.all(query, params);
        res.json(parts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/parts/shops - 購入先の候補一覧（件数順）。/:id より前に定義すること
router.get('/shops', async (req, res) => {
    try {
        const db = getDb();
        const rows = await db.all(`
            SELECT shop AS name, COUNT(*) AS count FROM parts
            WHERE shop IS NOT NULL AND shop != '' AND deleted_at IS NULL
            GROUP BY shop ORDER BY count DESC, shop ASC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const LOW_STOCK_THRESHOLD = 5;
// GET /api/parts/stats - サイドバー用の件数
router.get('/stats', async (req, res) => {
    try {
        const db = getDb();
        const row = await db.get(`
      SELECT
        SUM(CASE WHEN deleted_at IS NULL AND used_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN deleted_at IS NULL AND used_at IS NOT NULL THEN 1 ELSE 0 END) AS used,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS trash,
        SUM(CASE WHEN deleted_at IS NULL AND used_at IS NULL AND quantity = 0 THEN 1 ELSE 0 END) AS out_of_stock,
        SUM(CASE WHEN deleted_at IS NULL AND used_at IS NULL AND quantity > 0 AND quantity < ? THEN 1 ELSE 0 END) AS low_stock
      FROM parts`, [LOW_STOCK_THRESHOLD]);
        const categories = await db.all(`
      SELECT c.id, c.name, COUNT(p.id) AS count
      FROM categories c
      LEFT JOIN parts p ON p.category_id = c.id AND p.deleted_at IS NULL AND p.used_at IS NULL
      GROUP BY c.id ORDER BY c.display_order, c.id`);
        const uncategorized = await db.get(`SELECT COUNT(*) AS count FROM parts WHERE category_id IS NULL AND deleted_at IS NULL AND used_at IS NULL`);
        const locations = await db.get('SELECT COUNT(*) AS count FROM locations');
        const ai = await db.get(`SELECT COUNT(*) AS count FROM ai_name_suggestions s JOIN parts p ON s.part_id = p.id WHERE s.status = 'pending' AND p.deleted_at IS NULL`);
        res.json({
            active: row.active || 0, used: row.used || 0, trash: row.trash || 0,
            lowStock: row.low_stock || 0, outOfStock: row.out_of_stock || 0,
            locations: locations.count, aiPending: ai.count,
            categories, uncategorized: uncategorized.count,
            lowStockThreshold: LOW_STOCK_THRESHOLD
        });
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
        const { description, datasheet_url } = req.body;

        // name の検証
        const rawName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        if (!rawName) {
            return res.status(400).json({ error: '部品名は必須です' });
        }
        if (rawName.length > 200) {
            return res.status(400).json({ error: '部品名は200文字以内で入力してください' });
        }
        const safeName = rawName;

        // quantity の検証（未指定または空文字は 0）
        let safeQuantity = 0;
        if (req.body.quantity !== undefined && req.body.quantity !== null && req.body.quantity !== '') {
            const qNum = Number(req.body.quantity);
            if (!Number.isInteger(qNum) || qNum < 0) {
                return res.status(400).json({ error: '数量は0以上の整数で指定してください' });
            }
            safeQuantity = qNum;
        }

        // category_id の検証と存在確認
        let category_id = (req.body.category_id === '' || req.body.category_id === 'null' || req.body.category_id === undefined || req.body.category_id === null) ? null : req.body.category_id;
        if (category_id !== null) {
            const cid = Number(category_id);
            if (!Number.isInteger(cid) || cid <= 0) {
                return res.status(400).json({ error: '無効なカテゴリIDです' });
            }
            const cat = await db.get('SELECT 1 FROM categories WHERE id = ?', [cid]);
            if (!cat) {
                return res.status(400).json({ error: '指定されたカテゴリが存在しません' });
            }
            category_id = cid;
        }

        // location_id の検証と存在確認
        let location_id = (req.body.location_id === '' || req.body.location_id === 'null' || req.body.location_id === undefined || req.body.location_id === null) ? null : req.body.location_id;
        if (location_id !== null) {
            const lid = Number(location_id);
            if (!Number.isInteger(lid) || lid <= 0) {
                return res.status(400).json({ error: '無効な保管場所IDです' });
            }
            const loc = await db.get('SELECT 1 FROM locations WHERE id = ?', [lid]);
            if (!loc) {
                return res.status(400).json({ error: '指定された保管場所が存在しません' });
            }
            location_id = lid;
        }

        // tags の処理（配列またはカンマ区切り文字列）
        const tags = normalizeTagNames(req.body.tags);

        const partNumberResult = normalizePartNumber(req.body.part_number);
        if (partNumberResult.error) {
            return res.status(400).json({ error: partNumberResult.error });
        }
        const safePartNumber = partNumberResult.value ?? null;

        const purchaseResult = normalizePurchaseInfo(req.body);
        if (purchaseResult.error) {
            return res.status(400).json({ error: purchaseResult.error });
        }
        const { shop: safeShop, purchased_at: safePurchasedAt, unit_price: safeUnitPrice } = purchaseResult.values;

        let image_path = null;
        if (req.files?.image) {
            const file = req.files.image[0];
            if (file.size > MAX_IMAGE_FILE_SIZE) {
                return res.status(413).json({ error: '画像ファイルサイズは20MB以下にしてください' });
            }
            const ext = path.extname(file.originalname).toLowerCase();
            const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

            if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
                return res.status(400).json({ error: '許可されていない画像ファイル形式です (対応: JPG, PNG, GIF, WEBP)' });
            }

            if (!(await validateImage(file.buffer))) {
                return res.status(400).json({ error: '画像データが破損しているか、不正なファイルです' });
            }

            const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
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
        if (req.files?.datasheet) {
            const dsFile = req.files.datasheet[0];
            const dsFilename = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(dsFile.originalname);
            const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
            await fs.promises.writeFile(path.join(uploadsDir, dsFilename), dsFile.buffer);
            datasheet_path = '/uploads/' + dsFilename;
        }

        const result = await db.run(`
      INSERT INTO parts (name, description, category_id, location_id, quantity, image_path, datasheet_url, datasheet_path, part_number, shop, purchased_at, unit_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [safeName, description ?? null, category_id, location_id, safeQuantity, image_path, datasheet_url ?? null, datasheet_path, safePartNumber, safeShop ?? null, safePurchasedAt ?? null, safeUnitPrice ?? null]);

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
        const { name, description, category_id, location_id, quantity, datasheet_url, qr_code, used_at, used_for, used_note } = req.body;
        const id = req.params.id;

        const safeCategoryId = (category_id === '' || category_id === 'null' || category_id === undefined) ? null : category_id;
        const safeUsedAt = (used_at === '' || used_at === 'null' || used_at === undefined) ? null : used_at;
        const safeUsedFor = (used_for === '' || used_for === 'null' || used_for === undefined) ? null : used_for;
        const safeUsedNote = (used_note === '' || used_note === 'null' || used_note === undefined) ? null : used_note;
        const safeLocationId = safeUsedAt
            ? null
            : (location_id === '' || location_id === 'null' || location_id === undefined) ? null : location_id;

        // QRコード重複チェック（自分自身は除外）
        const safeQrCode = (qr_code === '' || qr_code === 'null' || qr_code === undefined) ? null : qr_code;
        if (safeQrCode) {
            const dupPart = await db.get('SELECT id FROM parts WHERE qr_code = ? AND id != ? AND deleted_at IS NULL', [safeQrCode, id]);
            if (dupPart) return res.status(409).json({ error: 'このQRコードは別の部品に登録済みです' });
            const dupLoc = await db.get('SELECT id FROM locations WHERE qr_code = ?', [safeQrCode]);
            if (dupLoc) return res.status(409).json({ error: 'このQRコードは保管場所に登録済みです' });
        }

        const partNumberResult = normalizePartNumber(req.body.part_number);
        if (partNumberResult.error) {
            return res.status(400).json({ error: partNumberResult.error });
        }

        const purchaseResult = normalizePurchaseInfo(req.body);
        if (purchaseResult.error) {
            return res.status(400).json({ error: purchaseResult.error });
        }

        let query = `UPDATE parts SET name = ?, description = ?, category_id = ?, location_id = ?, quantity = ?, datasheet_url = ?, qr_code = ?, used_at = ?, used_for = ?, used_note = ?, updated_at = CURRENT_TIMESTAMP`;
        const params = [name, description, safeCategoryId, safeLocationId, quantity, datasheet_url, safeQrCode, safeUsedAt, safeUsedFor, safeUsedNote];

        if (partNumberResult.value !== undefined) {
            query += `, part_number = ?`;
            params.push(partNumberResult.value);
        }

        // 購入情報は未送信（undefined）の項目を更新しない
        for (const field of ['shop', 'purchased_at', 'unit_price']) {
            if (purchaseResult.values[field] !== undefined) {
                query += `, ${field} = ?`;
                params.push(purchaseResult.values[field]);
            }
        }

        // Fetch current file paths to delete old files if necessary
        const currentPart = await db.get('SELECT image_path, datasheet_path FROM parts WHERE id = ?', [id]);

        if (req.files['image']) {
            const file = req.files['image'][0];
            if (file.size > MAX_IMAGE_FILE_SIZE) {
                return res.status(413).json({ error: '画像ファイルサイズは20MB以下にしてください' });
            }
            const ext = path.extname(file.originalname).toLowerCase();
            const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

            if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
                return res.status(400).json({ error: '許可されていない画像ファイル形式です (対応: JPG, PNG, GIF, WEBP)' });
            }

            if (!(await validateImage(file.buffer))) {
                return res.status(400).json({ error: '画像データが破損しているか、不正なファイルです' });
            }

            const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
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
            const tags = normalizeTagNames(req.body.tags);

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

// PATCH /api/parts/:id - Partial update (updates only provided fields)
router.patch('/:id', async (req, res) => {
    try {
        const db = getDb();
        const id = req.params.id;
        const currentPart = await db.get('SELECT * FROM parts WHERE id = ? AND deleted_at IS NULL', [id]);
        if (!currentPart) {
            return res.status(404).json({ error: 'Part not found' });
        }

        const allowedFields = [
            'name', 'description', 'category_id', 'location_id',
            'quantity', 'datasheet_url', 'qr_code', 'used_at',
            'used_for', 'used_note', 'part_number',
            'shop', 'purchased_at', 'unit_price'
        ];
        const updates = [];
        const params = [];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                let val = req.body[field];
                if (field === 'part_number') {
                    const pnResult = normalizePartNumber(val);
                    if (pnResult.error) {
                        return res.status(400).json({ error: pnResult.error });
                    }
                    val = pnResult.value;
                }
                if (field === 'shop' || field === 'purchased_at' || field === 'unit_price') {
                    const normalizer = field === 'shop' ? normalizeShop
                        : field === 'purchased_at' ? normalizePurchasedAt
                        : normalizeUnitPrice;
                    const result = normalizer(val);
                    if (result.error) {
                        return res.status(400).json({ error: result.error });
                    }
                    val = result.value;
                }
                if ((field === 'category_id' || field === 'location_id' || field === 'used_at' || field === 'used_for' || field === 'used_note') && (val === '' || val === 'null')) {
                    val = null;
                }
                if (field === 'qr_code') {
                    if (val === '' || val === 'null') val = null;
                    if (val) {
                        const dupPart = await db.get('SELECT id FROM parts WHERE qr_code = ? AND id != ? AND deleted_at IS NULL', [val, id]);
                        if (dupPart) return res.status(409).json({ error: 'このQRコードは別の部品に登録済みです' });
                        const dupLoc = await db.get('SELECT id FROM locations WHERE qr_code = ?', [val]);
                        if (dupLoc) return res.status(409).json({ error: 'このQRコードは保管場所に登録済みです' });
                    }
                }
                updates.push(`${field} = ?`);
                params.push(val);
            }
        }

        if (updates.length === 0 && req.body.tags === undefined) {
            return res.status(400).json({ error: 'No fields provided to update' });
        }

        if (updates.length > 0) {
            updates.push('updated_at = CURRENT_TIMESTAMP');
            params.push(id);
            const query = `UPDATE parts SET ${updates.join(', ')} WHERE id = ?`;
            await db.run(query, params);
        }

        // Tags update if provided
        if (req.body.tags !== undefined) {
            const tags = normalizeTagNames(req.body.tags);

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

        const updatedPart = await db.get(`
            SELECT p.*, c.name as category_name, l.name as location_name,
            (SELECT GROUP_CONCAT(t.name, ',') FROM tags t JOIN part_tags pt ON t.id = pt.tag_id WHERE pt.part_id = p.id) as tags
            FROM parts p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN locations l ON p.location_id = l.id
            WHERE p.id = ?
        `, [id]);

        res.json(updatedPart);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/parts/:id - Soft Delete part（ゴミ箱へ移動）
router.delete('/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });

        const db = getDb();
        // ソフトデリート時にQRコードを解放（再利用可能にする。復元しても戻らない）
        const result = await db.run(
            'UPDATE parts SET deleted_at = CURRENT_TIMESTAMP, qr_code = NULL WHERE id = ? AND deleted_at IS NULL',
            [id]
        );
        if (result.changes === 0) {
            return res.status(404).json({ error: 'パーツが見つからないか、既にゴミ箱にあります' });
        }
        res.json({ message: 'Moved to trash', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/parts/:id/permanent - Permanent Delete（ゴミ箱内のパーツのみ）
router.delete('/:id/permanent', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });

        const { affected } = await permanentlyDeleteParts(getDb(), [id]);
        if (affected === 0) {
            return res.status(404).json({ error: 'パーツが見つからないか、ゴミ箱にありません' });
        }
        res.json({ message: 'Permanently deleted', affected });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts/:id/quantity - Change part quantity
router.post('/:id/quantity', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });

        const hasDelta = req.body.delta !== undefined && req.body.delta !== null;
        const hasAbsolute = req.body.absolute !== undefined && req.body.absolute !== null;

        if ((hasDelta && hasAbsolute) || (!hasDelta && !hasAbsolute)) {
            return res.status(400).json({ error: 'delta または absolute のどちらか一方を指定してください' });
        }

        let deltaNum = null;
        let absNum = null;

        if (hasDelta) {
            if (typeof req.body.delta !== 'number' || !Number.isInteger(req.body.delta) || req.body.delta === 0) {
                return res.status(400).json({ error: 'delta は 0 以外の整数で指定してください' });
            }
            deltaNum = req.body.delta;
        } else {
            if (typeof req.body.absolute !== 'number' || !Number.isInteger(req.body.absolute) || req.body.absolute < 0) {
                return res.status(400).json({ error: 'absolute は 0 以上の整数で指定してください' });
            }
            absNum = req.body.absolute;
        }

        let safeReason = null;
        if (req.body.reason !== undefined && req.body.reason !== null) {
            if (typeof req.body.reason !== 'string') {
                return res.status(400).json({ error: 'reason は文字列で指定してください' });
            }
            const trimmed = req.body.reason.trim();
            if (trimmed.length > 200) {
                return res.status(400).json({ error: 'reason は200文字以内で指定してください' });
            }
            safeReason = trimmed || null;
        }

        const db = getDb();
        let previousQuantity;
        let newQuantity;

        if (hasDelta) {
            // 条件付き単一 UPDATE 文により原子的に更新（NULL の古い行は 0 として扱う）
            const result = await db.run(
                'UPDATE parts SET quantity = COALESCE(quantity, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL AND used_at IS NULL AND COALESCE(quantity, 0) + ? >= 0',
                [deltaNum, id, deltaNum]
            );

            if (result.changes === 0) {
                const part = await db.get('SELECT COALESCE(quantity, 0) AS quantity, deleted_at, used_at FROM parts WHERE id = ?', [id]);
                if (!part || part.deleted_at !== null || part.used_at !== null) {
                    return res.status(404).json({ error: '部品が見つかりません（ゴミ箱・使用済みは対象外）' });
                }
                return res.status(400).json({ error: `在庫数が負になります（現在 ${part.quantity}）` });
            }

            const updatedPart = await db.get('SELECT quantity FROM parts WHERE id = ?', [id]);
            newQuantity = updatedPart.quantity;
            previousQuantity = newQuantity - deltaNum;
        } else {
            const part = await db.get(
                'SELECT COALESCE(quantity, 0) AS quantity FROM parts WHERE id = ? AND deleted_at IS NULL AND used_at IS NULL',
                [id]
            );
            if (!part) {
                return res.status(404).json({ error: '部品が見つかりません（ゴミ箱・使用済みは対象外）' });
            }
            previousQuantity = part.quantity;
            newQuantity = absNum;

            if (newQuantity !== previousQuantity) {
                await db.run(
                    'UPDATE parts SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL AND used_at IS NULL',
                    [newQuantity, id]
                );
            }
        }

        console.log(`quantity change part=${id} ${previousQuantity}->${newQuantity} reason=${safeReason || ''}`);

        return res.status(200).json({
            part_id: id,
            previous_quantity: previousQuantity,
            new_quantity: newQuantity,
            delta: newQuantity - previousQuantity,
            reason: safeReason
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts/:id/restore - Restore part（ゴミ箱から復元）
router.post('/:id/restore', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });

        const db = getDb();
        const result = await db.run(
            'UPDATE parts SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
            [id]
        );
        if (result.changes === 0) {
            return res.status(404).json({ error: 'パーツが見つからないか、ゴミ箱にありません' });
        }
        res.json({ message: 'Restored successfully', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts/:id/unuse - Restore used part to active inventory
router.post('/:id/unuse', async (req, res) => {
    try {
        const db = getDb();
        await db.run(
            'UPDATE parts SET used_at = NULL, used_for = NULL, used_note = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [req.params.id]
        );
        res.json({ message: 'Part restored to active inventory' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/parts/bulk/action - Bulk actions
// action: 'trash'（ゴミ箱へ移動） / 'restore'（ゴミ箱から復元） / 'delete'（完全削除。取り消し不可）
router.post('/bulk/action', async (req, res) => {
    try {
        const db = getDb();
        const { action } = req.body;
        const ids = normalizeIds(req.body.ids);

        if (!ids) {
            return res.status(400).json({ error: 'Invalid IDs' });
        }

        const ph = placeholders(ids.length);

        if (action === 'trash') {
            // ソフトデリート時にQRコードを解放（再利用可能にする）
            const result = await db.run(
                `UPDATE parts SET deleted_at = CURRENT_TIMESTAMP, qr_code = NULL WHERE id IN (${ph}) AND deleted_at IS NULL`,
                ids
            );
            res.json({ message: `Moved ${result.changes} items to trash`, affected: result.changes });
        } else if (action === 'restore') {
            const result = await db.run(
                `UPDATE parts SET deleted_at = NULL WHERE id IN (${ph}) AND deleted_at IS NOT NULL`,
                ids
            );
            res.json({ message: `Restored ${result.changes} items`, affected: result.changes });
        } else if (action === 'delete') {
            const { affected } = await permanentlyDeleteParts(db, ids);
            res.json({ message: `Permanently deleted ${affected} items`, affected });
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
        const { updates } = req.body;
        const ids = normalizeIds(req.body.ids);

        if (!ids) {
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

            const sql = `UPDATE parts SET ${fieldsToUpdate.join(', ')} WHERE id IN (${placeholders(ids.length)})`;

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
                    await db.run(`DELETE FROM part_tags WHERE tag_id = ? AND part_id IN (${placeholders(ids.length)})`, [tag.id, ...ids]);
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
        const id = req.params.id;

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

const { multerErrorHandler } = require('../utils/multerErrorHandler');
router.use(multerErrorHandler);

module.exports = router;
