const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTestDb } = require('./testHelper');

let app;
let server;
let baseUrl;
let qrBaseUrl;
let db;

test('parts.part_number API テスト (P-1 〜 P-12)', async (t) => {
  t.before(async () => {
    db = await createTestDb();

    // database.js の getDb をテストDBに向ける
    const databaseModule = require('../database');
    databaseModule.getDb = () => db;

    app = express();
    app.use(express.json());
    const partsRouter = require('../routes/parts');
    const qrRouter = require('../routes/qr');
    app.use('/api/parts', partsRouter);
    app.use('/api/qr', qrRouter);

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/parts`;
    qrBaseUrl = `http://127.0.0.1:${port}/api/qr`;
  });

  t.after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  t.beforeEach(async () => {
    // 毎回クリーンアップ
    await db.run('DELETE FROM part_tags');
    await db.run('DELETE FROM parts');
    await db.run('DELETE FROM locations');
    await db.run('DELETE FROM categories');
  });

  await t.test('P-1: part_number 前後空白 trim で POST (201)', async () => {
    const form = new FormData();
    form.append('name', 'Timer IC');
    form.append('part_number', '  NE555P  ');

    const res = await fetch(baseUrl, {
      method: 'POST',
      body: form
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();

    const part = await db.get('SELECT * FROM parts WHERE id = ?', [data.id]);
    assert.strictEqual(part.part_number, 'NE555P');
  });

  await t.test('P-2: part_number なしで POST -> NULL (201)', async () => {
    const form = new FormData();
    form.append('name', 'Resistor 10k');

    const res = await fetch(baseUrl, {
      method: 'POST',
      body: form
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();

    const part = await db.get('SELECT * FROM parts WHERE id = ?', [data.id]);
    assert.strictEqual(part.part_number, null);
  });

  await t.test('P-3: 101文字の part_number で POST -> 400', async () => {
    const form = new FormData();
    form.append('name', 'Too Long Part');
    form.append('part_number', 'A'.repeat(101));

    const res = await fetch(baseUrl, {
      method: 'POST',
      body: form
    });
    assert.strictEqual(res.status, 400);

    const parts = await db.all('SELECT * FROM parts');
    assert.strictEqual(parts.length, 0);
  });

  await t.test('P-4: PUT で part_number 未送信 -> 既存値保持 (D2)', async () => {
    const insertRes = await db.run("INSERT INTO parts (name, quantity, part_number) VALUES ('OpAmp', 10, 'LM358N')");
    const partId = insertRes.lastID;

    // quickUpdatePart 同様に name と quantity のみ送信
    const form = new FormData();
    form.append('name', 'OpAmp Updated');
    form.append('quantity', '15');

    const res = await fetch(`${baseUrl}/${partId}`, {
      method: 'PUT',
      body: form
    });
    assert.strictEqual(res.status, 200);

    const part = await db.get('SELECT * FROM parts WHERE id = ?', [partId]);
    assert.strictEqual(part.name, 'OpAmp Updated');
    assert.strictEqual(part.quantity, 15);
    assert.strictEqual(part.part_number, 'LM358N');
  });

  await t.test('P-5: PUT で part_number: "" -> NULL クリア (D3)', async () => {
    const insertRes = await db.run("INSERT INTO parts (name, quantity, part_number) VALUES ('OpAmp', 10, 'LM358N')");
    const partId = insertRes.lastID;

    const form = new FormData();
    form.append('name', 'OpAmp');
    form.append('quantity', '10');
    form.append('part_number', '');

    const res = await fetch(`${baseUrl}/${partId}`, {
      method: 'PUT',
      body: form
    });
    assert.strictEqual(res.status, 200);

    const part = await db.get('SELECT * FROM parts WHERE id = ?', [partId]);
    assert.strictEqual(part.part_number, null);
  });

  await t.test('P-6: PUT で part_number: "LM358P" -> 更新 (200)', async () => {
    const insertRes = await db.run("INSERT INTO parts (name, quantity, part_number) VALUES ('OpAmp', 10, 'LM358N')");
    const partId = insertRes.lastID;

    const form = new FormData();
    form.append('name', 'OpAmp');
    form.append('quantity', '10');
    form.append('part_number', 'LM358P');

    const res = await fetch(`${baseUrl}/${partId}`, {
      method: 'PUT',
      body: form
    });
    assert.strictEqual(res.status, 200);

    const part = await db.get('SELECT * FROM parts WHERE id = ?', [partId]);
    assert.strictEqual(part.part_number, 'LM358P');
  });

  await t.test('P-7: PATCH で part_number 更新 (200)', async () => {
    const insertRes = await db.run("INSERT INTO parts (name, quantity, qr_code) VALUES ('Transistor', 5, 'QR-TR-01')");
    const partId = insertRes.lastID;

    const res = await fetch(`${baseUrl}/${partId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_number: '2SC1815-GR' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.part_number, '2SC1815-GR');
    assert.strictEqual(data.name, 'Transistor');
    assert.strictEqual(data.qr_code, 'QR-TR-01');

    const part = await db.get('SELECT * FROM parts WHERE id = ?', [partId]);
    assert.strictEqual(part.part_number, '2SC1815-GR');
    assert.strictEqual(part.name, 'Transistor');
  });

  await t.test('P-8: PATCH で part_number: "null" -> NULL になる', async () => {
    const insertRes = await db.run("INSERT INTO parts (name, part_number) VALUES ('Part X', 'X')");
    const partId = insertRes.lastID;

    const res = await fetch(`${baseUrl}/${partId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_number: 'null' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.part_number, null);

    const part = await db.get('SELECT * FROM parts WHERE id = ?', [partId]);
    assert.strictEqual(part.part_number, null);
  });

  await t.test('P-9: GET ?search=555 で名・型番・説明から3件ヒット', async () => {
    await db.run("INSERT INTO parts (name, description, part_number) VALUES ('555 Timer', 'Standard', NULL)");
    await db.run("INSERT INTO parts (name, description, part_number) VALUES ('IC Chip', 'Description', 'NE555P')");
    await db.run("INSERT INTO parts (name, description, part_number) VALUES ('Other IC', '555互換のタイマー', NULL)");
    await db.run("INSERT INTO parts (name, description, part_number) VALUES ('Unrelated', 'Nothing', 'LM358')");

    const res = await fetch(`${baseUrl}?search=555`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.length, 3);
  });

  await t.test('P-10: GET ?search=ne555p で大文字小文字無視ヒット', async () => {
    await db.run("INSERT INTO parts (name, description, part_number) VALUES ('Analog IC', 'Dip-8', 'NE555P')");

    const res = await fetch(`${baseUrl}?search=ne555p`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].part_number, 'NE555P');
  });

  await t.test('P-11: GET ?sort=part_number ソート順序 (A, B, NULL/空)', async () => {
    await db.run("INSERT INTO parts (name, part_number) VALUES ('Part 1', 'B')");
    await db.run("INSERT INTO parts (name, part_number) VALUES ('Part 2', 'A')");
    await db.run("INSERT INTO parts (name, part_number) VALUES ('Part 3', NULL)");
    await db.run("INSERT INTO parts (name, part_number) VALUES ('Part 4', '')");

    // ASC
    const resAsc = await fetch(`${baseUrl}?sort=part_number&order=asc`);
    assert.strictEqual(resAsc.status, 200);
    const dataAsc = await resAsc.json();
    assert.strictEqual(dataAsc.length, 4);
    assert.strictEqual(dataAsc[0].part_number, 'A');
    assert.strictEqual(dataAsc[1].part_number, 'B');
    // 残り2件は NULL または ''
    assert.ok(dataAsc[2].part_number === null || dataAsc[2].part_number === '');
    assert.ok(dataAsc[3].part_number === null || dataAsc[3].part_number === '');

    // DESC
    const resDesc = await fetch(`${baseUrl}?sort=part_number&order=desc`);
    assert.strictEqual(resDesc.status, 200);
    const dataDesc = await resDesc.json();
    assert.strictEqual(dataDesc.length, 4);
    assert.strictEqual(dataDesc[0].part_number, 'B');
    assert.strictEqual(dataDesc[1].part_number, 'A');
    assert.ok(dataDesc[2].part_number === null || dataDesc[2].part_number === '');
    assert.ok(dataDesc[3].part_number === null || dataDesc[3].part_number === '');
  });

  await t.test('P-12: POST /api/qr/register-part で part_number 保存', async () => {
    const form = new FormData();
    form.append('qr_code', 'QR-TEST-NEW-01');
    form.append('name', 'QR Transistor');
    form.append('part_number', '2SC1815-Y');

    const res = await fetch(`${qrBaseUrl}/register-part`, {
      method: 'POST',
      body: form
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();

    const part = await db.get('SELECT * FROM parts WHERE id = ?', [data.id]);
    assert.strictEqual(part.name, 'QR Transistor');
    assert.strictEqual(part.qr_code, 'QR-TEST-NEW-01');
    assert.strictEqual(part.part_number, '2SC1815-Y');
  });
});
