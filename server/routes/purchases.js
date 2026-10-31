const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { normalizePurchasedAt } = require('../utils/purchaseInfo');
const { normalizePurchaseRecord, buildDedupeKey, FIELDS, KEY_FIELDS } = require('../utils/purchaseRecord');

// 1 回の取り込みで受け付ける明細数の上限
const IMPORT_MAX_RECORDS = 5000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const SELECT_WITH_PART_NAME = `
    SELECT pr.*, p.name AS part_name
    FROM purchase_records pr
    LEFT JOIN parts p ON pr.part_id = p.id
`;

// パスパラメータの ID を検証する。不正なら null
function parseId(raw) {
    if (!/^\d+$/.test(String(raw))) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// part_name 付きで 1 件取得する
async function getRecordWithPartName(db, id) {
    return db.get(`${SELECT_WITH_PART_NAME} WHERE pr.id = ?`, [id]);
}

// GET /api/purchases - 購入明細の一覧（絞り込み・ページング）
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const { search, shop, order_id, part_id, linked, from, to, currency } = req.query;

        const where = [];
        const params = [];

        if (typeof search === 'string' && search.trim()) {
            const like = `%${search.trim()}%`;
            where.push('(pr.name LIKE ? OR pr.code LIKE ? OR pr.order_id LIKE ?)');
            params.push(like, like, like);
        }
        if (typeof shop === 'string' && shop !== '') {
            where.push('pr.shop = ?');
            params.push(shop);
        }
        if (typeof order_id === 'string' && order_id !== '') {
            where.push('pr.order_id = ?');
            params.push(order_id);
        }
        if (part_id !== undefined && part_id !== '') {
            const pid = parseId(part_id);
            if (!pid) return res.status(400).json({ error: 'part_id は正の整数で指定してください' });
            where.push('pr.part_id = ?');
            params.push(pid);
        }
        if (linked !== undefined && linked !== '') {
            if (linked === 'true') where.push('pr.part_id IS NOT NULL');
            else if (linked === 'false') where.push('pr.part_id IS NULL');
            else return res.status(400).json({ error: 'linked は true または false で指定してください' });
        }
        if (from !== undefined && from !== '') {
            const r = normalizePurchasedAt(from);
            if (r.error || !r.value) return res.status(400).json({ error: 'from は YYYY-MM-DD 形式で指定してください' });
            where.push('pr.purchased_at >= ?');
            params.push(r.value);
        }
        if (to !== undefined && to !== '') {
            const r = normalizePurchasedAt(to);
            if (r.error || !r.value) return res.status(400).json({ error: 'to は YYYY-MM-DD 形式で指定してください' });
            where.push('pr.purchased_at <= ?');
            params.push(r.value);
        }
        if (typeof currency === 'string' && currency.trim() !== '') {
            where.push('pr.currency = ?');
            params.push(currency.trim().toUpperCase());
        }

        let limit = parseInt(req.query.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
        limit = Math.min(limit, MAX_LIMIT);
        let offset = parseInt(req.query.offset, 10);
        if (!Number.isInteger(offset) || offset < 0) offset = 0;

        const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

        const totalRow = await db.get(`SELECT COUNT(*) AS total FROM purchase_records pr${whereSql}`, params);
        const items = await db.all(
            `${SELECT_WITH_PART_NAME}${whereSql}
             ORDER BY pr.purchased_at DESC, pr.shop, pr.order_id, pr.line_no, pr.id
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({ total: totalRow.total, items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/purchases/shops - 購入店の一覧（件数順）。/:id より前に定義すること
router.get('/shops', async (req, res) => {
    try {
        const db = getDb();
        const rows = await db.all(`
            SELECT shop AS name, COUNT(*) AS count FROM purchase_records
            GROUP BY shop
            ORDER BY count DESC, shop
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/purchases/:id
router.get('/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });

        const record = await getRecordWithPartName(getDb(), id);
        if (!record) return res.status(404).json({ error: '購入明細が見つかりません' });
        res.json(record);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// import は同じ接続で BEGIN / COMMIT を使うため、同時に走ると
// 「cannot start a transaction within a transaction」になる。1 本ずつ直列に処理する。
// 前の処理が失敗しても後続が止まらないよう、キューには失敗を握りつぶした Promise をつなぐ。
let importQueue = Promise.resolve();
function runExclusive(task) {
    const run = importQueue.then(task);
    importQueue = run.catch(() => { });
    return run;
}

// POST /api/purchases/import - 購入明細の一括取り込み
// 本文は配列そのもの、または { records: [...], on_duplicate: 'skip' | 'update' }
router.post('/import', async (req, res) => {
    try {
        const body = req.body;
        let records;
        let onDuplicate;
        if (Array.isArray(body)) {
            records = body;
        } else if (body && typeof body === 'object') {
            records = body.records;
            onDuplicate = body.on_duplicate;
        }
        // 本文の指定を優先し、なければクエリ、どちらもなければ skip
        if (onDuplicate === undefined) onDuplicate = req.query.on_duplicate;
        if (onDuplicate === undefined) onDuplicate = 'skip';

        if (!Array.isArray(records)) {
            return res.status(400).json({ error: '本文は明細の配列、または { records: [...] } で指定してください' });
        }
        if (records.length === 0) {
            return res.status(400).json({ error: '明細が空です。1件以上指定してください' });
        }
        if (records.length > IMPORT_MAX_RECORDS) {
            return res.status(400).json({ error: `一度に取り込める明細は${IMPORT_MAX_RECORDS}件までです（${records.length}件が指定されました）` });
        }
        if (onDuplicate !== 'skip' && onDuplicate !== 'update') {
            return res.status(400).json({ error: "on_duplicate は 'skip' または 'update' で指定してください" });
        }

        const output = await runExclusive(() => importRecords(getDb(), records, onDuplicate));
        res.json(output);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 明細を順に登録・更新して集計を返す。失敗したら ROLLBACK して例外を投げる
async function importRecords(db, records, onDuplicate) {
    let inTransaction = false;
    try {
        const summary = { total: records.length, created: 0, updated: 0, skipped: 0, errors: 0 };
        const results = [];
        const partExists = new Map();
        const hasPart = async (partId) => {
            if (!partExists.has(partId)) {
                const row = await db.get('SELECT 1 AS ok FROM parts WHERE id = ?', [partId]);
                partExists.set(partId, !!row);
            }
            return partExists.get(partId);
        };
        // このリクエスト内で処理済みの重複キー -> 最初に現れた index
        const seenKeys = new Map();

        // node-sqlite3 は接続を共有するため、トランザクションはベストエフォート（速度のために包む）
        await db.exec('BEGIN');
        inTransaction = true;

        for (let index = 0; index < records.length; index++) {
            const raw = records[index];
            const norm = normalizePurchaseRecord(raw);
            if (norm.error) {
                summary.errors++;
                results.push({ index, status: 'error', error: norm.error });
                continue;
            }
            const value = norm.value;
            const key = buildDedupeKey(value);
            if (key.error) {
                summary.errors++;
                results.push({ index, status: 'error', error: key.error });
                continue;
            }

            const warnings = [];
            let missingPartId = null;
            if (value.part_id !== null && !(await hasPart(value.part_id))) {
                missingPartId = value.part_id;
                value.part_id = null;
            }

            const seenKey = `${value.shop}\u0000${key.value}`;
            const firstIndex = seenKeys.get(seenKey);
            if (firstIndex === undefined) {
                seenKeys.set(seenKey, index);
            } else {
                warnings.push(`同じリクエストの index ${firstIndex} と同じ明細とみなしました（数量や単価が違う場合は line_no を付けてください）`);
            }

            const existing = await db.get(
                'SELECT id FROM purchase_records WHERE shop = ? AND dedupe_key = ?',
                [value.shop, key.value]
            );

            let result;
            if (!existing) {
                if (missingPartId !== null) {
                    warnings.push(`part_id ${missingPartId} の部品が見つからないため、ひも付けずに登録しました`);
                }
                const cols = [...FIELDS, 'dedupe_key'];
                const insert = await db.run(
                    `INSERT INTO purchase_records (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
                    [...FIELDS.map(f => value[f]), key.value]
                );
                summary.created++;
                result = { index, status: 'created', id: insert.lastID };
            } else if (onDuplicate === 'skip') {
                summary.skipped++;
                result = { index, status: 'skipped', id: existing.id };
            } else {
                if (missingPartId !== null) {
                    warnings.push(`part_id ${missingPartId} の部品が見つからないため無視しました（既存のひも付けは維持）`);
                }
                // 送られてきた項目だけを上書きする。
                // part_id は null や未指定なら既存のひも付けを、currency は null や空なら既存の値を残す
                const sets = [];
                const params = [];
                for (const f of FIELDS) {
                    if (raw[f] === undefined) continue;
                    if (f === 'part_id' && value.part_id === null) continue;
                    if (f === 'currency' && (raw.currency === null || (typeof raw.currency === 'string' && raw.currency.trim() === ''))) continue;
                    sets.push(`${f} = ?`);
                    params.push(value[f]);
                }
                sets.push('updated_at = CURRENT_TIMESTAMP');
                params.push(existing.id);
                await db.run(`UPDATE purchase_records SET ${sets.join(', ')} WHERE id = ?`, params);
                summary.updated++;
                result = { index, status: 'updated', id: existing.id };
            }
            if (warnings.length > 0) result.warning = warnings.join(' / ');
            results.push(result);
        }

        await db.exec('COMMIT');
        inTransaction = false;

        return { ...summary, results };
    } catch (err) {
        if (inTransaction) {
            await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
        }
        throw err;
    }
}

// PATCH /api/purchases/:id - 部分更新
router.patch('/:id', async (req, res) => {
    try {
        const db = getDb();
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });

        const current = await db.get('SELECT * FROM purchase_records WHERE id = ?', [id]);
        if (!current) return res.status(404).json({ error: '購入明細が見つかりません' });

        const norm = normalizePurchaseRecord(req.body, { partial: true });
        if (norm.error) return res.status(400).json({ error: norm.error });
        const updates = norm.value;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: '更新する項目を1つ以上指定してください' });
        }

        if (updates.part_id !== undefined && updates.part_id !== null) {
            const part = await db.get('SELECT 1 AS ok FROM parts WHERE id = ?', [updates.part_id]);
            if (!part) {
                return res.status(400).json({ error: `part_id ${updates.part_id} の部品が見つかりません` });
            }
        }

        const sets = Object.keys(updates).map(f => `${f} = ?`);
        const params = Object.values(updates);

        // 重複キーの材料が変わったら、既存の値とマージしてキーを作り直す
        if (KEY_FIELDS.some(f => updates[f] !== undefined)) {
            const merged = { ...current, ...updates };
            const key = buildDedupeKey(merged);
            if (key.error) return res.status(400).json({ error: key.error });
            if (key.value !== current.dedupe_key || merged.shop !== current.shop) {
                const dup = await db.get(
                    'SELECT id FROM purchase_records WHERE shop = ? AND dedupe_key = ? AND id != ?',
                    [merged.shop, key.value, id]
                );
                if (dup) {
                    return res.status(409).json({ error: `同じ明細がすでにあります（id: ${dup.id}）` });
                }
            }
            sets.push('dedupe_key = ?');
            params.push(key.value);
        }

        sets.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);
        await db.run(`UPDATE purchase_records SET ${sets.join(', ')} WHERE id = ?`, params);

        res.json(await getRecordWithPartName(db, id));
    } catch (err) {
        // 事前の重複確認をすり抜けた UNIQUE 違反（同時更新など）も 409 にする
        if (err && err.code === 'SQLITE_CONSTRAINT') {
            return res.status(409).json({ error: '同じ明細がすでにあります' });
        }
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/purchases/:id - 物理削除
router.delete('/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });

        const result = await getDb().run('DELETE FROM purchase_records WHERE id = ?', [id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: '購入明細が見つかりません' });
        }
        res.json({ deleted: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
