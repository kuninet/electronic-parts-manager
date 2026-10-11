const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTestDb } = require('./testHelper');

// database モジュールの getDb を一時的にスタブするためのセットアップ
let app;
let server;
let baseUrl;
let db;

test('PATCH /api/parts/:id APIエンドポイントのテスト', async (t) => {
  t.before(async () => {
    db = await createTestDb();

    // database.js の getDb をテストDBに向ける
    const databaseModule = require('../database');
    const originalGetDb = databaseModule.getDb;
    databaseModule.getDb = () => db;

    app = express();
    app.use(express.json());
    const partsRouter = require('../routes/parts');
    app.use('/api/parts', partsRouter);

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/parts`;
  });

  t.after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  await t.test('指定されたキー（nameのみ）が更新され、他のキーが維持されること', async () => {
    const locRes = await db.run("INSERT INTO locations (name) VALUES ('棚A-1')");
    const locId = locRes.lastID;

    const insRes = await db.run(
      "INSERT INTO parts (name, description, location_id, quantity, qr_code) VALUES ('(名称未設定)', '初期説明', ?, 10, 'QR-PATCH-01')",
      [locId]
    );
    const partId = insRes.lastID;

    const res = await fetch(`${baseUrl}/${partId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '2SC1815-Y トランジスタ' })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, '2SC1815-Y トランジスタ');
    assert.equal(data.description, '初期説明');
    assert.equal(data.location_id, locId);
    assert.equal(data.quantity, 10);
    assert.equal(data.qr_code, 'QR-PATCH-01');
  });

  await t.test('存在しない部品IDに対して 404 を返すこと', async () => {
    const res = await fetch(`${baseUrl}/999999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新規名称' })
    });

    assert.equal(res.status, 404);
  });

  await t.test('更新キーが渡されない場合に 400 を返すこと', async () => {
    const insRes = await db.run("INSERT INTO parts (name) VALUES ('部品')");
    const partId = insRes.lastID;

    const res = await fetch(`${baseUrl}/${partId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 400);
  });

  await t.test('QRコードの重複がある場合に 409 を返すこと', async () => {
    await db.run("INSERT INTO parts (name, qr_code) VALUES ('部品A', 'QR-DUP-01')");
    const p2Res = await db.run("INSERT INTO parts (name, qr_code) VALUES ('部品B', 'QR-DUP-02')");
    const part2Id = p2Res.lastID;

    const res = await fetch(`${baseUrl}/${part2Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr_code: 'QR-DUP-01' })
    });

    assert.equal(res.status, 409);
  });
});
