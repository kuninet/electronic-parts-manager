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

async function waitUntilGone(filePath, timeoutMs = 1000) {
  const start = Date.now();
  while (fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

async function insertLocation(name, imagePath = null) {
  const res = await db.run('INSERT INTO locations (name, image_path) VALUES (?, ?)', [name, imagePath]);
  return res.lastID;
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

const TRASHED = '2026-01-01 00:00:00';

test('DELETE /api/locations/:id のテスト', async (t) => {
  t.before(async () => {
    db = await createTestDb();

    const databaseModule = require('../database');
    databaseModule.getDb = () => db;

    app = express();
    app.use(express.json());
    app.use('/api/locations', require('../routes/locations'));
    app.use('/api/parts', require('../routes/parts'));

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  });

  t.after(async () => {
    for (const f of createdFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  const del = (id) => fetch(`${baseUrl}/locations/${id}`, { method: 'DELETE' });
  const locationExists = async (id) => !!(await db.get('SELECT id FROM locations WHERE id = ?', [id]));

  await t.test('L-1: 通常のパーツがある保管場所は 400（件数を含む）', async () => {
    const loc = await insertLocation('棚L1');
    await insertPart({ location_id: loc });

    const res = await del(loc);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /1 件/);
    assert.ok(await locationExists(loc));
  });

  await t.test('L-2: 使用済みパーツだけがある保管場所も 400', async () => {
    const loc = await insertLocation('棚L2');
    await insertPart({ location_id: loc, used_at: '2026-02-01 00:00:00' });

    const res = await del(loc);
    assert.equal(res.status, 400);
    assert.ok(await locationExists(loc));
  });

  let detachedPartIds = [];

  await t.test('L-3: ゴミ箱内のパーツだけなら削除でき、パーツの保管場所が外れること', async () => {
    const loc = await insertLocation('棚L3');
    const p1 = await insertPart({ location_id: loc, deleted_at: TRASHED });
    const p2 = await insertPart({ location_id: loc, deleted_at: TRASHED });

    const res = await del(loc);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).detachedTrashedParts, 2);
    assert.equal(await locationExists(loc), false);

    for (const id of [p1, p2]) {
      const part = await db.get('SELECT * FROM parts WHERE id = ?', [id]);
      assert.ok(part, 'パーツ自体は残る');
      assert.equal(part.location_id, null);
    }
    detachedPartIds = [p1, p2];
  });

  await t.test('L-4: 入庫ログのある保管場所を削除でき、その場所のログだけが消えること（外部キー違反の回帰）', async () => {
    const x = await insertLocation('棚L4-X');
    const y = await insertLocation('棚L4-Y');
    const part = await insertPart({ location_id: y });
    for (let i = 0; i < 3; i++) {
      await db.run('INSERT INTO storage_logs (part_id, location_id) VALUES (?, ?)', [part, x]);
    }
    await db.run('INSERT INTO storage_logs (part_id, location_id) VALUES (?, ?)', [part, y]);

    const res = await del(x);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deletedLogs, 3);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM storage_logs WHERE location_id = ?', [x])).c, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS c FROM storage_logs WHERE location_id = ?', [y])).c, 1);
  });

  await t.test('L-5: 削除で保管場所の画像ファイルが消えること', async () => {
    const img = await createDummyImage('test-delete-l5.jpg');
    createdFiles.push(img.filePath);
    const loc = await insertLocation('棚L5', img.imagePath);

    const res = await del(loc);
    assert.equal(res.status, 200);
    assert.ok(await waitUntilGone(img.filePath), '画像ファイルが削除されていない');
  });

  await t.test('L-6: 存在しない ID は 404、不正な ID は 400', async () => {
    assert.equal((await del(99999)).status, 404);
    assert.equal((await del('abc')).status, 400);
  });

  await t.test('L-7: 保管場所の削除後に復元したパーツは保管場所なしのまま', async () => {
    assert.equal(detachedPartIds.length, 2, 'L-3 が先に成功している必要がある');
    const id = detachedPartIds[0];

    const res = await fetch(`${baseUrl}/parts/${id}/restore`, { method: 'POST' });
    assert.equal(res.status, 200);
    const part = await db.get('SELECT * FROM parts WHERE id = ?', [id]);
    assert.equal(part.deleted_at, null);
    assert.equal(part.location_id, null);
  });
});
