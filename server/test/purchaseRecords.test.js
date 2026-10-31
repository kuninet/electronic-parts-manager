const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { createTestDb } = require('./testHelper');
const {
  normalizePurchaseRecord,
  buildDedupeKey
} = require('../utils/purchaseRecord');

test('purchaseRecord 正規化関数 (PR-U)', async (t) => {
  await t.test('normalizePurchaseRecord: 最小の入力は未指定項目が null、currency は JPY になる', () => {
    const r = normalizePurchaseRecord({ shop: '秋月電子通商', name: 'LED', order_id: 'A1' });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.value, {
      shop: '秋月電子通商',
      order_id: 'A1',
      line_no: null,
      purchased_at: null,
      code: null,
      name: 'LED',
      unit_price: null,
      currency: 'JPY',
      quantity: null,
      part_id: null,
      source_msg_id: null,
      note: null
    });
  });

  await t.test('shop: 必須、改行・タブは空白にして trim、100文字まで', () => {
    assert.equal(normalizePurchaseRecord({ name: 'x' }).error, 'shop は必須です');
    assert.equal(normalizePurchaseRecord({ shop: '  ', name: 'x' }).error, 'shop は必須です');
    assert.equal(normalizePurchaseRecord({ shop: null, name: 'x' }).error, 'shop は必須です');
    assert.equal(normalizePurchaseRecord({ shop: ' 秋月\n電子\t通商 ', name: 'x' }).value.shop, '秋月 電子 通商');
    assert.equal(normalizePurchaseRecord({ shop: 'a'.repeat(100), name: 'x' }).error, undefined);
    assert.match(normalizePurchaseRecord({ shop: 'a'.repeat(101), name: 'x' }).error, /shop/);
  });

  await t.test('name: 必須、trim、500文字まで', () => {
    assert.equal(normalizePurchaseRecord({ shop: 'S' }).error, 'name は必須です');
    assert.equal(normalizePurchaseRecord({ shop: 'S', name: '   ' }).error, 'name は必須です');
    assert.equal(normalizePurchaseRecord({ shop: 'S', name: ' LED ' }).value.name, 'LED');
    assert.equal(normalizePurchaseRecord({ shop: 'S', name: 'a'.repeat(500) }).error, undefined);
    assert.match(normalizePurchaseRecord({ shop: 'S', name: 'a'.repeat(501) }).error, /name/);
  });

  await t.test('order_id: 数値は文字列化、空と null は null、100文字まで', () => {
    const base = { shop: 'S', name: 'x' };
    assert.equal(normalizePurchaseRecord({ ...base, order_id: 12345 }).value.order_id, '12345');
    assert.equal(normalizePurchaseRecord({ ...base, order_id: ' A-1 ' }).value.order_id, 'A-1');
    assert.equal(normalizePurchaseRecord({ ...base, order_id: '' }).value.order_id, null);
    assert.equal(normalizePurchaseRecord({ ...base, order_id: null }).value.order_id, null);
    assert.match(normalizePurchaseRecord({ ...base, order_id: 'a'.repeat(101) }).error, /order_id/);
    assert.match(normalizePurchaseRecord({ ...base, order_id: {} }).error, /order_id/);
  });

  await t.test('line_no / quantity: 0以上の整数の境界', () => {
    const base = { shop: 'S', name: 'x' };
    for (const f of ['line_no', 'quantity']) {
      assert.equal(normalizePurchaseRecord({ ...base, [f]: 0 }).value[f], 0);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: 3 }).value[f], 3);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: '4' }).value[f], 4);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: '' }).value[f], null);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: null }).value[f], null);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: -1 }).error, `${f} は0以上の整数で指定してください`);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: 1.5 }).error, `${f} は0以上の整数で指定してください`);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: '1.5' }).error, `${f} は0以上の整数で指定してください`);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: '-1' }).error, `${f} は0以上の整数で指定してください`);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: 'abc' }).error, `${f} は0以上の整数で指定してください`);
      assert.equal(normalizePurchaseRecord({ ...base, [f]: true }).error, `${f} は0以上の整数で指定してください`);
    }
  });

  await t.test('purchased_at: 実在する YYYY-MM-DD のみ（エラー文言は注文日）', () => {
    const base = { shop: 'S', name: 'x' };
    assert.equal(normalizePurchaseRecord({ ...base, purchased_at: '2026-03-01' }).value.purchased_at, '2026-03-01');
    assert.equal(normalizePurchaseRecord({ ...base, purchased_at: null }).value.purchased_at, null);
    const msg = '注文日は YYYY-MM-DD 形式で指定してください';
    assert.equal(normalizePurchaseRecord({ ...base, purchased_at: '2026-02-30' }).error, msg);
    assert.equal(normalizePurchaseRecord({ ...base, purchased_at: '2026/03/01' }).error, msg);
  });

  await t.test('unit_price: 0以上の数値、数値文字列は小数のみ許可', () => {
    const base = { shop: 'S', name: 'x' };
    assert.equal(normalizePurchaseRecord({ ...base, unit_price: 0 }).value.unit_price, 0);
    assert.equal(normalizePurchaseRecord({ ...base, unit_price: '12.5' }).value.unit_price, 12.5);
    assert.equal(normalizePurchaseRecord({ ...base, unit_price: null }).value.unit_price, null);
    assert.match(normalizePurchaseRecord({ ...base, unit_price: -1 }).error, /unit_price/);
    assert.match(normalizePurchaseRecord({ ...base, unit_price: '1e3' }).error, /unit_price/);
    assert.match(normalizePurchaseRecord({ ...base, unit_price: 1e9 + 1 }).error, /unit_price/);
  });

  await t.test('currency: 既定 JPY、trim して大文字化、3文字の英字のみ', () => {
    const base = { shop: 'S', name: 'x' };
    assert.equal(normalizePurchaseRecord(base).value.currency, 'JPY');
    assert.equal(normalizePurchaseRecord({ ...base, currency: null }).value.currency, 'JPY');
    assert.equal(normalizePurchaseRecord({ ...base, currency: '' }).value.currency, 'JPY');
    assert.equal(normalizePurchaseRecord({ ...base, currency: ' usd ' }).value.currency, 'USD');
    assert.match(normalizePurchaseRecord({ ...base, currency: 'US' }).error, /currency/);
    assert.match(normalizePurchaseRecord({ ...base, currency: 'US1' }).error, /currency/);
    assert.match(normalizePurchaseRecord({ ...base, currency: 'DOLLAR' }).error, /currency/);
    assert.match(normalizePurchaseRecord({ ...base, currency: 1 }).error, /currency/);
  });

  await t.test('part_id: 正の整数または null', () => {
    const base = { shop: 'S', name: 'x' };
    assert.equal(normalizePurchaseRecord({ ...base, part_id: 5 }).value.part_id, 5);
    assert.equal(normalizePurchaseRecord({ ...base, part_id: null }).value.part_id, null);
    assert.match(normalizePurchaseRecord({ ...base, part_id: 0 }).error, /part_id/);
    assert.match(normalizePurchaseRecord({ ...base, part_id: -2 }).error, /part_id/);
    assert.match(normalizePurchaseRecord({ ...base, part_id: 1.2 }).error, /part_id/);
  });

  await t.test('code / source_msg_id / note: trim、空は null、長さの上限', () => {
    const base = { shop: 'S', name: 'x' };
    assert.equal(normalizePurchaseRecord({ ...base, code: ' C-1 ' }).value.code, 'C-1');
    assert.equal(normalizePurchaseRecord({ ...base, code: '' }).value.code, null);
    assert.match(normalizePurchaseRecord({ ...base, code: 'a'.repeat(101) }).error, /code/);
    assert.match(normalizePurchaseRecord({ ...base, source_msg_id: 'a'.repeat(201) }).error, /source_msg_id/);
    assert.equal(normalizePurchaseRecord({ ...base, source_msg_id: 'a'.repeat(200) }).error, undefined);
    assert.equal(normalizePurchaseRecord({ ...base, note: 'a'.repeat(2000) }).error, undefined);
    assert.match(normalizePurchaseRecord({ ...base, note: 'a'.repeat(2001) }).error, /note/);
  });

  await t.test('任意項目の文字列 "null"（大文字小文字不問・前後空白可）は null になる', () => {
    const r = normalizePurchaseRecord({
      shop: 'S', name: 'x',
      order_id: 'null', line_no: ' NULL ', purchased_at: 'Null', code: 'Null', unit_price: 'null',
      currency: 'null', quantity: 'nUll', part_id: 'null', source_msg_id: ' null ', note: 'NULL'
    });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.value, {
      shop: 'S', order_id: null, line_no: null, purchased_at: null, code: null, name: 'x',
      unit_price: null, currency: 'JPY', quantity: null, part_id: null, source_msg_id: null, note: null
    });
    // 必須項目の shop は null 扱いになりエラー
    assert.equal(normalizePurchaseRecord({ shop: 'null', name: 'x' }).error, 'shop は必須です');
    // partial でも null として含まれる
    assert.deepEqual(normalizePurchaseRecord({ order_id: 'null', part_id: 'NULL' }, { partial: true }).value, { order_id: null, part_id: null });
  });

  await t.test('オブジェクト以外の入力はエラー', () => {
    assert.ok(normalizePurchaseRecord(null).error);
    assert.ok(normalizePurchaseRecord('x').error);
    assert.ok(normalizePurchaseRecord([]).error);
  });

  await t.test('partial: 未送信の項目は value に含まれず、currency も補わない', () => {
    assert.deepEqual(normalizePurchaseRecord({ note: 'メモ' }, { partial: true }).value, { note: 'メモ' });
    assert.deepEqual(normalizePurchaseRecord({}, { partial: true }).value, {});
    assert.deepEqual(
      normalizePurchaseRecord({ part_id: null, currency: null, quantity: '' }, { partial: true }).value,
      { part_id: null, currency: 'JPY', quantity: null }
    );
  });

  await t.test('partial: shop / name は送るなら必須（null や空は不可）', () => {
    assert.equal(normalizePurchaseRecord({ shop: null }, { partial: true }).error, 'shop は必須です');
    assert.equal(normalizePurchaseRecord({ name: '' }, { partial: true }).error, 'name は必須です');
    assert.deepEqual(normalizePurchaseRecord({ shop: ' A ' }, { partial: true }).value, { shop: 'A' });
  });

  await t.test('buildDedupeKey: order_id と line_no があれば o:|l:', () => {
    assert.deepEqual(buildDedupeKey({ order_id: 'A1', line_no: 2, name: 'x', source_msg_id: 'm1' }), { value: 'o:A1|l:2' });
    assert.deepEqual(buildDedupeKey({ order_id: 'A1', line_no: 0, name: 'x' }), { value: 'o:A1|l:0' });
  });

  await t.test('buildDedupeKey: order_id のみなら o:|n:（name は NFKC・空白・小文字に正規化）', () => {
    assert.deepEqual(buildDedupeKey({ order_id: 'A1', line_no: null, name: 'ＬＥＤ　 Red\t5mm' }), { value: 'o:A1|n:led red 5mm' });
    assert.equal(
      buildDedupeKey({ order_id: 'A1', name: 'LED  red' }).value,
      buildDedupeKey({ order_id: 'A1', name: ' led RED ' }).value
    );
  });

  await t.test('buildDedupeKey: order_id がなく source_msg_id があれば m:|n:', () => {
    assert.deepEqual(buildDedupeKey({ order_id: null, line_no: 3, name: 'ABC', source_msg_id: 'msg1' }), { value: 'm:msg1|n:abc' });
  });

  await t.test('buildDedupeKey: order_id も source_msg_id もなければエラー', () => {
    assert.equal(
      buildDedupeKey({ order_id: null, line_no: 1, name: 'x', source_msg_id: null }).error,
      'order_id と source_msg_id のどちらかが必要です（重複判定に使います）'
    );
    assert.ok(buildDedupeKey({ name: 'x' }).error);
  });
});

