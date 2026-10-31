const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { normalizePurchasedAt } = require('../utils/purchaseInfo');
const { normalizePurchaseRecord, buildDedupeKey, FIELDS, KEY_FIELDS } = require('../utils/purchaseRecord');
const { applyPurchaseToPart } = require('../utils/applyPurchaseToPart');

// 1 回の取り込みで受け付ける明細数の上限
const IMPORT_MAX_RECORDS = 5000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const BATCH_DEFAULT_LIMIT = 50;
const BATCH_MAX_LIMIT = 200;
const SOURCE_MAX_LENGTH = 100;
const BATCH_NOTE_MAX_LENGTH = 1000;
const APPROVE_MAX_IDS = 500;
const LINK_STATUSES = ['linked', 'unlinked', 'suggested'];

const SELECT_WITH_PART_NAME = `
    SELECT pr.*, p.name AS part_name, sp.name AS suggested_part_name
    FROM purchase_records pr
    LEFT JOIN parts p ON pr.part_id = p.id
    LEFT JOIN parts sp ON pr.suggested_part_id = sp.id AND sp.deleted_at IS NULL
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
        const { search, shop, order_id, part_id, linked, link_status, from, to, currency, batch_id } = req.query;

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
        if (batch_id !== undefined && batch_id !== '') {
            const bid = parseId(batch_id);
            if (!bid) return res.status(400).json({ error: 'batch_id は正の整数で指定してください' });
            where.push('pr.import_batch_id = ?');
            params.push(bid);
        }
        if (linked !== undefined && linked !== '') {
            if (linked === 'true') where.push('pr.part_id IS NOT NULL');
            else if (linked === 'false') where.push('pr.part_id IS NULL');
            else return res.status(400).json({ error: 'linked は true または false で指定してください' });
        }
        if (link_status !== undefined && link_status !== '') {
            if (!LINK_STATUSES.includes(link_status)) {
                return res.status(400).json({ error: 'link_status は linked / unlinked / suggested のいずれかで指定してください' });
            }
            if (link_status === 'linked') where.push('pr.part_id IS NOT NULL');
            else if (link_status === 'unlinked') where.push('pr.part_id IS NULL');
            else where.push('pr.part_id IS NULL AND pr.suggested_part_id IS NOT NULL');
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

// import と undo は同じ接続で BEGIN / COMMIT を使うため、同時に走ると
// 「cannot start a transaction within a transaction」になる。1 本ずつ直列に処理する。
// 前の処理が失敗しても後続が止まらないよう、キューには失敗を握りつぶした Promise をつなぐ。
let importQueue = Promise.resolve();
function runExclusive(task) {
    const run = importQueue.then(task);
    importQueue = run.catch(() => { });
    return run;
}

// 真偽値のクエリ・本文を解釈する。解釈できなければ undefined（呼び出し側で 400 にする）
function parseBoolean(val) {
    if (val === undefined || val === '') return false; // 空文字は指定なし
    if (val === true || val === 'true') return true;
    if (val === false || val === 'false') return false;
    return undefined;
}

// 任意の文字列項目（source / note）を trim して検証する。空は null
function parseOptionalText(label, val, maxLength) {
    if (val === undefined || val === null) return { value: null };
    if (typeof val !== 'string') return { error: `${label} は文字列で指定してください` };
    const str = val.trim();
    if (str === '') return { value: null };
    if (str.length > maxLength) return { error: `${label} は${maxLength}文字以内で指定してください` };
    return { value: str };
}

// POST /api/purchases/import - 購入明細の一括取り込み
// 本文は配列そのもの、または { records: [...], on_duplicate: 'skip' | 'update', dry_run, source, note }
router.post('/import', async (req, res) => {
    try {
        const body = req.body;
        let records;
        let onDuplicate;
        let dryRunRaw;
        let sourceRaw;
        let noteRaw;
        if (Array.isArray(body)) {
            records = body;
        } else if (body && typeof body === 'object') {
            records = body.records;
            onDuplicate = body.on_duplicate;
            dryRunRaw = body.dry_run;
            sourceRaw = body.source;
            noteRaw = body.note;
        }
        // 本文の指定を優先し、なければクエリ、どちらもなければ既定値
        if (onDuplicate === undefined) onDuplicate = req.query.on_duplicate;
        if (onDuplicate === undefined) onDuplicate = 'skip';
        if (dryRunRaw === undefined) dryRunRaw = req.query.dry_run;
        if (sourceRaw === undefined) sourceRaw = req.query.source;
        if (noteRaw === undefined) noteRaw = req.query.note;

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
        const dryRun = parseBoolean(dryRunRaw);
        if (dryRun === undefined) {
            return res.status(400).json({ error: 'dry_run は true または false で指定してください' });
        }
        const source = parseOptionalText('source', sourceRaw, SOURCE_MAX_LENGTH);
        if (source.error) return res.status(400).json({ error: source.error });
        const note = parseOptionalText('note', noteRaw, BATCH_NOTE_MAX_LENGTH);
        if (note.error) return res.status(400).json({ error: note.error });

        const output = await runExclusive(() => importRecords(getDb(), records, onDuplicate, {
            dryRun,
            source: source.value,
            note: note.value
        }));
        res.json(output);
    } catch (err) {
        // 取り込み中に、ほかの更新で UNIQUE 制約に当たった場合（ROLLBACK 済み）
        if (err && err.code === 'SQLITE_CONSTRAINT') {
            return res.status(409).json({ error: '取り込み中にほかの更新と重なりました。もう一度実行してください' });
        }
        res.status(500).json({ error: err.message });
    }
});

// 更新時刻はミリ秒まで残す（取り込み直後の変更を modified_after_import で見分けるため）
const NOW_SQL = "strftime('%Y-%m-%d %H:%M:%f','now')";

// 取り込みの判定だけを行い、何も書き込まない（SELECT のみ）。dry_run も本番も同じこの結果を使う。
// 同じリクエスト内の重複は、Map 上の仮の行で模擬する。
// 戻り値: { summary, items, ops }
// - items: 明細ごとの結果（index, status, record, before, warning, error と、id または ref）
// - ops: 本番で適用する操作の列（create / update）
async function planImport(db, records, onDuplicate) {
    const summary = { total: records.length, created: 0, updated: 0, skipped: 0, errors: 0 };
    const items = [];
    const ops = [];
    const partExists = new Map();
    const hasPart = async (partId) => {
        if (!partExists.has(partId)) {
            const row = await db.get('SELECT 1 AS ok FROM parts WHERE id = ?', [partId]);
            partExists.set(partId, !!row);
        }
        return partExists.get(partId);
    };
    // このリクエストで処理済みの重複キー -> { index, row（仮の現在値）, op（新規 or 更新の操作）, id（既存行のとき）}
    const state = new Map();

    for (let index = 0; index < records.length; index++) {
        const raw = records[index];
        const norm = normalizePurchaseRecord(raw);
        if (norm.error) {
            summary.errors++;
            items.push({ index, status: 'error', error: norm.error });
            continue;
        }
        const value = norm.value;
        const key = buildDedupeKey(value);
        if (key.error) {
            summary.errors++;
            items.push({ index, status: 'error', error: key.error });
            continue;
        }

        const warnings = [];
        let missingPartId = null;
        if (value.part_id !== null && !(await hasPart(value.part_id))) {
            missingPartId = value.part_id;
            value.part_id = null;
        }
        // 候補の部品も part_id と同じ扱い（なければ NULL にして warning）
        let missingSuggestedId = null;
        if (value.suggested_part_id !== null && !(await hasPart(value.suggested_part_id))) {
            missingSuggestedId = value.suggested_part_id;
            value.suggested_part_id = null;
            value.suggestion_note = null; // 候補がないのに理由だけが残らないようにする
        }

        // part_id と候補が同時に指定された明細は、ひも付けを優先して候補を無視する
        let ignoredSuggestion = false;
        if (value.part_id !== null && value.suggested_part_id !== null) {
            value.suggested_part_id = null;
            value.suggestion_note = null;
            ignoredSuggestion = true;
            warnings.push('part_id と suggested_part_id が両方あるため、suggested_part_id と suggestion_note を無視しました');
        }

        const stateKey = `${value.shop}\u0000${key.value}`;
        let entry = state.get(stateKey);
        if (entry) {
            warnings.push(`同じリクエストの index ${entry.index} と同じ明細とみなしました（数量や単価が違う場合は line_no を付けてください）`);
        } else {
            const existing = await db.get(
                'SELECT * FROM purchase_records WHERE shop = ? AND dedupe_key = ?',
                [value.shop, key.value]
            );
            entry = { index, row: existing ? { ...existing } : null, original: existing || null, op: null, id: existing ? existing.id : null };
            state.set(stateKey, entry);
        }

        const item = { index };
        if (!entry.row) {
            // 新規登録
            if (missingPartId !== null) {
                warnings.push(`part_id ${missingPartId} の部品が見つからないため、ひも付けずに登録しました`);
            }
            if (missingSuggestedId !== null) {
                warnings.push(`suggested_part_id ${missingSuggestedId} の部品が見つからないため、候補を付けずに登録しました`);
            }
            const op = { type: 'create', values: { ...value }, dedupe_key: key.value, id: null };
            ops.push(op);
            entry.op = op;
            entry.row = { ...value, dedupe_key: key.value };
            summary.created++;
            item.status = 'created';
            item.ref = op;
        } else if (onDuplicate === 'skip') {
            summary.skipped++;
            item.status = 'skipped';
            if (entry.id !== null) item.id = entry.id; else item.ref = entry.op;
        } else {
            if (missingPartId !== null) {
                warnings.push(`part_id ${missingPartId} の部品が見つからないため無視しました（既存のひも付けは維持）`);
            }
            if (missingSuggestedId !== null) {
                warnings.push(`suggested_part_id ${missingSuggestedId} の部品が見つからないため無視しました（既存の候補は維持）`);
            }
            // 送られてきた項目だけを上書きする。
            // part_id は null や未指定なら既存のひも付けを、currency は null や空なら既存の値を残す
            const changes = {};
            for (const f of FIELDS) {
                if (raw[f] === undefined) continue;
                if (f === 'part_id' && value.part_id === null) continue;
                // 存在しない候補は無視する（明示的な null での消去は有効）
                if (f === 'suggested_part_id' && value.suggested_part_id === null && missingSuggestedId !== null) continue;
                if (f === 'suggestion_note' && missingSuggestedId !== null) continue;
                if (f === 'currency' && (raw.currency === null || (typeof raw.currency === 'string' && raw.currency.trim() === ''))) continue;
                changes[f] = value[f];
            }
            // ひも付け済みの明細には候補を付けない（解除したときに古い候補がよみがえるため）
            const mergedPartId = changes.part_id !== undefined ? changes.part_id : entry.row.part_id;
            if (mergedPartId !== null && mergedPartId !== undefined) {
                if (!ignoredSuggestion && changes.suggested_part_id !== undefined && changes.suggested_part_id !== null) {
                    warnings.push('すでに部品にひも付いている明細には候補を設定できないため、suggested_part_id と suggestion_note を無視しました');
                    delete changes.suggested_part_id;
                    delete changes.suggestion_note;
                } else if (changes.part_id !== undefined) {
                    // part_id を設定する更新では、PATCH と同じく既存の候補を消す
                    changes.suggested_part_id = null;
                    changes.suggestion_note = null;
                }
            }
            const { dedupe_key: _ignored, ...before } = entry.row;
            if (entry.id === null) delete before.id;
            item.before = before;

            if (entry.id === null) {
                // このリクエストで作る行への上書きは、作成する値にまとめる
                Object.assign(entry.op.values, changes);
                item.ref = entry.op;
            } else {
                if (!entry.op) {
                    entry.op = { type: 'update', id: entry.id, changes: {}, beforeRow: entry.original };
                    ops.push(entry.op);
                }
                Object.assign(entry.op.changes, changes);
                item.id = entry.id;
                item.updOp = entry.op;
            }
            Object.assign(entry.row, changes);
            summary.updated++;
            item.status = 'updated';
        }
        // 確認用（dry_run）に返す、正規化後の値
        item.record = { ...value };
        if (warnings.length > 0) item.warning = warnings.join(' / ');
        items.push(item);
    }

    return { summary, items, ops };
}

// plan を本番として適用する。同じトランザクション内でバッチと変更記録も作る。失敗したら ROLLBACK して例外を投げる
async function applyImport(db, plan, records, onDuplicate, { source, note }) {
    let inTransaction = false;
    try {
        await db.exec('BEGIN');
        inTransaction = true;

        const batch = await db.run(
            `INSERT INTO purchase_import_batches
             (source, note, on_duplicate, total, created_count, updated_count, skipped_count, error_count)
             VALUES (?, ?, ?, ?, 0, 0, 0, 0)`,
            [source, note, onDuplicate, records.length]
        );
        const batchId = batch.lastID;

        for (const op of plan.ops) {
            if (op.type === 'create') {
                const cols = [...FIELDS, 'dedupe_key', 'import_batch_id'];
                const insert = await db.run(
                    `INSERT INTO purchase_records (${cols.join(', ')}, created_at, updated_at)
                     VALUES (${cols.map(() => '?').join(', ')}, ${NOW_SQL}, ${NOW_SQL})`,
                    [...FIELDS.map(f => op.values[f]), op.dedupe_key, batchId]
                );
                op.id = insert.lastID;
                await db.run(
                    'INSERT INTO purchase_import_changes (batch_id, record_id, action, before_json) VALUES (?, ?, ?, NULL)',
                    [batchId, op.id, 'created']
                );
            } else {
                // plan のあとに PATCH / DELETE が入りうるため、更新の直前に行を読み直す。
                // 取り消しで戻す先（before_json）は、この読み直した値にする
                const current = await db.get('SELECT * FROM purchase_records WHERE id = ?', [op.id]);
                if (!current) {
                    op.failed = true;
                    continue;
                }
                const cols = Object.keys(op.changes);
                const update = await db.run(
                    `UPDATE purchase_records SET ${[...cols.map(c => `${c} = ?`), `updated_at = ${NOW_SQL}`].join(', ')} WHERE id = ?`,
                    [...cols.map(c => op.changes[c]), op.id]
                );
                if (update.changes === 0) {
                    op.failed = true;
                    continue;
                }
                await db.run(
                    'INSERT INTO purchase_import_changes (batch_id, record_id, action, before_json) VALUES (?, ?, ?, ?)',
                    [batchId, op.id, 'updated', JSON.stringify(current)]
                );
            }
        }

        // 更新できなかった明細（取り込み中に削除された）は error に振り替えて、件数を合わせる
        const summary = { ...plan.summary };
        for (const item of plan.items) {
            if (item.status === 'updated' && item.updOp && item.updOp.failed) {
                item.status = 'error';
                item.error = '取り込み中に明細が削除されたため更新できませんでした';
                summary.updated--;
                summary.errors++;
            }
        }

        // 件数を確定する。created_at は完了時刻にする（取り消し時に「取り込み後に変更された行」を判定する基準）
        await db.run(
            `UPDATE purchase_import_batches
             SET created_count = ?, updated_count = ?, skipped_count = ?, error_count = ?, created_at = ${NOW_SQL}
             WHERE id = ?`,
            [summary.created, summary.updated, summary.skipped, summary.errors, batchId]
        );
        await db.exec('COMMIT');
        inTransaction = false;
        return { batchId, summary };
    } catch (err) {
        if (inTransaction) {
            await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
        }
        throw err;
    }
}

// 取り込みを実行する。
// - dryRun: plan だけを返す。DB には一切書き込まない（BEGIN もしない。共有接続の ROLLBACK で他の書き込みが消えるのを防ぐ）
// - 本番: plan を作ってから、トランザクション内で適用する
async function importRecords(db, records, onDuplicate, { dryRun = false, source = null, note = null } = {}) {
    const plan = await planImport(db, records, onDuplicate);

    if (dryRun) {
        // 確認用の結果。作成予定の行の id は存在しないため付けない
        const results = plan.items.map(({ ref, id, ...item }) => {
            if (id !== undefined) item.id = id;
            return item;
        });
        return { ...plan.summary, dry_run: true, results };
    }

    const { batchId, summary } = await applyImport(db, plan, records, onDuplicate, { source, note });
    const results = plan.items.map((item) => {
        const out = { index: item.index, status: item.status };
        if (item.error !== undefined) out.error = item.error;
        const id = item.id !== undefined ? item.id : (item.ref ? item.ref.id : undefined);
        if (id !== undefined) out.id = id;
        if (item.warning !== undefined) out.warning = item.warning;
        return out;
    });
    return { ...summary, batch_id: batchId, results };
}

// 取り消しの判定と件数の計算を行う（SELECT のみ。何も書き込まない）。
// 409 にしたい条件は { conflict: メッセージ } で返す。それ以外は { counts, deletes, restores }
async function planUndo(db, batch) {
    if (batch.undone_at) {
        return { conflict: 'このバッチはすでに取り消されています' };
    }

    // あとのバッチ（取り消していないもの）が同じ明細に手を加えていたら、先にそちらを取り消す必要がある
    const later = await db.all(
        `SELECT DISTINCT c2.batch_id AS batch_id
         FROM purchase_import_changes c1
         JOIN purchase_import_changes c2 ON c2.record_id = c1.record_id
         JOIN purchase_import_batches b2 ON b2.id = c2.batch_id
         WHERE c1.batch_id = ? AND c2.batch_id > ? AND b2.undone_at IS NULL
         ORDER BY c2.batch_id`,
        [batch.id, batch.id]
    );
    if (later.length > 0) {
        return { conflict: `あとのバッチ（id: ${later.map(r => r.batch_id).join(', ')}）が同じ明細を変更しています。先にそちらを取り消してください` };
    }

    const counts = { batch_id: batch.id, deleted: 0, restored: 0, missing: 0, linked_deleted: 0, modified_after_import: 0 };
    const deletes = [];
    const restores = [];
    const changes = await db.all('SELECT * FROM purchase_import_changes WHERE batch_id = ? ORDER BY id DESC', [batch.id]);
    const rows = new Map();
    for (const change of changes) {
        const row = await db.get('SELECT * FROM purchase_records WHERE id = ?', [change.record_id]);
        if (!row) {
            counts.missing++;
            continue;
        }
        rows.set(change.record_id, row);
        if (row.updated_at && batch.created_at && row.updated_at > batch.created_at) {
            counts.modified_after_import++;
        }
        if (change.action === 'created') {
            if (row.part_id !== null && row.part_id !== undefined) counts.linked_deleted++;
            deletes.push(row.id);
            counts.deleted++;
        } else {
            restores.push({ id: row.id, before: JSON.parse(change.before_json) });
            counts.restored++;
        }
    }

    // 元の値に戻すと、削除・復元の対象外の行と (shop, dedupe_key) が重なる場合は取り消せない
    const touched = new Set([...deletes, ...restores.map(r => r.id)]);
    for (const r of restores) {
        if (r.before.shop === undefined || r.before.dedupe_key === undefined) continue;
        const clash = await db.get(
            'SELECT id FROM purchase_records WHERE shop = ? AND dedupe_key = ? AND id != ?',
            [r.before.shop, r.before.dedupe_key, r.id]
        );
        if (clash && !touched.has(clash.id)) {
            return { conflict: '元の値に戻すと、ほかの明細と重複するため取り消せません' };
        }
    }

    return { counts, deletes, restores };
}

// 取り消しを実行する。削除してから復元の順に行い、失敗したら ROLLBACK して例外を投げる
async function applyUndo(db, batch, plan) {
    // 復元できる列は、purchase_records の実際の列（id を除く）だけ。before_json のキーを SQL に埋め込まない
    const tableInfo = await db.all('PRAGMA table_info(purchase_records)');
    const validCols = tableInfo.map(c => c.name).filter(c => c !== 'id');

    let inTransaction = false;
    try {
        await db.exec('BEGIN');
        inTransaction = true;
        for (const id of plan.deletes) {
            await db.run('DELETE FROM purchase_records WHERE id = ?', [id]);
        }
        for (const r of plan.restores) {
            const cols = validCols.filter(c => Object.prototype.hasOwnProperty.call(r.before, c));
            if (cols.length === 0) continue;
            await db.run(
                `UPDATE purchase_records SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
                [...cols.map(c => r.before[c]), r.id]
            );
        }
        await db.run('UPDATE purchase_import_batches SET undone_at = CURRENT_TIMESTAMP WHERE id = ?', [batch.id]);
        await db.exec('COMMIT');
        inTransaction = false;
    } catch (err) {
        if (inTransaction) {
            await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
        }
        throw err;
    }
}

