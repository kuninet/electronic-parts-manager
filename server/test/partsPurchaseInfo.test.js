const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTestDb } = require('./testHelper');
const {
  normalizeShop,
  normalizePurchasedAt,
  normalizeUnitPrice,
  normalizePurchaseInfo,
  SHOP_MAX_LENGTH
} = require('../utils/purchaseInfo');

test('purchaseInfo 正規化関数 (PI-U)', async (t) => {
  await t.test('normalizeShop: 未送信・null・空・"null"', () => {
    assert.deepEqual(normalizeShop(undefined), { value: undefined });
    assert.deepEqual(normalizeShop(null), { value: null });
    assert.deepEqual(normalizeShop(''), { value: null });
    assert.deepEqual(normalizeShop('  '), { value: null });
    assert.deepEqual(normalizeShop('NULL'), { value: null });
  });

  await t.test('normalizeShop: 改行・タブは空白1つに置換し trim する', () => {
    assert.deepEqual(normalizeShop('  秋月\n電子\t通商 '), { value: '秋月 電子 通商' });
  });

  await t.test('normalizeShop: 100文字は可、101文字はエラー', () => {
    assert.equal(SHOP_MAX_LENGTH, 100);
    assert.deepEqual(normalizeShop('a'.repeat(100)), { value: 'a'.repeat(100) });
    assert.equal(normalizeShop('a'.repeat(101)).error, '購入先は100文字以内で入力してください');
  });

  await t.test('normalizePurchasedAt: 正しい日付・空・不正値', () => {
    assert.deepEqual(normalizePurchasedAt(undefined), { value: undefined });
    assert.deepEqual(normalizePurchasedAt(null), { value: null });
    assert.deepEqual(normalizePurchasedAt(''), { value: null });
    assert.deepEqual(normalizePurchasedAt('null'), { value: null });
    assert.deepEqual(normalizePurchasedAt('2026-03-01'), { value: '2026-03-01' });
    assert.deepEqual(normalizePurchasedAt('2024-02-29'), { value: '2024-02-29' });
    const msg = '購入日は YYYY-MM-DD 形式で指定してください';
    assert.equal(normalizePurchasedAt('2026-02-30').error, msg);
    assert.equal(normalizePurchasedAt('2025-02-29').error, msg);
    assert.equal(normalizePurchasedAt('2026-13-01').error, msg);
    assert.equal(normalizePurchasedAt('2026-2-1').error, msg);
    assert.equal(normalizePurchasedAt('2026/03/01').error, msg);
    assert.equal(normalizePurchasedAt('abc').error, msg);
    assert.equal(normalizePurchasedAt(20260301).error, msg);
  });

  await t.test('normalizeUnitPrice: 数値・数値文字列・空・不正値', () => {
    assert.deepEqual(normalizeUnitPrice(undefined), { value: undefined });
    assert.deepEqual(normalizeUnitPrice(null), { value: null });
    assert.deepEqual(normalizeUnitPrice(''), { value: null });
    assert.deepEqual(normalizeUnitPrice('null'), { value: null });
    assert.deepEqual(normalizeUnitPrice('12.5'), { value: 12.5 });
    assert.deepEqual(normalizeUnitPrice(0), { value: 0 });
    assert.deepEqual(normalizeUnitPrice('0'), { value: 0 });
    assert.deepEqual(normalizeUnitPrice(30), { value: 30 });
    assert.deepEqual(normalizeUnitPrice(1e9), { value: 1e9 });
    const msg = '単価は0以上の数値で指定してください';
    assert.deepEqual(normalizeUnitPrice(' 12 '), { value: 12 });
    assert.equal(normalizeUnitPrice('0x10').error, msg);
    assert.equal(normalizeUnitPrice('1e3').error, msg);
    assert.equal(normalizeUnitPrice('.5').error, msg);
    assert.equal(normalizeUnitPrice('Infinity').error, msg);
    assert.equal(normalizeUnitPrice(-1).error, msg);
    assert.equal(normalizeUnitPrice('-1').error, msg);
    assert.equal(normalizeUnitPrice('abc').error, msg);
    assert.equal(normalizeUnitPrice(1e9 + 1).error, msg);
    assert.equal(normalizeUnitPrice(NaN).error, msg);
    assert.equal(normalizeUnitPrice(Infinity).error, msg);
    assert.equal(normalizeUnitPrice(true).error, msg);
    assert.equal(normalizeUnitPrice([1]).error, msg);
  });

  await t.test('normalizePurchaseInfo: まとめて検証し、最初のエラーを返す', () => {
    assert.deepEqual(normalizePurchaseInfo({}), {
      values: { shop: undefined, purchased_at: undefined, unit_price: undefined }
    });
    assert.deepEqual(normalizePurchaseInfo({ shop: ' A ', purchased_at: '2026-03-01', unit_price: '3' }), {
      values: { shop: 'A', purchased_at: '2026-03-01', unit_price: 3 }
    });
    assert.ok(normalizePurchaseInfo({ unit_price: 'x' }).error);
  });
});

