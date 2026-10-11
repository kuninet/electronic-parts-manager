const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTestDb } = require('./testHelper');

let app;
let server;
let baseUrl;
let db;

test('GET /api/parts/stats APIエンドポイントのテスト', async (t) => {
  t.before(async () => {
    db = await createTestDb();

    // database.js の getDb をテストDBに向ける
    const databaseModule = require('../database');
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

  await t.test('集計データが正しく取得され、/:id ルーティングと競合しないこと', async () => {
    // カテゴリ2つ（cat1, cat2）
    const cat1Res = await db.run("INSERT INTO categories (name, display_order) VALUES ('IC', 1)");
    const cat1Id = cat1Res.lastID;
    const cat2Res = await db.run("INSERT INTO categories (name, display_order) VALUES ('抵抗', 2)");
    const cat2Id = cat2Res.lastID;

    // 保管場所
    await db.run("INSERT INTO locations (name) VALUES ('棚A')");

    // 通常の部品 3件:
    // 1: 数量0 (在庫切れ), category_id = cat1Id
    const p1Res = await db.run("INSERT INTO parts (name, quantity, category_id) VALUES ('Part1', 0, ?)", [cat1Id]);
    const p1Id = p1Res.lastID;
    // 2: 数量3 (低在庫 < 5), category_id = cat1Id
    await db.run("INSERT INTO parts (name, quantity, category_id) VALUES ('Part2', 3, ?)", [cat1Id]);
    // 3: 数量10 (通常), category_id IS NULL (未分類)
    await db.run("INSERT INTO parts (name, quantity) VALUES ('Part3', 10)");

    // 使用済み 1件
    await db.run("INSERT INTO parts (name, quantity, used_at) VALUES ('PartUsed', 1, datetime('now'))");

    // ゴミ箱 (deleted_at) 1件
    await db.run("INSERT INTO parts (name, quantity, deleted_at) VALUES ('PartTrash', 1, datetime('now'))");

    // pending の AI候補 1件 (p1Id に紐づけ)
    await db.run("INSERT INTO ai_name_suggestions (part_id, suggested_name, status) VALUES (?, 'AI Suggestion 1', 'pending')", [p1Id]);

    const res = await fetch(`${baseUrl}/stats`);
    assert.equal(res.status, 200, 'GET /api/parts/stats should return 200 (not 404 from /:id)');

    const stats = await res.json();
    assert.equal(stats.active, 3);
    assert.equal(stats.used, 1);
    assert.equal(stats.trash, 1);
    assert.equal(stats.outOfStock, 1);
    assert.equal(stats.lowStock, 1);
    assert.equal(stats.aiPending, 1);
    assert.equal(stats.uncategorized, 1);
    assert.equal(stats.lowStockThreshold, 5);

    // カテゴリ集計の検証（cat1: 2件, cat2: 0件）
    const cat1 = stats.categories.find(c => c.id === cat1Id);
    const cat2 = stats.categories.find(c => c.id === cat2Id);
    assert.ok(cat1, 'cat1 should exist in categories stats');
    assert.equal(cat1.count, 2);
    assert.ok(cat2, 'cat2 should exist in categories stats');
    assert.equal(cat2.count, 0);
  });
});
