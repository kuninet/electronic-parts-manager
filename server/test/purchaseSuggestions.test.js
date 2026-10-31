const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { createTestDb } = require('./testHelper');
const { applyPurchaseToPart } = require('../utils/applyPurchaseToPart');

test('applyPurchaseToPart (PS-A)', async (t) => {
  let db;
  t.before(async () => { db = await createTestDb(); });
  t.beforeEach(async () => { await db.run('DELETE FROM parts'); });

  const part = async (f = {}) => (await db.run(
    `INSERT INTO parts (name, quantity, shop, purchased_at, unit_price) VALUES ('P', 1, ?, ?, ?)`,
    [f.shop ?? null, f.purchased_at ?? null, f.unit_price ?? null]
  )).lastID;
  const row = (id) => db.get('SELECT shop, purchased_at, unit_price FROM parts WHERE id = ?', [id]);
  const rec = (o = {}) => ({ shop: '秋月', purchased_at: '2026-03-01', unit_price: 10, currency: 'JPY', ...o });

  await t.test('部品側が空: 3項目すべて更新', async () => {
    const id = await part();
    const r = await applyPurchaseToPart(db, rec(), id);
    assert.deepEqual(r, { part_id: id, fields: { shop: '秋月', purchased_at: '2026-03-01', unit_price: 10 } });
    assert.deepEqual(await row(id), { shop: '秋月', purchased_at: '2026-03-01', unit_price: 10 });
  });

  await t.test('明細のほうが新しい: 上書き。変わらない項目は fields に含めない', async () => {
    const id = await part({ shop: '秋月', purchased_at: '2026-01-01', unit_price: 10 });
    const r = await applyPurchaseToPart(db, rec({ unit_price: 12 }), id);
    assert.deepEqual(r.fields, { purchased_at: '2026-03-01', unit_price: 12 });
  });

  await t.test('同じ日付: 上書きする（値が違う項目だけ）', async () => {
    const id = await part({ shop: 'Amazon', purchased_at: '2026-03-01', unit_price: 5 });
    const r = await applyPurchaseToPart(db, rec(), id);
    assert.deepEqual(r.fields, { shop: '秋月', unit_price: 10 });
  });

  await t.test('部品側のほうが新しい: 何も変えず null', async () => {
    const id = await part({ shop: 'Amazon', purchased_at: '2026-06-01', unit_price: 5 });
    assert.equal(await applyPurchaseToPart(db, rec(), id), null);
    assert.deepEqual(await row(id), { shop: 'Amazon', purchased_at: '2026-06-01', unit_price: 5 });
  });

  await t.test('外貨: unit_price は更新しない（shop と日付は更新）', async () => {
    const id = await part();
    const r = await applyPurchaseToPart(db, rec({ currency: 'USD', unit_price: 1.5 }), id);
    assert.deepEqual(r.fields, { shop: '秋月', purchased_at: '2026-03-01' });
    assert.equal((await row(id)).unit_price, null);
  });

  await t.test('unit_price が null: 単価は更新せず、既存の単価も消さない', async () => {
    const id = await part({ unit_price: 7 });
    const r = await applyPurchaseToPart(db, rec({ unit_price: null }), id);
    assert.deepEqual(r.fields, { shop: '秋月', purchased_at: '2026-03-01' });
    assert.equal((await row(id)).unit_price, 7);
  });

  await t.test('purchased_at が null: 部品側の空欄だけを埋める', async () => {
    const id = await part({ shop: 'Amazon' });
    const r = await applyPurchaseToPart(db, rec({ purchased_at: null }), id);
    assert.deepEqual(r.fields, { unit_price: 10 });
    assert.deepEqual(await row(id), { shop: 'Amazon', purchased_at: null, unit_price: 10 });
  });

  await t.test('purchased_at が null で部品側が埋まっている: null', async () => {
    const id = await part({ shop: 'A', unit_price: 1 });
    assert.equal(await applyPurchaseToPart(db, rec({ purchased_at: null }), id), null);
  });

  await t.test('ゴミ箱の部品・存在しない部品: 何もせず null', async () => {
    const id = await part();
    await db.run("UPDATE parts SET deleted_at = '2026-01-01' WHERE id = ?", [id]);
    assert.equal(await applyPurchaseToPart(db, rec(), id), null);
    assert.equal((await row(id)).shop, null);
    assert.equal(await applyPurchaseToPart(db, rec(), 9999), null);
  });

  await t.test('変更なし: null', async () => {
    const id = await part({ shop: '秋月', purchased_at: '2026-03-01', unit_price: 10 });
    assert.equal(await applyPurchaseToPart(db, rec(), id), null);
  });
});