test('parts 購入情報 API テスト (PI-1 〜)', async (t) => {
  let server;
  let baseUrl;
  let db;

  t.before(async () => {
    db = await createTestDb();
    const databaseModule = require('../database');
    databaseModule.getDb = () => db;

    const app = express();
    app.use(express.json());
    app.use('/api/parts', require('../routes/parts'));

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/parts`;
  });

  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  t.beforeEach(async () => {
    await db.run('DELETE FROM part_tags');
    await db.run('DELETE FROM parts');
  });

  const patch = (id, body) => fetch(`${baseUrl}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const put = (id, fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return fetch(`${baseUrl}/${id}`, { method: 'PUT', body: form });
  };

  await t.test('PI-1: POST で3項目が保存される', async () => {
    const form = new FormData();
    form.append('name', '抵抗');
    form.append('shop', '  秋月電子  ');
    form.append('purchased_at', '2026-03-01');
    form.append('unit_price', '1.5');
    const res = await fetch(baseUrl, { method: 'POST', body: form });
    assert.equal(res.status, 201);
    const { id } = await res.json();
    const part = await db.get('SELECT * FROM parts WHERE id = ?', [id]);
    assert.equal(part.shop, '秋月電子');
    assert.equal(part.purchased_at, '2026-03-01');
    assert.equal(part.unit_price, 1.5);
  });

  await t.test('PI-2: POST で未送信なら NULL、不正値は 400', async () => {
    const form = new FormData();
    form.append('name', '抵抗');
    const res = await fetch(baseUrl, { method: 'POST', body: form });
    assert.equal(res.status, 201);
    const part = await db.get('SELECT * FROM parts WHERE id = ?', [(await res.json()).id]);
    assert.equal(part.shop, null);
    assert.equal(part.purchased_at, null);
    assert.equal(part.unit_price, null);

    for (const [k, v] of [['shop', 'a'.repeat(101)], ['purchased_at', '2026-02-30'], ['unit_price', '-1'], ['unit_price', 'abc']]) {
      const f = new FormData();
      f.append('name', '不正');
      f.append(k, v);
      const r = await fetch(baseUrl, { method: 'POST', body: f });
      assert.equal(r.status, 400, `${k}=${v}`);
    }
    const count = await db.get("SELECT COUNT(*) AS c FROM parts WHERE name = '不正'");
    assert.equal(count.c, 0);
  });

  await t.test('PI-3: PUT で3項目を送らなければ既存値が残り、unit_price 0 も保存できる', async () => {
    const ins = await db.run("INSERT INTO parts (name, shop, purchased_at, unit_price) VALUES ('R', '秋月電子', '2026-03-01', 30)");
    const res = await put(ins.lastID, { name: 'R2', quantity: '1' });
    assert.equal(res.status, 200);
    let part = await db.get('SELECT * FROM parts WHERE id = ?', [ins.lastID]);
    assert.equal(part.name, 'R2');
    assert.equal(part.shop, '秋月電子');
    assert.equal(part.purchased_at, '2026-03-01');
    assert.equal(part.unit_price, 30);

    const res2 = await put(ins.lastID, { name: 'R2', quantity: '1', unit_price: '0' });
    assert.equal(res2.status, 200);
    part = await db.get('SELECT * FROM parts WHERE id = ?', [ins.lastID]);
    assert.equal(part.unit_price, 0);
  });

  await t.test('PI-4: PUT で空文字を送ると NULL になり、不正値は 400', async () => {
    const ins = await db.run("INSERT INTO parts (name, shop, purchased_at, unit_price) VALUES ('R', '秋月電子', '2026-03-01', 30)");
    const res = await put(ins.lastID, { name: 'R', quantity: '1', shop: '', purchased_at: '', unit_price: '' });
    assert.equal(res.status, 200);
    const part = await db.get('SELECT * FROM parts WHERE id = ?', [ins.lastID]);
    assert.equal(part.shop, null);
    assert.equal(part.purchased_at, null);
    assert.equal(part.unit_price, null);

    const bad = await put(ins.lastID, { name: 'R', quantity: '1', purchased_at: '2026-2-1' });
    assert.equal(bad.status, 400);
  });

  await t.test('PI-5: PATCH で更新・null 消去ができ、他の項目は変わらない', async () => {
    const ins = await db.run("INSERT INTO parts (name, quantity) VALUES ('R', 4)");
    const id = ins.lastID;
    let res = await patch(id, { shop: 'マルツ', purchased_at: '2026-04-05', unit_price: 12.5 });
    assert.equal(res.status, 200);
    let data = await res.json();
    assert.equal(data.shop, 'マルツ');
    assert.equal(data.purchased_at, '2026-04-05');
    assert.equal(data.unit_price, 12.5);
    assert.equal(data.quantity, 4);

    res = await patch(id, { shop: null, unit_price: null });
    assert.equal(res.status, 200);
    data = await res.json();
    assert.equal(data.shop, null);
    assert.equal(data.unit_price, null);
    assert.equal(data.purchased_at, '2026-04-05');

    res = await patch(id, { purchased_at: '' });
    data = await res.json();
    assert.equal(data.purchased_at, null);
  });

  await t.test('PI-6: PATCH の不正値は 400', async () => {
    const ins = await db.run("INSERT INTO parts (name) VALUES ('R')");
    for (const body of [
      { shop: 'a'.repeat(101) },
      { purchased_at: '2026-02-30' },
      { unit_price: -1 },
      { unit_price: 'abc' },
      { unit_price: true },
    ]) {
      const res = await patch(ins.lastID, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  await t.test('PI-6b: PATCH の tags は trim・空除去・重複除去され、空配列で全削除できる', async () => {
    const ins = await db.run("INSERT INTO parts (name) VALUES ('R')");
    const id = ins.lastID;
    let res = await patch(id, { shop: 'S', tags: ['a', 'a', ' b ', '', '  '] });
    assert.equal(res.status, 200);
    let data = await res.json();
    assert.equal(data.shop, 'S');
    assert.deepEqual(data.tags.split(',').sort(), ['a', 'b']);

    res = await patch(id, { tags: 'x, x ,y' });
    assert.equal(res.status, 200);
    data = await res.json();
    assert.deepEqual(data.tags.split(',').sort(), ['x', 'y']);

    res = await patch(id, { tags: [] });
    assert.equal(res.status, 200);
    data = await res.json();
    assert.equal(data.tags, null);
  });

  await t.test('PI-6c: POST と PUT の tags も重複・空白を整えて 500 にならない', async () => {
    const form = new FormData();
    form.append('name', 'T');
    form.append('tags', 'a, a ,b');
    const res = await fetch(baseUrl, { method: 'POST', body: form });
    assert.equal(res.status, 201);
    const { id } = await res.json();
    let rows = await db.all('SELECT t.name FROM part_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.part_id = ? ORDER BY t.name', [id]);
    assert.deepEqual(rows.map(r => r.name), ['a', 'b']);

    const r2 = await put(id, { name: 'T', quantity: '1', tags: 'c,c, d ,' });
    assert.equal(r2.status, 200);
    rows = await db.all('SELECT t.name FROM part_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.part_id = ? ORDER BY t.name', [id]);
    assert.deepEqual(rows.map(r => r.name), ['c', 'd']);
  });

  await t.test('PI-7: GET ?search= が shop に当たり、?shop= で部分一致絞り込みできる', async () => {
    await db.run("INSERT INTO parts (name, shop) VALUES ('A', '秋月電子通商')");
    await db.run("INSERT INTO parts (name, shop) VALUES ('B', 'マルツ')");
    await db.run("INSERT INTO parts (name) VALUES ('C')");

    let res = await fetch(`${baseUrl}?search=${encodeURIComponent('秋月')}`);
    let rows = await res.json();
    assert.deepEqual(rows.map(r => r.name), ['A']);

    res = await fetch(`${baseUrl}?shop=${encodeURIComponent('ルツ')}`);
    rows = await res.json();
    assert.deepEqual(rows.map(r => r.name), ['B']);
    assert.equal(rows[0].shop, 'マルツ');
  });

  await t.test('PI-8: GET /shops は件数順（同数は名前順）で、ゴミ箱と空値を含まず、/:id に吸われない', async () => {
    await db.run("INSERT INTO parts (name, shop) VALUES ('1', 'マルツ')");
    await db.run("INSERT INTO parts (name, shop) VALUES ('2', '秋月電子')");
    await db.run("INSERT INTO parts (name, shop) VALUES ('3', '秋月電子')");
    await db.run("INSERT INTO parts (name, shop) VALUES ('4', 'DigiKey')");
    await db.run("INSERT INTO parts (name, shop) VALUES ('5', '')");
    await db.run("INSERT INTO parts (name) VALUES ('6')");
    await db.run("INSERT INTO parts (name, shop, deleted_at) VALUES ('7', 'ゴミ箱店', CURRENT_TIMESTAMP)");

    const res = await fetch(`${baseUrl}/shops`);
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.deepEqual(rows, [
      { name: '秋月電子', count: 2 },
      { name: 'DigiKey', count: 1 },
      { name: 'マルツ', count: 1 },
    ]);
  });
});