// バッチの取り消し。dry_run は計算だけ（書き込みなし）。409 の条件は { conflict } で返す
async function undoBatch(db, batch, dryRun) {
    const plan = await planUndo(db, batch);
    if (plan.conflict) return plan;
    if (!dryRun) await applyUndo(db, batch, plan);
    return { result: { ...plan.counts, dry_run: dryRun } };
}

// GET /api/purchases/batches - 取り込みバッチの一覧（新しい順）。/:id より前に定義すること
router.get('/batches', async (req, res) => {
    try {
        let limit = parseInt(req.query.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) limit = BATCH_DEFAULT_LIMIT;
        limit = Math.min(limit, BATCH_MAX_LIMIT);
        const rows = await getDb().all('SELECT * FROM purchase_import_batches ORDER BY id DESC LIMIT ?', [limit]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/purchases/batches/:id
router.get('/batches/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });
        const batch = await getDb().get('SELECT * FROM purchase_import_batches WHERE id = ?', [id]);
        if (!batch) return res.status(404).json({ error: '取り込みバッチが見つかりません' });
        res.json(batch);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/purchases/batches/:id/undo - バッチ単位の取り消し（dry_run で件数だけ確認できる）
router.post('/batches/:id/undo', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });

        let dryRunRaw = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body.dry_run : undefined;
        if (dryRunRaw === undefined) dryRunRaw = req.query.dry_run;
        const dryRun = parseBoolean(dryRunRaw);
        if (dryRun === undefined) {
            return res.status(400).json({ error: 'dry_run は true または false で指定してください' });
        }

        const outcome = await runExclusive(async () => {
            const db = getDb();
            const batch = await db.get('SELECT * FROM purchase_import_batches WHERE id = ?', [id]);
            if (!batch) return { notFound: true };
            return undoBatch(db, batch, dryRun);
        });
        if (outcome.notFound) return res.status(404).json({ error: '取り込みバッチが見つかりません' });
        if (outcome.conflict) return res.status(409).json({ error: outcome.conflict });
        res.json(outcome.result);
    } catch (err) {
        // 元の値に戻すと、取り込み後に作られた明細とキーが重なる場合
        if (err && err.code === 'SQLITE_CONSTRAINT') {
            return res.status(409).json({ error: '元の値に戻すと、ほかの明細と重複するため取り消せません' });
        }
        res.status(500).json({ error: err.message });
    }
});

// 候補を 1 件承認する。{ code, error?, record?, part_updated? } を返す（code は HTTP ステータス）。
// 明細の更新と部品の更新は 1 つのトランザクションにまとめる。runExclusive の中から呼ぶこと
async function approveSuggestion(db, id) {
    const current = await db.get('SELECT * FROM purchase_records WHERE id = ?', [id]);
    if (!current) return { code: 404, error: '購入明細が見つかりません' };
    if (current.part_id !== null) return { code: 409, error: 'すでに部品にひも付いています' };
    if (current.suggested_part_id === null) return { code: 409, error: '承認できる候補がありません' };
    const part = await db.get('SELECT deleted_at FROM parts WHERE id = ?', [current.suggested_part_id]);
    if (!part) return { code: 409, error: `候補の部品（id: ${current.suggested_part_id}）が見つかりません。候補を却下してください` };
    if (part.deleted_at !== null) return { code: 409, error: `候補の部品（id: ${current.suggested_part_id}）はゴミ箱にあります` };

    const partId = current.suggested_part_id;
    let partUpdated = null;
    let inTransaction = false;
    try {
        await db.exec('BEGIN');
        inTransaction = true;
        const update = await db.run(
            `UPDATE purchase_records
             SET part_id = ?, suggested_part_id = NULL, suggestion_note = NULL, updated_at = ${NOW_SQL}
             WHERE id = ? AND part_id IS NULL AND suggested_part_id = ?`,
            [partId, id, partId]
        );
        if (update.changes === 0) {
            await db.exec('ROLLBACK');
            inTransaction = false;
            return { code: 409, error: '候補が変更されたため承認できませんでした。もう一度お試しください' };
        }
        partUpdated = await applyPurchaseToPart(db, { ...current, part_id: partId }, partId);
        await db.exec('COMMIT');
        inTransaction = false;
    } catch (err) {
        if (inTransaction) {
            await db.exec('ROLLBACK').catch(e => console.error('Rollback failed:', e));
        }
        throw err;
    }
    return { code: 200, record: await getRecordWithPartName(db, id), part_updated: partUpdated };
}

// POST /api/purchases/approve-suggestions - 候補の一括承認。/:id より前に定義すること
router.post('/approve-suggestions', async (req, res) => {
    try {
        const ids = req.body && typeof req.body === 'object' ? req.body.ids : undefined;
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > APPROVE_MAX_IDS) {
            return res.status(400).json({ error: `ids は1〜${APPROVE_MAX_IDS}件の ID の配列で指定してください` });
        }
        if (!ids.every(v => (typeof v === 'number' || typeof v === 'string') && parseId(v) !== null)) {
            return res.status(400).json({ error: 'ids は正の整数の配列で指定してください' });
        }

        const output = await runExclusive(async () => {
            const db = getDb();
            const results = [];
            let approved = 0;
            let failed = 0;
            for (const raw of ids) {
                const id = parseId(raw);
                try {
                    const r = await approveSuggestion(db, id);
                    if (r.code === 200) {
                        approved++;
                        results.push({ id, status: 'approved', part_updated: r.part_updated });
                    } else {
                        failed++;
                        results.push({ id, status: 'error', error: r.error });
                    }
                } catch (err) {
                    failed++;
                    results.push({ id, status: 'error', error: err.message });
                }
            }
            return { approved, failed, results };
        });
        res.json(output);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/purchases/:id/approve-suggestion - 候補を承認してひも付ける
router.post('/:id/approve-suggestion', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });
        const r = await runExclusive(() => approveSuggestion(getDb(), id));
        if (r.code !== 200) return res.status(r.code).json({ error: r.error });
        res.json({ record: r.record, part_updated: r.part_updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/purchases/:id/reject-suggestion - 候補を却下する
router.post('/:id/reject-suggestion', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });
        // import / undo のトランザクションに巻き込まれないよう、直列に処理する
        const out = await runExclusive(async () => {
            const db = getDb();
            const current = await db.get('SELECT suggested_part_id FROM purchase_records WHERE id = ?', [id]);
            if (!current) return { code: 404, body: { error: '購入明細が見つかりません' } };
            if (current.suggested_part_id === null) return { code: 409, body: { error: '却下できる候補がありません' } };
            await db.run(
                `UPDATE purchase_records SET suggested_part_id = NULL, suggestion_note = NULL, updated_at = ${NOW_SQL} WHERE id = ?`,
                [id]
            );
            return { code: 200, body: { record: await getRecordWithPartName(db, id) } };
        });
        res.status(out.code).json(out.body);
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

// PATCH /api/purchases/:id - 部分更新
router.patch('/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid ID' });

        // import / undo のトランザクションに巻き込まれないよう、直列に処理する
        const out = await runExclusive(() => patchRecord(getDb(), id, req.body));
        res.status(out.code).json(out.body);
    } catch (err) {
        // 事前の重複確認をすり抜けた UNIQUE 違反（同時更新など）も 409 にする
        if (err && err.code === 'SQLITE_CONSTRAINT') {
            return res.status(409).json({ error: '同じ明細がすでにあります' });
        }
        res.status(500).json({ error: err.message });
    }
});