test('ひも付け候補 API (PS-1 〜)', async (t) => {
  let server, baseUrl, db, uploadDir, prevUploadDir;

  t.before(async () => {
    db = await createTestDb();
    require('../database').getDb = () => db;
    prevUploadDir = process.env.UPLOAD_DIR;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epm-suggest-'));
    uploadDir = path.join(tmpRoot, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    process.env.UPLOAD_DIR = uploadDir;

    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/purchases', require('../routes/purchases'));
    app.use('/api/parts', require('../routes/parts'));
    app.use('/api/backup', require('../routes/backup'));
    server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  });

  t.after(async () => {
    if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = prevUploadDir;
    if (uploadDir) fs.rmSync(path.dirname(uploadDir), { recursive: true, force: true });
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  t.beforeEach(async () => {
    await db.run('DELETE FROM purchase_records');
    await db.run('DELETE FROM purchase_import_batches');
    await db.run('DELETE FROM purchase_import_changes');
    await db.run('DELETE FROM parts');
  });

  const send = (method, p, body) => fetch(`${baseUrl}${p}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const insertPart = async (name = '部品', f = {}) => (await db.run(
    `INSERT INTO parts (name, quantity, shop, purchased_at, unit_price) VALUES (?, 1, ?, ?, ?)`,
    [name, f.shop ?? null, f.purchased_at ?? null, f.unit_price ?? null]
  )).lastID;
  const rec = (o = {}) => ({
    shop: '秋月', order_id: 'A-1', line_no: 1, purchased_at: '2026-03-01',
    name: 'LED', unit_price: 10, currency: 'JPY', quantity: 5, ...o
  });
  const importOne = async (o = {}) => {
    const r = await (await send('POST', '/purchases/import', [rec(o)])).json();
    assert.equal(r.errors, 0, JSON.stringify(r));
    return r.results[0].id;
  };
  const getRow = (id) => db.get('SELECT * FROM purchase_records WHERE id = ?', [id]);

  await t.test('PS-1: link_status の3種類と不正な値、linked との AND', async () => {
    const p = await insertPart('LED');
    const linked = await importOne({ line_no: 1, part_id: p });
    const sugg = await importOne({ line_no: 2, suggested_part_id: p });
    const plain = await importOne({ line_no: 3 });
    const ids = async (q) => (await (await fetch(`${baseUrl}/purchases?${q}`)).json()).items.map(i => i.id).sort();
    assert.deepEqual(await ids('link_status=linked'), [linked]);
    assert.deepEqual(await ids('link_status=unlinked'), [sugg, plain].sort());
    assert.deepEqual(await ids('link_status=suggested'), [sugg]);
    assert.deepEqual(await ids('link_status=suggested&linked=false'), [sugg]);
    assert.deepEqual(await ids('link_status=suggested&linked=true'), []);
    assert.equal((await fetch(`${baseUrl}/purchases?link_status=foo`)).status, 400);
  });

  await t.test('PS-2: 一覧に suggested_part_id / suggestion_note / suggested_part_name が付く', async () => {
    const p = await insertPart('赤色LED');
    const id = await importOne({ suggested_part_id: p, suggestion_note: '型番が近い' });
    const item = (await (await fetch(`${baseUrl}/purchases`)).json()).items.find(i => i.id === id);
    assert.equal(item.suggested_part_id, p);
    assert.equal(item.suggestion_note, '型番が近い');
    assert.equal(item.suggested_part_name, '赤色LED');
    assert.equal(item.part_name, null);
    const plain = await importOne({ line_no: 9 });
    const pi = (await (await fetch(`${baseUrl}/purchases/${plain}`)).json());
    assert.equal(pi.suggested_part_name, null);
  });

  await t.test('PS-3: PATCH で候補の設定・消去、存在しない部品は 400、長すぎるメモは 400', async () => {
    const p = await insertPart('LED');
    const id = await importOne();
    let res = await send('PATCH', `/purchases/${id}`, { suggested_part_id: p, suggestion_note: '理由' });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.suggested_part_id, p);
    assert.equal(body.suggested_part_name, 'LED');
    assert.equal(body.part_updated, null);

    assert.equal((await send('PATCH', `/purchases/${id}`, { suggested_part_id: 9999 })).status, 400);
    assert.equal((await send('PATCH', `/purchases/${id}`, { suggestion_note: 'a'.repeat(1001) })).status, 400);
    assert.equal((await send('PATCH', `/purchases/${id}`, { suggestion_note: 'a'.repeat(1000) })).status, 200);

    res = await send('PATCH', `/purchases/${id}`, { suggested_part_id: null, suggestion_note: null });
    body = await res.json();
    assert.equal(body.suggested_part_id, null);
    assert.equal(body.suggestion_note, null);
  });

  await t.test('PS-4: part_id を設定すると候補が消え、部品側が更新されて part_updated が返る', async () => {
    const p = await insertPart('LED');
    const id = await importOne({ suggested_part_id: p, suggestion_note: '理由' });
    const res = await send('PATCH', `/purchases/${id}`, { part_id: p });
    const body = await res.json();
    assert.equal(body.part_id, p);
    assert.equal(body.suggested_part_id, null);
    assert.equal(body.suggestion_note, null);
    assert.deepEqual(body.part_updated, { part_id: p, fields: { shop: '秋月', purchased_at: '2026-03-01', unit_price: 10 } });
    const part = await db.get('SELECT shop, purchased_at, unit_price FROM parts WHERE id = ?', [p]);
    assert.deepEqual(part, { shop: '秋月', purchased_at: '2026-03-01', unit_price: 10 });
  });

  await t.test('PS-5: 同じ part_id の再設定や解除、無関係な項目の PATCH では part_updated は null', async () => {
    const p = await insertPart('LED');
    const id = await importOne({ part_id: p });
    assert.equal((await (await send('PATCH', `/purchases/${id}`, { part_id: p })).json()).part_updated, null);
    assert.equal((await (await send('PATCH', `/purchases/${id}`, { note: 'x' })).json()).part_updated, null);
    const un = await (await send('PATCH', `/purchases/${id}`, { part_id: null })).json();
    assert.equal(un.part_id, null);
    assert.equal(un.part_updated, null);
  });

  await t.test('PS-6: 付け替えでも新しい部品の購入情報を更新する', async () => {
    const a = await insertPart('A');
    const b = await insertPart('B', { purchased_at: '2026-01-01', shop: 'X' });
    const id = await importOne({ part_id: a });
    const body = await (await send('PATCH', `/purchases/${id}`, { part_id: b })).json();
    assert.equal(body.part_updated.part_id, b);
    assert.equal((await db.get('SELECT shop FROM parts WHERE id = ?', [b])).shop, '秋月');
  });

  await t.test('PS-7: approve-suggestion 正常系: part_id が入り候補が消え、part_updated が返る', async () => {
    const p = await insertPart('LED');
    const id = await importOne({ suggested_part_id: p, suggestion_note: '理由' });
    const res = await send('POST', `/purchases/${id}/approve-suggestion`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.record.part_id, p);
    assert.equal(body.record.part_name, 'LED');
    assert.equal(body.record.suggested_part_id, null);
    assert.equal(body.record.suggestion_note, null);
    assert.equal(body.part_updated.part_id, p);
    assert.equal((await db.get('SELECT unit_price FROM parts WHERE id = ?', [p])).unit_price, 10);
  });

  await t.test('PS-8: approve-suggestion の 409（候補なし・ひも付け済み・部品なし／ゴミ箱）と 404・400', async () => {
    const p = await insertPart('LED');
    const none = await importOne({ line_no: 1 });
    assert.equal((await send('POST', `/purchases/${none}/approve-suggestion`)).status, 409);

    const linked = await importOne({ line_no: 2, part_id: p, suggested_part_id: p });
    assert.equal((await send('POST', `/purchases/${linked}/approve-suggestion`)).status, 409);

    const gone = await insertPart('消える');
    const ghost = await importOne({ line_no: 3, suggested_part_id: gone, suggestion_note: 'n' });
    await db.run('DELETE FROM parts WHERE id = ?', [gone]);
    let res = await send('POST', `/purchases/${ghost}/approve-suggestion`);
    assert.equal(res.status, 409);
    // 候補は消さない
    assert.equal((await getRow(ghost)).suggested_part_id, gone);

    const trash = await insertPart('ゴミ箱');
    const t1 = await importOne({ line_no: 4, suggested_part_id: trash });
    await db.run("UPDATE parts SET deleted_at = '2026-01-01' WHERE id = ?", [trash]);
    res = await send('POST', `/purchases/${t1}/approve-suggestion`);
    assert.equal(res.status, 409);
    assert.equal((await getRow(t1)).part_id, null);

    assert.equal((await send('POST', '/purchases/99999/approve-suggestion')).status, 404);
    assert.equal((await send('POST', '/purchases/abc/approve-suggestion')).status, 400);
  });

  await t.test('PS-9: reject-suggestion: 候補が消える。候補なしは 409、明細なしは 404', async () => {
    const p = await insertPart('LED');
    const id = await importOne({ suggested_part_id: p, suggestion_note: 'n' });
    const res = await send('POST', `/purchases/${id}/reject-suggestion`);
    assert.equal(res.status, 200);
    const { record } = await res.json();
    assert.equal(record.suggested_part_id, null);
    assert.equal(record.suggestion_note, null);
    assert.equal(record.part_id, null);
    assert.equal((await send('POST', `/purchases/${id}/reject-suggestion`)).status, 409);
    assert.equal((await send('POST', '/purchases/99999/reject-suggestion')).status, 404);
  });

  await t.test('PS-10: approve-suggestions: 一部失敗でも続行し、/:id に吸われない', async () => {
    const p = await insertPart('LED');
    const ok1 = await importOne({ line_no: 1, suggested_part_id: p });
    const ok2 = await importOne({ line_no: 2, suggested_part_id: p });
    const bad = await importOne({ line_no: 3 });
    const res = await send('POST', '/purchases/approve-suggestions', { ids: [ok1, bad, ok2, 99999] });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.approved, 2);
    assert.equal(body.failed, 2);
    assert.deepEqual(body.results.map(r => [r.id, r.status]), [[ok1, 'approved'], [bad, 'error'], [ok2, 'approved'], [99999, 'error']]);
    assert.equal(typeof body.results[1].error, 'string');
    assert.equal(body.results[0].part_updated.part_id, p);
    assert.equal(body.results[2].part_updated, null); // すでに最新
    assert.equal((await getRow(ok1)).part_id, p);
    assert.equal((await getRow(bad)).part_id, null);
  });

  await t.test('PS-11: approve-suggestions の入力検証（空・501件・非整数）', async () => {
    for (const body of [{}, { ids: [] }, { ids: 'x' }, { ids: Array.from({ length: 501 }, (_, i) => i + 1) }, { ids: [1, 'a'] }, { ids: [0] }]) {
      assert.equal((await send('POST', '/purchases/approve-suggestions', body)).status, 400, JSON.stringify(body).slice(0, 40));
    }
    const p = await insertPart('LED');
    const id = await importOne({ suggested_part_id: p });
    const res = await send('POST', '/purchases/approve-suggestions', { ids: Array.from({ length: 500 }, () => id) });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.approved, 1);
    assert.equal(b.failed, 499);
  });

  await t.test('PS-12: import は候補を受け付け、部品側を更新しない。存在しない候補は NULL + warning', async () => {
    const p = await insertPart('LED');
    const r = await (await send('POST', '/purchases/import', [
      rec({ line_no: 1, suggested_part_id: p, suggestion_note: '理由' }),
      rec({ line_no: 2, part_id: p }),
      rec({ line_no: 3, suggested_part_id: 9999, suggestion_note: '孤児' })
    ])).json();
    assert.equal(r.created, 3);
    assert.equal(r.results[2].warning.includes('suggested_part_id 9999'), true);
    const rows = await db.all('SELECT line_no, part_id, suggested_part_id, suggestion_note FROM purchase_records ORDER BY line_no');
    assert.deepEqual(rows[0], { line_no: 1, part_id: null, suggested_part_id: p, suggestion_note: '理由' });
    assert.equal(rows[2].suggested_part_id, null);
    assert.equal(rows[2].suggestion_note, null);
    assert.deepEqual(await db.get('SELECT shop, purchased_at, unit_price FROM parts WHERE id = ?', [p]),
      { shop: null, purchased_at: null, unit_price: null });
  });

  await t.test('PS-13: on_duplicate=update で候補を上書き・null で消去できる。存在しない候補は既存を維持', async () => {
    const p = await insertPart('LED');
    const q = await insertPart('抵抗');
    await importOne({ suggested_part_id: p, suggestion_note: '旧' });
    let r = await (await send('POST', '/purchases/import', { on_duplicate: 'update', records: [rec({ suggested_part_id: q, suggestion_note: '新' })] })).json();
    assert.equal(r.updated, 1);
    let row = await db.get('SELECT suggested_part_id, suggestion_note FROM purchase_records');
    assert.deepEqual(row, { suggested_part_id: q, suggestion_note: '新' });

    r = await (await send('POST', '/purchases/import', { on_duplicate: 'update', records: [rec({ suggested_part_id: 9999, suggestion_note: '無視される' })] })).json();
    assert.ok(r.results[0].warning);
    assert.deepEqual(await db.get('SELECT suggested_part_id, suggestion_note FROM purchase_records'), { suggested_part_id: q, suggestion_note: '新' });

    await send('POST', '/purchases/import', { on_duplicate: 'update', records: [rec({ suggested_part_id: null, suggestion_note: null })] });
    row = await db.get('SELECT suggested_part_id, suggestion_note FROM purchase_records');
    assert.deepEqual(row, { suggested_part_id: null, suggestion_note: null });
  });

  await t.test('PS-14: 部品の完全削除で、候補の2列も NULL に戻る', async () => {
    const p = await insertPart('LED');
    const o = await insertPart('他');
    const a = await importOne({ line_no: 1, suggested_part_id: p, suggestion_note: 'n' });
    const b = await importOne({ line_no: 2, suggested_part_id: o, suggestion_note: 'm' });
    assert.equal((await send('DELETE', `/parts/${p}`)).status, 200);
    assert.equal((await send('DELETE', `/parts/${p}/permanent`)).status, 200);
    assert.deepEqual(await getRow(a).then(r => [r.suggested_part_id, r.suggestion_note]), [null, null]);
    assert.deepEqual(await getRow(b).then(r => [r.suggested_part_id, r.suggestion_note]), [o, 'm']);
  });

  await t.test('PS-15: undo で候補の列も元に戻る', async () => {
    const p = await insertPart('LED');
    await importOne({ suggested_part_id: p, suggestion_note: '元' });
    const r = await (await send('POST', '/purchases/import', { on_duplicate: 'update', records: [rec({ suggested_part_id: null, suggestion_note: null, quantity: 9 })] })).json();
    const row = await db.get('SELECT suggested_part_id FROM purchase_records');
    assert.equal(row.suggested_part_id, null);
    const res = await send('POST', `/purchases/batches/${r.batch_id}/undo`, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await db.get('SELECT suggested_part_id, suggestion_note, quantity FROM purchase_records'),
      { suggested_part_id: p, suggestion_note: '元', quantity: 5 });
  });

  await t.test('PS-16: バックアップの往復で候補の列が戻る', async () => {
    const p = await insertPart('LED');
    await importOne({ suggested_part_id: p, suggestion_note: '往復' });
    const before = await db.all('SELECT * FROM purchase_records ORDER BY id');
    const exportRes = await fetch(`${baseUrl}/backup/export/full`);
    const zipBuffer = Buffer.from(await exportRes.arrayBuffer());
    const dump = JSON.parse(new AdmZip(zipBuffer).getEntry('backup_data.json').getData().toString('utf8'));
    assert.equal(dump.purchaseRecords[0].suggestion_note, '往復');
    await db.run('DELETE FROM purchase_records');
    const form = new FormData();
    form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'backup.zip');
    const res = await fetch(`${baseUrl}/backup/import/full`, { method: 'POST', body: form });
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual(await db.all('SELECT * FROM purchase_records ORDER BY id'), before);
  });
  await t.test('PS-17: ひも付け済みの明細に候補は設定できない（400）。解除と同時なら設定できる', async () => {
    const p = await insertPart('LED');
    const q = await insertPart('抵抗');
    const id = await importOne({ part_id: p });
    let res = await send('PATCH', `/purchases/${id}`, { suggested_part_id: q, suggestion_note: '理由' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'ひも付け済みの明細には候補を設定できません');
    // part_id を同じ値で送っても、候補があれば 400（新しいひも付けではない）
    assert.equal((await send('PATCH', `/purchases/${id}`, { part_id: p, suggested_part_id: q })).status, 400);
    let row = await getRow(id);
    assert.equal(row.suggested_part_id, null);
    // 候補の消去（null）やメモだけの更新は通る
    assert.equal((await send('PATCH', `/purchases/${id}`, { suggested_part_id: null })).status, 200);
    assert.equal((await send('PATCH', `/purchases/${id}`, { note: 'x' })).status, 200);
    // 解除と同時に候補を設定する
    res = await send('PATCH', `/purchases/${id}`, { part_id: null, suggested_part_id: q });
    assert.equal(res.status, 200);
    row = await getRow(id);
    assert.equal(row.part_id, null);
    assert.equal(row.suggested_part_id, q);
    // 解除済みなら候補を設定できる
    assert.equal((await send('PATCH', `/purchases/${id}`, { suggested_part_id: p })).status, 200);
    // 新しくひも付けるときは、同時に送った候補も消える（400 にならない）
    res = await send('PATCH', `/purchases/${id}`, { part_id: q, suggested_part_id: p });
    assert.equal(res.status, 200);
    row = await getRow(id);
    assert.equal(row.part_id, q);
    assert.equal(row.suggested_part_id, null);
  });

  await t.test('PS-18: import は part_id と候補が両方ある明細の候補を無視して warning を付ける', async () => {
    const p = await insertPart('LED');
    const q = await insertPart('抵抗');
    const r = await (await send('POST', '/purchases/import', [
      rec({ line_no: 1, part_id: p, suggested_part_id: q, suggestion_note: '理由' })
    ])).json();
    assert.equal(r.created, 1);
    assert.match(r.results[0].warning, /suggested_part_id/);
    assert.deepEqual(await db.get('SELECT part_id, suggested_part_id, suggestion_note FROM purchase_records'),
      { part_id: p, suggested_part_id: null, suggestion_note: null });

    // on_duplicate=update: ひも付け済みの既存行に候補だけを送っても無視する
    const r2 = await (await send('POST', '/purchases/import', {
      on_duplicate: 'update', records: [rec({ line_no: 1, suggested_part_id: q, suggestion_note: '無視' })]
    })).json();
    assert.equal(r2.updated, 1);
    assert.match(r2.results[0].warning, /suggested_part_id/);
    assert.deepEqual(await db.get('SELECT part_id, suggested_part_id, suggestion_note FROM purchase_records'),
      { part_id: p, suggested_part_id: null, suggestion_note: null });

    // 候補つきの未ひも付け行に part_id を送る update は、候補を消す
    const id = await importOne({ line_no: 2, suggested_part_id: q, suggestion_note: '旧' });
    await send('POST', '/purchases/import', { on_duplicate: 'update', records: [rec({ line_no: 2, part_id: p })] });
    assert.deepEqual(await getRow(id).then(x => [x.part_id, x.suggested_part_id, x.suggestion_note]), [p, null, null]);
  });

  await t.test('PS-19: ゴミ箱の部品は候補の名前に出ず、承認は専用の文言で 409。却下はできる', async () => {
    const trash = await insertPart('ゴミ箱の部品');
    const id = await importOne({ suggested_part_id: trash, suggestion_note: 'n' });
    await db.run("UPDATE parts SET deleted_at = '2026-01-01' WHERE id = ?", [trash]);

    const item = await (await fetch(`${baseUrl}/purchases/${id}`)).json();
    assert.equal(item.suggested_part_id, trash);
    assert.equal(item.suggested_part_name, null);
    const list = (await (await fetch(`${baseUrl}/purchases`)).json()).items.find(i => i.id === id);
    assert.equal(list.suggested_part_name, null);

    let res = await send('POST', `/purchases/${id}/approve-suggestion`);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, `候補の部品（id: ${trash}）はゴミ箱にあります`);

    // 部品が存在しない場合は従来の文言
    await db.run('DELETE FROM parts WHERE id = ?', [trash]);
    res = await send('POST', `/purchases/${id}/approve-suggestion`);
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /見つかりません/);

    assert.equal((await send('POST', `/purchases/${id}/reject-suggestion`)).status, 200);
  });

  await t.test('PS-20: 承認の途中で失敗したら、明細の更新も戻る（トランザクション）', async () => {
    const p = await insertPart('LED');
    const id = await importOne({ suggested_part_id: p, suggestion_note: 'n' });
    // 部品の UPDATE だけを失敗させる
    await db.run(`CREATE TRIGGER fail_part_update BEFORE UPDATE ON parts BEGIN SELECT RAISE(ABORT, 'forced'); END`);
    try {
      const res = await send('POST', `/purchases/${id}/approve-suggestion`);
      assert.equal(res.status, 500);
    } finally {
      await db.run('DROP TRIGGER fail_part_update');
    }
    const row = await getRow(id);
    assert.equal(row.part_id, null);
    assert.equal(row.suggested_part_id, p);
    assert.equal(row.suggestion_note, 'n');
    // 失敗後も直列キューは止まらず、次の承認が通る
    assert.equal((await send('POST', `/purchases/${id}/approve-suggestion`)).status, 200);
  });
});
