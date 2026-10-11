const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const { createTestDb, createDummyImage } = require('./testHelper');

let app;
let server;
let baseUrl;
let db;
const createdFiles = [];

// unlink は完了を待たずに実行されるため、ファイルが消えるまで最大 1 秒待つ
async function waitUntilGone(filePath, timeoutMs = 1000) {
  const start = Date.now();
  while (fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

async function insertPart(fields = {}) {
  const f = { name: '部品', quantity: 1, ...fields };
  const cols = Object.keys(f);
  const res = await db.run(
    `INSERT INTO parts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(f)
  );
  return res.lastID;
}

async function insertTrashedPart(fields = {}) {
  return insertPart({ ...fields, deleted_at: '2026-01-01 00:00:00' });
}

async function getPart(id) {
  return db.get('SELECT * FROM parts WHERE id = ?', [id]);
}

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('パーツ削除系 API（ゴミ箱・復元・完全削除・一括操作）のテスト', async (t) => {
  t.before(async () => {
    db = await createTestDb();

    const databaseModule = require('../database');
    databaseModule.getDb = () => db;

    app = express();
    app.use(express.json());
    const partsRouter = require('../routes/parts');
    app.use('/api/parts', partsRouter);

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/parts`;
  });

  t.after(async () => {
    for (const f of createdFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('S-1: DELETE /:id でゴミ箱へ移動し、QR コードが解除されること', async () => {
    const id = await insertPart({ qr_code: 'P-001' });

    const res = await fetch(`${baseUrl}/${id}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, id);

    const part = await getPart(id);
    assert.ok(part.deleted_at);
    assert.equal(part.qr_code, null);
  });

  await t.test('S-2: 存在しない ID のゴミ箱移動は 404', async () => {
    const res = await fetch(`${baseUrl}/99999`, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });

  await t.test('S-3: 既にゴミ箱にあるパーツのゴミ箱移動は 404', async () => {
    const id = await insertTrashedPart();
    const res = await fetch(`${baseUrl}/${id}`, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });

  await t.test('S-4: bulk/action trash で通常パーツ 2 件をゴミ箱へ移動できること', async () => {
    const a = await insertPart({ qr_code: 'P-A' });
    const b = await insertPart();

    const res = await post('/bulk/action', { action: 'trash', ids: [a, b] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).affected, 2);

    const pa = await getPart(a);
    const pb = await getPart(b);
    assert.ok(pa.deleted_at);
    assert.ok(pb.deleted_at);
    assert.equal(pa.qr_code, null);
  });

  await t.test('S-5: bulk/action restore はゴミ箱内のパーツだけを復元すること', async () => {
    const trashed = await insertTrashedPart();
    const active = await insertPart({ name: '通常' });
    const before = await getPart(active);

    const res = await post('/bulk/action', { action: 'restore', ids: [trashed, active] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).affected, 1);

    assert.equal((await getPart(trashed)).deleted_at, null);
    assert.deepEqual(await getPart(active), before);
  });

  // 入庫ログ・タグ・AI 候補のある、ゴミ箱内のパーツを作る
  async function createTrashedPartWithRelations() {
    const loc = await db.run("INSERT INTO locations (name) VALUES ('棚S6')");
    const id = await insertTrashedPart({ location_id: loc.lastID });
    await db.run('INSERT INTO storage_logs (part_id, location_id) VALUES (?, ?)', [id, loc.lastID]);
    await db.run('INSERT INTO storage_logs (part_id, location_id) VALUES (?, ?)', [id, loc.lastID]);
    const tag = await db.run("INSERT INTO tags (name) VALUES (?)", [`tag-${id}`]);
    await db.run('INSERT INTO part_tags (part_id, tag_id) VALUES (?, ?)', [id, tag.lastID]);
    await db.run('INSERT INTO ai_name_suggestions (part_id, suggested_name) VALUES (?, ?)', [id, '候補']);
    return id;
  }

  async function assertNoRelations(id) {
    assert.equal(await getPart(id), undefined);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM storage_logs WHERE part_id = ?', [id])).c, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM part_tags WHERE part_id = ?', [id])).c, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM ai_name_suggestions WHERE part_id = ?', [id])).c, 0);
  }

  await t.test('S-6: 入庫ログのあるパーツを bulk/action delete で完全削除できること（外部キー違反の回帰）', async () => {
    const id = await createTrashedPartWithRelations();

    const res = await post('/bulk/action', { action: 'delete', ids: [id] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).affected, 1);
    await assertNoRelations(id);
  });

  await t.test('S-7: 入庫ログのあるパーツを DELETE /:id/permanent で完全削除できること', async () => {
    const id = await createTrashedPartWithRelations();

    const res = await fetch(`${baseUrl}/${id}/permanent`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).affected, 1);
    await assertNoRelations(id);
  });

  await t.test('S-8: ゴミ箱外のパーツは完全削除されず、画像ファイルも残ること', async () => {
    const img = await createDummyImage('test-delete-s8.jpg');
    createdFiles.push(img.filePath);
    const id = await insertPart({ image_path: img.imagePath });

    const res = await post('/bulk/action', { action: 'delete', ids: [id] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).affected, 0);

    const singleRes = await fetch(`${baseUrl}/${id}/permanent`, { method: 'DELETE' });
    assert.equal(singleRes.status, 404);

    await new Promise((r) => setTimeout(r, 100));
    assert.ok(await getPart(id));
    assert.ok(fs.existsSync(img.filePath));
  });

  await t.test('S-9: 完全削除で画像ファイルが削除されること', async () => {
    const img = await createDummyImage('test-delete-s9.jpg');
    createdFiles.push(img.filePath);
    const id = await insertTrashedPart({ image_path: img.imagePath });

    const res = await post('/bulk/action', { action: 'delete', ids: [id] });
    assert.equal(res.status, 200);
    assert.ok(await waitUntilGone(img.filePath), '画像ファイルが削除されていない');
  });

  await t.test('S-10: 不正な action は 400', async () => {
    const id = await insertPart();
    const res = await post('/bulk/action', { action: 'purge', ids: [id] });
    assert.equal(res.status, 400);
  });

  await t.test('S-11: 不正な ids は 400', async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => i + 1);
    const cases = [[], '1', [0], [-1], ['abc'], [1.5], tooMany, undefined, null];
    for (const ids of cases) {
      const res = await post('/bulk/action', { action: 'trash', ids });
      assert.equal(res.status, 400, `ids=${JSON.stringify(ids)?.slice(0, 40)}`);
    }
  });

  await t.test('S-12: 重複した ids は 1 件として処理されること', async () => {
    const a = await insertPart();
    const b = await insertPart();
    const res = await post('/bulk/action', { action: 'trash', ids: [a, a, b] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).affected, 2);
  });

  await t.test('S-13: bulk/update は { ids, updates } でカテゴリを一括変更できること', async () => {
    const cat = await db.run("INSERT INTO categories (name) VALUES ('IC')");
    const a = await insertPart();
    const b = await insertPart();

    const res = await post('/bulk/update', { ids: [a, b], updates: { category_id: cat.lastID } });
    assert.equal(res.status, 200);
    assert.equal((await getPart(a)).category_id, cat.lastID);
    assert.equal((await getPart(b)).category_id, cat.lastID);
  });

  await t.test('S-14: bulk/update で updates に包まない旧形式は 400', async () => {
    const cat = await db.run("INSERT INTO categories (name) VALUES ('抵抗')");
    const a = await insertPart();

    const res = await post('/bulk/update', { ids: [a], category_id: cat.lastID });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'No updates provided');
    assert.equal((await getPart(a)).category_id, null);
  });

  await t.test('S-15: POST /:id/restore でゴミ箱から復元できること', async () => {
    const id = await insertTrashedPart();
    const res = await fetch(`${baseUrl}/${id}/restore`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, id);
    assert.equal((await getPart(id)).deleted_at, null);
  });

  await t.test('S-16: ゴミ箱外のパーツ・存在しない ID の復元は 404', async () => {
    const id = await insertPart();
    const res1 = await fetch(`${baseUrl}/${id}/restore`, { method: 'POST' });
    assert.equal(res1.status, 404);
    const res2 = await fetch(`${baseUrl}/99999/restore`, { method: 'POST' });
    assert.equal(res2.status, 404);
  });

  await t.test('S-17: 不正な ID は 400', async () => {
    const res1 = await fetch(`${baseUrl}/abc`, { method: 'DELETE' });
    assert.equal(res1.status, 400);
    const res2 = await fetch(`${baseUrl}/abc/restore`, { method: 'POST' });
    assert.equal(res2.status, 400);
    const res3 = await fetch(`${baseUrl}/abc/permanent`, { method: 'DELETE' });
    assert.equal(res3.status, 400);
  });
});