// 明細の部分更新。{ code, body } を返す（code は HTTP ステータス）。runExclusive の中から呼ぶこと
async function patchRecord(db, id, input) {
    const fail = (code, error) => ({ code, body: { error } });

    const current = await db.get('SELECT * FROM purchase_records WHERE id = ?', [id]);
    if (!current) return fail(404, '購入明細が見つかりません');

    const norm = normalizePurchaseRecord(input, { partial: true });
    if (norm.error) return fail(400, norm.error);
    const updates = norm.value;

    if (Object.keys(updates).length === 0) {
        return fail(400, '更新する項目を1つ以上指定してください');
    }

    if (updates.part_id !== undefined && updates.part_id !== null) {
        const part = await db.get('SELECT 1 AS ok FROM parts WHERE id = ?', [updates.part_id]);
        if (!part) return fail(400, `part_id ${updates.part_id} の部品が見つかりません`);
    }

    if (updates.suggested_part_id !== undefined && updates.suggested_part_id !== null) {
        const part = await db.get('SELECT 1 AS ok FROM parts WHERE id = ?', [updates.suggested_part_id]);
        if (!part) return fail(400, `suggested_part_id ${updates.suggested_part_id} の部品が見つかりません`);
    }

    // part_id を新しく（前と違う値に）ひも付けるときは、候補を消して部品側の購入情報を更新する
    const newlyLinked = updates.part_id !== undefined && updates.part_id !== null && updates.part_id !== current.part_id;
    if (newlyLinked) {
        updates.suggested_part_id = null;
        updates.suggestion_note = null;
    }

    // ひも付け済みの明細に候補を付けると、解除したときに古い候補がよみがえる。更新後の状態で両方が入るなら拒否する
    if (updates.suggested_part_id !== undefined && updates.suggested_part_id !== null) {
        const mergedPartId = updates.part_id !== undefined ? updates.part_id : current.part_id;
        if (mergedPartId !== null) return fail(400, 'ひも付け済みの明細には候補を設定できません');
    }

    const sets = Object.keys(updates).map(f => `${f} = ?`);
    const params = Object.values(updates);

    // 重複キーの材料が変わったら、既存の値とマージしてキーを作り直す
    if (KEY_FIELDS.some(f => updates[f] !== undefined)) {
        const merged = { ...current, ...updates };
        const key = buildDedupeKey(merged);
        if (key.error) return fail(400, key.error);
        if (key.value !== current.dedupe_key || merged.shop !== current.shop) {
            const dup = await db.get(
                'SELECT id FROM purchase_records WHERE shop = ? AND dedupe_key = ? AND id != ?',
                [merged.shop, key.value, id]
            );
            if (dup) return fail(409, `同じ明細がすでにあります（id: ${dup.id}）`);
        }
        sets.push('dedupe_key = ?');
        params.push(key.value);
    }

    sets.push(`updated_at = ${NOW_SQL}`);
    params.push(id);
    await db.run(`UPDATE purchase_records SET ${sets.join(', ')} WHERE id = ?`, params);

    let partUpdated = null;
    if (newlyLinked) {
        partUpdated = await applyPurchaseToPart(db, { ...current, ...updates }, updates.part_id);
    }

    return { code: 200, body: { ...(await getRecordWithPartName(db, id)), part_updated: partUpdated } };
}

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
