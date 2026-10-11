const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTestDb, createDummyImage } = require('./testHelper');
const fs = require('fs');

let app;
let server;
let baseUrl;
let db;
let dummyImage;

test('/api/ai-naming ルートのテスト', async (t) => {
  t.before(async () => {
    db = await createTestDb();
    dummyImage = await createDummyImage('test-route-part.jpg');

    const databaseModule = require('../database');
    databaseModule.getDb = () => db;

    app = express();
    app.use(express.json());
    const aiNamingRouter = require('../routes/aiNaming');
    app.use('/api/ai-naming', aiNamingRouter);

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/ai-naming`;
  });

  t.after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    if (dummyImage && fs.existsSync(dummyImage.filePath)) {
      try { await fs.promises.unlink(dummyImage.filePath); } catch (e) {}
    }
  });

  await t.test('GET /status がステータス情報を返すこと', async () => {
    const res = await fetch(`${baseUrl}/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data.enabled, 'boolean');
    assert.equal(typeof data.todayCount, 'number');
    assert.equal(typeof data.dailyLimit, 'number');
    assert.equal(typeof data.defaultModel, 'string');
  });

  await t.test('GET /models がモデル一覧を返すこと', async () => {
    const res = await fetch(`${baseUrl}/models`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(Array.isArray(data), true);
    assert.ok(data.length > 0);
    assert.ok(data.some(m => m.id === 'gemini-flash-latest'));
  });

  await t.test('GET /suggestions が pending 候補一覧を返すこと', async () => {
    const partRes = await db.run(
      "INSERT INTO parts (name, image_path) VALUES ('(名称未設定)', ?)",
      [dummyImage.imagePath]
    );
    const partId = partRes.lastID;

    await db.run(`
      INSERT INTO ai_name_suggestions (
        part_id, model, image_path, suggested_name, confidence, status
      ) VALUES (?, 'gemini-flash-latest', ?, '10kΩ 金属皮膜抵抗', 0.92, 'pending')
    `, [partId, dummyImage.imagePath]);

    const res = await fetch(`${baseUrl}/suggestions`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(Array.isArray(data), true);
    assert.ok(data.length >= 1);
    const item = data.find(s => s.part_id === partId);
    assert.ok(item);
    assert.equal(item.suggested_name, '10kΩ 金属皮膜抵抗');
    assert.equal(item.current_part_name, '(名称未設定)');
  });

  await t.test('POST /apply/:id で候補が採用されること', async () => {
    const suggestions = await db.all('SELECT * FROM ai_name_suggestions WHERE status = "pending"');
    const target = suggestions[0];

    const res = await fetch(`${baseUrl}/apply/${target.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '10kΩ 金属皮膜抵抗 1/4W' })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.part.name, '10kΩ 金属皮膜抵抗 1/4W');
    assert.equal(data.suggestion.status, 'applied');
  });

  await t.test('M4: POST /apply-batch で items 配列による手直し名前が反映されること', async () => {
    const p1 = await db.run("INSERT INTO parts (name, image_path) VALUES ('(名称未設定) A', ?)", [dummyImage.imagePath]);
    const p2 = await db.run("INSERT INTO parts (name, image_path) VALUES ('(名称未設定) B', ?)", [dummyImage.imagePath]);

    const s1 = await db.run("INSERT INTO ai_name_suggestions (part_id, image_path, suggested_name, confidence, status) VALUES (?, ?, 'AI元名1', 0.90, 'pending')", [p1.lastID, dummyImage.imagePath]);
    const s2 = await db.run("INSERT INTO ai_name_suggestions (part_id, image_path, suggested_name, confidence, status) VALUES (?, ?, 'AI元名2', 0.85, 'pending')", [p2.lastID, dummyImage.imagePath]);

    const res = await fetch(`${baseUrl}/apply-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { id: s1.lastID, name: '人間が編集した名前1' },
          { id: s2.lastID, name: '人間が編集した名前2' }
        ]
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.appliedCount, 2);

    const updatedP1 = await db.get('SELECT name FROM parts WHERE id = ?', [p1.lastID]);
    const updatedP2 = await db.get('SELECT name FROM parts WHERE id = ?', [p2.lastID]);
    assert.equal(updatedP1.name, '人間が編集した名前1');
    assert.equal(updatedP2.name, '人間が編集した名前2');
  });

  await t.test('POST /reject/:id で候補が却下されること', async () => {
    const pReject = await db.run("INSERT INTO parts (name, image_path) VALUES ('(名称未設定) 却下用', ?)", [dummyImage.imagePath]);
    const sReject = await db.run("INSERT INTO ai_name_suggestions (part_id, image_path, suggested_name, status) VALUES (?, ?, '却下用提案', 'pending')", [pReject.lastID, dummyImage.imagePath]);

    const res = await fetch(`${baseUrl}/reject/${sReject.lastID}`, {
      method: 'POST'
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'rejected');
  });
});