test('購入履歴 API テスト (PR-1 〜)', async (t) => {
  let server;
  let baseUrl;
  let db;
  let uploadDir;
  let prevUploadDir;

  t.before(async () => {
    db = await createTestDb();

    const databaseModule = require('../database');
    databaseModule.getDb = () => db;

    // バックアップのテストで使うアップロード先（空の一時ディレクトリ）
    prevUploadDir = process.env.UPLOAD_DIR;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epm-purchases-'));
    uploadDir = path.join(tmpRoot, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    process.env.UPLOAD_DIR = uploadDir;

    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/purchases', require('../routes/purchases'));
    app.use('/api/parts', require('../routes/parts'));
    app.use('/api/backup', require('../routes/backup'));

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
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
    await db.run('DELETE FROM parts');
  });

  const send = (method, p, body) => fetch(`${baseUrl}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const importRecords = (body, query = '') => send('POST', `/purchases/import${query}`, body);
  const getJson = async (p) => (await fetch(`${baseUrl}${p}`)).json();

  async function insertPart(name = '部品', fields = {}) {
    const f = { name, quantity: 1, ...fields };
    const cols = Object.keys(f);
    const res = await db.run(
      `INSERT INTO parts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      Object.values(f)
    );
    return res.lastID;
  }

  const rec = (over = {}) => ({
    shop: '秋月電子通商',
    order_id: 'A-1',
    line_no: 1,
    purchased_at: '2026-03-01',
    code: 'I-001',
    name: 'LED',
    unit_price: 10,
    quantity: 5,
    ...over
  });

  await t.test('PR-1: 配列本文で取り込める（created と id が返る、currency 既定は JPY）', async () => {
    const res = await importRecords([rec(), rec({ line_no: 2, name: '抵抗' })]);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(body.created, 2);
    assert.equal(body.updated, 0);
    assert.equal(body.skipped, 0);
    assert.equal(body.errors, 0);
    assert.equal(body.results.length, 2);
    assert.deepEqual(body.results.map(r => r.status), ['created', 'created']);
    assert.equal(typeof body.results[0].id, 'number');

    const row = await db.get('SELECT * FROM purchase_records WHERE id = ?', [body.results[0].id]);
    assert.equal(row.currency, 'JPY');
    assert.equal(row.dedupe_key, 'o:A-1|l:1');
    assert.equal(row.unit_price, 10);
  });

  await t.test('PR-2: { records } 本文でも取り込める', async () => {
    const res = await importRecords({ records: [rec()] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).created, 1);
  });

  await t.test('PR-3: skip（既定）は重複を登録せず、既存の値も変えない', async () => {
    await importRecords([rec()]);
    const res = await importRecords([rec({ unit_price: 99, name: '別名' })]);
    const body = await res.json();
    assert.equal(body.created, 0);
    assert.equal(body.skipped, 1);
    assert.equal(body.results[0].status, 'skipped');
    const rows = await db.all('SELECT * FROM purchase_records');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].unit_price, 10);
    assert.equal(rows[0].name, 'LED');
  });

  await t.test('PR-4: update は送られた項目で上書きし、送られていない項目は残す', async () => {
    await importRecords([rec({ note: '元のメモ' })]);
    const res = await importRecords({ records: [{ shop: '秋月電子通商', order_id: 'A-1', line_no: 1, name: 'LED', unit_price: 20 }], on_duplicate: 'update' });
    const body = await res.json();
    assert.equal(body.updated, 1);
    assert.equal(body.created, 0);
    assert.equal(body.results[0].status, 'updated');
    const row = await db.get('SELECT * FROM purchase_records');
    assert.equal(row.unit_price, 20);
    assert.equal(row.note, '元のメモ');
    assert.equal(row.quantity, 5);
    assert.equal(row.purchased_at, '2026-03-01');
  });

  await t.test('PR-5: クエリ ?on_duplicate=update でも指定できる（配列本文）', async () => {
    await importRecords([rec()]);
    const res = await importRecords([rec({ quantity: 50 })], '?on_duplicate=update');
    assert.equal((await res.json()).updated, 1);
    assert.equal((await db.get('SELECT quantity FROM purchase_records')).quantity, 50);
  });

  await t.test('PR-6: on_duplicate が不正なら 400', async () => {
    const res = await importRecords({ records: [rec()], on_duplicate: 'replace' });
    assert.equal(res.status, 400);
  });

  await t.test('PR-7: 同じリクエスト内の重複は 2 件目以降が skipped、update なら updated', async () => {
    let res = await importRecords([rec(), rec({ unit_price: 77 })]);
    let body = await res.json();
    assert.deepEqual(body.results.map(r => r.status), ['created', 'skipped']);
    assert.equal(body.results[1].id, body.results[0].id);
    assert.equal((await db.get('SELECT unit_price FROM purchase_records')).unit_price, 10);

    await db.run('DELETE FROM purchase_records');
    res = await importRecords({ records: [rec(), rec({ unit_price: 77 })], on_duplicate: 'update' });
    body = await res.json();
    assert.deepEqual(body.results.map(r => r.status), ['created', 'updated']);
    assert.equal((await db.get('SELECT unit_price FROM purchase_records')).unit_price, 77);
  });

  await t.test('PR-8: 明細ごとのエラーは登録せず、ほかの明細は続行する', async () => {
    const res = await importRecords([
      rec({ line_no: 1 }),
      rec({ line_no: 2, unit_price: -5 }),
      rec({ line_no: 3, shop: '' }),
      rec({ line_no: 4, order_id: null }),
      'not an object',
      rec({ line_no: 5 })
    ]);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 6);
    assert.equal(body.created, 2);
    assert.equal(body.errors, 4);
    assert.deepEqual(body.results.map(r => r.status), ['created', 'error', 'error', 'error', 'error', 'created']);
    assert.match(body.results[1].error, /unit_price/);
    assert.equal(body.results[1].index, 1);
    assert.match(body.results[2].error, /shop/);
    assert.match(body.results[3].error, /order_id と source_msg_id/);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM purchase_records')).c, 2);
  });

  await t.test('PR-9: 存在しない part_id は NULL にして登録し、warning を付ける', async () => {
    const partId = await insertPart('LED');
    const res = await importRecords([rec({ line_no: 1, part_id: partId }), rec({ line_no: 2, part_id: 9999 })]);
    const body = await res.json();
    assert.equal(body.created, 2);
    assert.equal(body.results[0].warning, undefined);
    assert.match(body.results[1].warning, /part_id 9999 の部品が見つからない/);
    const rows = await db.all('SELECT line_no, part_id FROM purchase_records ORDER BY line_no');
    assert.equal(rows[0].part_id, partId);
    assert.equal(rows[1].part_id, null);
  });

  await t.test('PR-10: update で part_id が null / 未指定 / 存在しない値でも、既存のひも付けは消えない', async () => {
    const partId = await insertPart('LED');
    await importRecords([rec({ part_id: partId })]);

    for (const patch of [{}, { part_id: null }, { part_id: 9999 }]) {
      const res = await importRecords({ records: [rec({ unit_price: 11, ...patch })], on_duplicate: 'update' });
      assert.equal((await res.json()).updated, 1);
      const row = await db.get('SELECT part_id, unit_price FROM purchase_records');
      assert.equal(row.part_id, partId);
      assert.equal(row.unit_price, 11);
    }

    // 存在する別の部品を指定すれば付け替わる
    const other = await insertPart('抵抗');
    await importRecords({ records: [rec({ part_id: other })], on_duplicate: 'update' });
    assert.equal((await db.get('SELECT part_id FROM purchase_records')).part_id, other);
  });

  await t.test('PR-11: 5000件ちょうどは通り、5001件は 400', async () => {
    const make = (n) => Array.from({ length: n }, (_, i) => rec({ line_no: i + 1, order_id: 'BULK' }));
    let res = await importRecords(make(5001));
    assert.equal(res.status, 400);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM purchase_records')).c, 0);

    res = await importRecords(make(5000));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).created, 5000);
  });

  await t.test('PR-12: 本文が配列でも { records } でもなければ 400、空配列も 400', async () => {
    assert.equal((await importRecords({ foo: 1 })).status, 400);
    assert.equal((await importRecords([])).status, 400);
    assert.equal((await importRecords({ records: 'x' })).status, 400);
  });

  await t.test('PR-13: 外貨の単価と通貨をそのまま保存する', async () => {
    await importRecords([rec({ shop: 'Mouser', order_id: 'M-1', line_no: null, unit_price: 0.123, currency: 'usd' })]);
    const row = await db.get('SELECT currency, unit_price, dedupe_key FROM purchase_records');
    assert.equal(row.currency, 'USD');
    assert.equal(row.unit_price, 0.123);
    assert.equal(row.dedupe_key, 'o:M-1|n:led');
  });

  await t.test('PR-14: 同じ order_id でも shop が違えば別の明細になる', async () => {
    const body = await (await importRecords([rec(), rec({ shop: 'Amazon' })])).json();
    assert.equal(body.created, 2);
  });

  await t.test('PR-15: order_id が文字列 "null" の明細は order_id なしとして扱い、source_msg_id が違えば別の明細になる', async () => {
    const body = await (await importRecords([
      rec({ order_id: 'null', line_no: null, source_msg_id: 'm1' }),
      rec({ order_id: 'null', line_no: null, source_msg_id: 'm2' })
    ])).json();
    assert.equal(body.created, 2);
    assert.deepEqual(body.results.map(r => r.status), ['created', 'created']);
    const rows = await db.all('SELECT order_id, dedupe_key FROM purchase_records ORDER BY id');
    assert.deepEqual(rows, [
      { order_id: null, dedupe_key: 'm:m1|n:led' },
      { order_id: null, dedupe_key: 'm:m2|n:led' }
    ]);
  });

  await t.test('PR-16: import を並列に 2 本送っても、直列に処理されて両方 200 になる', async () => {
    const make = (prefix, n) => Array.from({ length: n }, (_, i) => rec({ order_id: prefix, line_no: i + 1 }));
    const [a, b] = await Promise.all([importRecords(make('PA', 300)), importRecords(make('PB', 300))]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const [ba, bb] = [await a.json(), await b.json()];
    assert.equal(ba.created, 300);
    assert.equal(bb.created, 300);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM purchase_records')).c, 600);
  });

  await t.test('PR-17: 同じリクエスト内の重複には、最初の index を示す warning が付く', async () => {
    const body = await (await importRecords([
      rec({ line_no: 1 }),
      rec({ line_no: 2, name: '抵抗' }),
      rec({ line_no: 1, unit_price: 77 }),
      rec({ line_no: 1, unit_price: 88 })
    ])).json();
    assert.deepEqual(body.results.map(r => r.status), ['created', 'created', 'skipped', 'skipped']);
    assert.equal(body.results[0].warning, undefined);
    assert.equal(body.results[1].warning, undefined);
    const msg = '同じリクエストの index 0 と同じ明細とみなしました（数量や単価が違う場合は line_no を付けてください）';
    assert.equal(body.results[2].warning, msg);
    assert.equal(body.results[3].warning, msg);

    // すでに登録済みの明細を再取り込みした場合（リクエスト内の重複ではない）は warning なし
    const again = await (await importRecords([rec({ line_no: 1 })])).json();
    assert.equal(again.results[0].status, 'skipped');
    assert.equal(again.results[0].warning, undefined);
  });

  await t.test('PR-18: update で存在しない part_id は無視し、既存のひも付けを維持する旨の warning を付ける', async () => {
    const partId = await insertPart('LED');
    await importRecords([rec({ part_id: partId })]);
    const body = await (await importRecords({ records: [rec({ part_id: 9999, quantity: 9 })], on_duplicate: 'update' })).json();
    assert.equal(body.results[0].status, 'updated');
    assert.equal(body.results[0].warning, 'part_id 9999 の部品が見つからないため無視しました（既存のひも付けは維持）');
    const row = await db.get('SELECT part_id, quantity FROM purchase_records');
    assert.equal(row.part_id, partId);
    assert.equal(row.quantity, 9);
  });

  await t.test('PR-19: update で currency が null や空なら既存の通貨を残し、値があれば上書きする', async () => {
    await importRecords([rec({ shop: 'Mouser', order_id: 'M-1', line_no: null, currency: 'USD', unit_price: 1.5 })]);
    for (const currency of [null, '', '  ']) {
      await importRecords({ records: [rec({ shop: 'Mouser', order_id: 'M-1', line_no: null, currency, unit_price: 2 })], on_duplicate: 'update' });
      const row = await db.get('SELECT currency, unit_price FROM purchase_records');
      assert.equal(row.currency, 'USD');
      assert.equal(row.unit_price, 2);
    }
    await importRecords({ records: [rec({ shop: 'Mouser', order_id: 'M-1', line_no: null, currency: 'eur' })], on_duplicate: 'update' });
    assert.equal((await db.get('SELECT currency FROM purchase_records')).currency, 'EUR');
  });

  await t.test('PR-19b: import の途中で例外が出ると ROLLBACK され、件数が増えず、後続の import は動く', async () => {
    let inserts = 0;
    db.run = async function (sql, ...args) {
      if (/^\s*INSERT INTO purchase_records/.test(sql) && ++inserts === 3) {
        throw new Error('boom');
      }
      return Object.getPrototypeOf(db).run.call(this, sql, ...args);
    };
    try {
      const res = await importRecords(Array.from({ length: 5 }, (_, i) => rec({ line_no: i + 1 })));
      assert.equal(res.status, 500);
      assert.equal((await res.json()).error, 'boom');
    } finally {
      delete db.run;
    }
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM purchase_records')).c, 0);

    // 失敗したあとでもキューは止まらず、トランザクションも残っていない
    const ok = await importRecords([rec({ line_no: 1 }), rec({ line_no: 2 })]);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).created, 2);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM purchase_records')).c, 2);
  });

  await t.test('PR-20: GET の絞り込み・並び・total・limit / offset・part_name', async () => {
    const partId = await insertPart('高輝度LED');
    await importRecords([
      rec({ shop: '秋月電子通商', order_id: 'A-1', line_no: 1, purchased_at: '2026-01-10', name: 'LED 赤', code: 'I-100', part_id: partId }),
      rec({ shop: '秋月電子通商', order_id: 'A-1', line_no: 2, purchased_at: '2026-01-10', name: '抵抗 1k', code: 'R-100' }),
      rec({ shop: 'Mouser', order_id: 'M-9', line_no: null, purchased_at: '2026-03-05', name: 'MCU', code: 'STM32', currency: 'USD', unit_price: 3.5 }),
      rec({ shop: 'Amazon', order_id: 'Z-5', line_no: null, purchased_at: null, name: 'ケーブル', code: null })
    ]);

    let body = await getJson('/purchases');
    assert.equal(body.total, 4);
    assert.equal(body.items.length, 4);
    // purchased_at の降順（2026-03-05 → 2026-01-10 → null）
    assert.deepEqual(body.items.map(i => i.name), ['MCU', 'LED 赤', '抵抗 1k', 'ケーブル']);
    const led = body.items.find(i => i.name === 'LED 赤');
    assert.equal(led.part_name, '高輝度LED');
    assert.equal(led.part_id, partId);
    assert.equal(body.items.find(i => i.name === 'MCU').part_name, null);

    body = await getJson('/purchases?linked=true');
    assert.deepEqual(body.items.map(i => i.name), ['LED 赤']);
    body = await getJson('/purchases?linked=false');
    assert.equal(body.total, 3);
    assert.equal(body.items.every(i => i.part_id === null), true);

    body = await getJson(`/purchases?part_id=${partId}`);
    assert.deepEqual(body.items.map(i => i.name), ['LED 赤']);

    body = await getJson('/purchases?shop=Mouser');
    assert.deepEqual(body.items.map(i => i.name), ['MCU']);
    body = await getJson('/purchases?shop=' + encodeURIComponent('秋月'));
    assert.equal(body.total, 0); // shop は完全一致

    body = await getJson('/purchases?order_id=A-1');
    assert.equal(body.total, 2);

    body = await getJson('/purchases?search=' + encodeURIComponent('抵抗'));
    assert.deepEqual(body.items.map(i => i.name), ['抵抗 1k']);
    body = await getJson('/purchases?search=STM32'); // code
    assert.deepEqual(body.items.map(i => i.name), ['MCU']);
    body = await getJson('/purchases?search=Z-5'); // order_id
    assert.deepEqual(body.items.map(i => i.name), ['ケーブル']);

    body = await getJson('/purchases?currency=usd');
    assert.deepEqual(body.items.map(i => i.name), ['MCU']);

    // from / to は両端を含む
    body = await getJson('/purchases?from=2026-01-10&to=2026-01-10');
    assert.equal(body.total, 2);
    body = await getJson('/purchases?from=2026-01-11');
    assert.deepEqual(body.items.map(i => i.name), ['MCU']);
    body = await getJson('/purchases?to=2026-03-05');
    assert.equal(body.total, 3);

    // limit / offset（total は全体件数）
    body = await getJson('/purchases?limit=2&offset=1');
    assert.equal(body.total, 4);
    assert.deepEqual(body.items.map(i => i.name), ['LED 赤', '抵抗 1k']);
  });

  await t.test('PR-21: GET の不正な絞り込みは 400', async () => {
    assert.equal((await fetch(`${baseUrl}/purchases?from=2026-13-01`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/purchases?to=abc`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/purchases?part_id=abc`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/purchases?linked=maybe`)).status, 400);
  });

  await t.test('PR-22: limit は最大 1000 に丸められ、省略時は 100 件', async () => {
    const records = Array.from({ length: 150 }, (_, i) => rec({ line_no: i + 1, order_id: 'L' }));
    await importRecords(records);
    let body = await getJson('/purchases');
    assert.equal(body.items.length, 100);
    assert.equal(body.total, 150);
    body = await getJson('/purchases?limit=99999');
    assert.equal(body.items.length, 150);
  });

  await t.test('PR-23: /shops は /:id に吸われず、件数の多い順で返る', async () => {
    await importRecords([
      rec({ shop: 'Mouser', order_id: 'M1', line_no: null }),
      rec({ shop: '秋月電子通商', line_no: 1 }),
      rec({ shop: '秋月電子通商', line_no: 2 })
    ]);
    const res = await fetch(`${baseUrl}/purchases/shops`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [
      { name: '秋月電子通商', count: 2 },
      { name: 'Mouser', count: 1 }
    ]);
  });

  await t.test('PR-24: GET /:id は 1 件を返し、無ければ 404、不正な ID は 400', async () => {
    const partId = await insertPart('LED');
    const { results } = await (await importRecords([rec({ part_id: partId })])).json();
    const res = await fetch(`${baseUrl}/purchases/${results[0].id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'LED');
    assert.equal(body.part_name, 'LED');
    assert.equal((await fetch(`${baseUrl}/purchases/99999`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/purchases/abc`)).status, 400);
  });

  await t.test('PR-30: PATCH でひも付けと解除ができる', async () => {
    const partId = await insertPart('抵抗');
    const { results } = await (await importRecords([rec()])).json();
    const id = results[0].id;

    let res = await send('PATCH', `/purchases/${id}`, { part_id: partId });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.part_id, partId);
    assert.equal(body.part_name, '抵抗');

    res = await send('PATCH', `/purchases/${id}`, { part_id: null });
    body = await res.json();
    assert.equal(body.part_id, null);
    assert.equal(body.part_name, null);
  });

  await t.test('PR-31: PATCH で存在しない part_id は 400', async () => {
    const { results } = await (await importRecords([rec()])).json();
    const res = await send('PATCH', `/purchases/${results[0].id}`, { part_id: 9999 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /part_id 9999/);
  });

  await t.test('PR-32: PATCH は送った項目だけ更新し、dedupe_key の材料でなければキーは変わらない', async () => {
    const { results } = await (await importRecords([rec()])).json();
    const id = results[0].id;
    const res = await send('PATCH', `/purchases/${id}`, { note: 'メモ', unit_price: 12.5, quantity: 0, currency: 'eur' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.note, 'メモ');
    assert.equal(body.unit_price, 12.5);
    assert.equal(body.quantity, 0);
    assert.equal(body.currency, 'EUR');
    assert.equal(body.name, 'LED');
    assert.equal(body.dedupe_key, 'o:A-1|l:1');
  });

  await t.test('PR-33: PATCH でキーの材料を変えるとキーが作り直され、他の行とぶつかれば 409', async () => {
    const { results } = await (await importRecords([rec({ line_no: 1 }), rec({ line_no: 2, name: '抵抗' })])).json();
    const [a, b] = results.map(r => r.id);

    let res = await send('PATCH', `/purchases/${b}`, { line_no: 1 });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, `同じ明細がすでにあります（id: ${a}）`);
    assert.equal((await db.get('SELECT line_no FROM purchase_records WHERE id = ?', [b])).line_no, 2);

    res = await send('PATCH', `/purchases/${b}`, { line_no: 3 });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).dedupe_key, 'o:A-1|l:3');

    // shop を変えればぶつからない
    res = await send('PATCH', `/purchases/${b}`, { shop: 'Amazon', line_no: 1 });
    assert.equal(res.status, 200);

    // order_id を外して source_msg_id もなければ 400
    res = await send('PATCH', `/purchases/${a}`, { order_id: null });
    assert.equal(res.status, 400);
    res = await send('PATCH', `/purchases/${a}`, { order_id: null, source_msg_id: 'msg-1' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).dedupe_key, 'm:msg-1|n:led');
  });

  await t.test('PR-34: PATCH の不正値・空更新は 400、存在しない ID は 404', async () => {
    const { results } = await (await importRecords([rec()])).json();
    const id = results[0].id;
    for (const bad of [
      { unit_price: -1 }, { quantity: 1.5 }, { line_no: -1 }, { purchased_at: '2026-02-30' },
      { currency: 'YEN!' }, { shop: '' }, { name: null }, { part_id: 0 }, {}
    ]) {
      const res = await send('PATCH', `/purchases/${id}`, bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
    assert.equal((await send('PATCH', '/purchases/99999', { note: 'x' })).status, 404);
  });

  await t.test('PR-35: PATCH 中の UNIQUE 制約違反（SQLITE_CONSTRAINT）は 500 ではなく 409 になる', async () => {
    const { results } = await (await importRecords([rec()])).json();
    db.run = async function (sql, ...args) {
      if (/^\s*UPDATE purchase_records/.test(sql)) {
        throw Object.assign(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT' });
      }
      return Object.getPrototypeOf(db).run.call(this, sql, ...args);
    };
    try {
      const res = await send('PATCH', `/purchases/${results[0].id}`, { note: 'x' });
      assert.equal(res.status, 409);
    } finally {
      delete db.run;
    }
  });

  await t.test('PR-40: DELETE は物理削除し、無ければ 404', async () => {
    const { results } = await (await importRecords([rec()])).json();
    const id = results[0].id;
    const res = await send('DELETE', `/purchases/${id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: true, id });
    assert.equal(await db.get('SELECT 1 FROM purchase_records WHERE id = ?', [id]), undefined);
    assert.equal((await send('DELETE', `/purchases/${id}`)).status, 404);
  });

  await t.test('PR-50: 部品の完全削除で購入履歴は残り、part_id だけ NULL に戻る', async () => {
    const partId = await insertPart('LED');
    const otherId = await insertPart('抵抗');
    await importRecords([rec({ line_no: 1, part_id: partId }), rec({ line_no: 2, part_id: otherId })]);

    // ゴミ箱に入れてから完全削除する
    assert.equal((await send('DELETE', `/parts/${partId}`)).status, 200);
    assert.equal((await send('DELETE', `/parts/${partId}/permanent`)).status, 200);

    const rows = await db.all('SELECT line_no, part_id FROM purchase_records ORDER BY line_no');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].part_id, null);
    assert.equal(rows[1].part_id, otherId);
  });

  await t.test('PR-60: バックアップの書き出しと復元で purchase_records が往復する', async () => {
    const partId = await insertPart('LED');
    await importRecords([
      rec({ line_no: 1, part_id: partId, note: 'メモ' }),
      rec({ shop: 'Mouser', order_id: 'M-1', line_no: null, currency: 'USD', unit_price: 1.25 })
    ]);
    const before = await db.all('SELECT * FROM purchase_records ORDER BY id');

    const exportRes = await fetch(`${baseUrl}/backup/export/full`);
    assert.equal(exportRes.status, 200);
    const zipBuffer = Buffer.from(await exportRes.arrayBuffer());
    const zip = new AdmZip(zipBuffer);
    const dump = JSON.parse(zip.getEntry('backup_data.json').getData().toString('utf8'));
    assert.equal(dump.purchaseRecords.length, 2);

    // 消してから復元する
    await db.run('DELETE FROM purchase_records');
    const form = new FormData();
    form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'backup.zip');
    const restoreRes = await fetch(`${baseUrl}/backup/import/full`, { method: 'POST', body: form });
    assert.equal(restoreRes.status, 200, await restoreRes.clone().text());

    const after = await db.all('SELECT * FROM purchase_records ORDER BY id');
    assert.deepEqual(after, before);
  });

  await t.test('PR-61: purchaseRecords を含まない古いバックアップでも復元でき、購入履歴は空になる', async () => {
    await importRecords([rec()]);
    const oldDump = { parts: [], categories: [], locations: [], tags: [], partTags: [] };
    const zip = new AdmZip();
    zip.addFile('backup_data.json', Buffer.from(JSON.stringify(oldDump), 'utf8'));
    const form = new FormData();
    form.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'old.zip');
    const res = await fetch(`${baseUrl}/backup/import/full`, { method: 'POST', body: form });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM purchase_records')).c, 0);
  });

  await t.test('PR-62: POST /backup/reset で purchase_records も空になる', async () => {
    await importRecords([rec()]);
    const res = await send('POST', '/backup/reset', {});
    assert.equal(res.status, 200);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM purchase_records')).c, 0);
  });
});
