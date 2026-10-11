const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTestDb } = require('./testHelper');

let app;
let server;
let baseUrl;
let db;

async function insertCategory(name) {
  const res = await db.run('INSERT INTO categories (name) VALUES (?)', [name]);
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

test('DELETE /api/categories/:id のテスト', async (t) => {
  t.before(async () => {
    db = await createTestDb();

    const databaseModule = require('../database');
    databaseModule.getDb = () => db;

    app = express();
    app.use(express.json());
    app.use('/api/categories', require('../routes/categories'));
    app.use('/api/parts', require('../routes/parts'));

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  });

  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  const del = (id) => fetch(`${baseUrl}/categories/${id}`, { method: 'DELETE' });
  const categoryExists = async (id) => !!(await db.get('SELECT id FROM categories WHERE id = ?', [id]));

  await t.test('C-1: 通常のパーツがあるカテゴリは 400（件数を含む）', async () => {
    const cat = await insertCategory('C1');
    await insertPart({ category_id: cat });

    const res = await del(cat);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /1 件/);
    assert.ok(await categoryExists(cat));
  });

  await t.test('C-2: 使用済みパーツだけがあるカテゴリも 400', async () => {
    const cat = await insertCategory('C2');
    await insertPart({ category_id: cat, used_at: '2026-02-01 00:00:00' });

    const res = await del(cat);
    assert.equal(res.status, 400);
    assert.ok(await categoryExists(cat));
  });

  let detachedPartIds = [];

  await t.test('C-3: ゴミ箱内のパーツだけなら削除でき、パーツが未分類になること', async () => {
    const cat = await insertCategory('C3');
    const p1 = await insertPart({ category_id: cat, deleted_at: TRASHED });
    const p2 = await insertPart({ category_id: cat, deleted_at: TRASHED });

    const res = await del(cat);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).detachedTrashedParts, 2);
    assert.equal(await categoryExists(cat), false);

    for (const id of [p1, p2]) {
      const part = await db.get('SELECT * FROM parts WHERE id = ?', [id]);
      assert.ok(part, 'パーツ自体は残る');
      assert.equal(part.category_id, null);
    }
    detachedPartIds = [p1, p2];
  });

  await t.test('C-4: パーツが 0 件のカテゴリは削除できること', async () => {
    const cat = await insertCategory('C4');
    const res = await del(cat);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).detachedTrashedParts, 0);
    assert.equal(await categoryExists(cat), false);
  });

  await t.test('C-5: 存在しない ID は 404', async () => {
    assert.equal((await del(99999)).status, 404);
  });

  await t.test('C-6: 不正な ID は 400', async () => {
    assert.equal((await del('abc')).status, 400);
    assert.equal((await del(0)).status, 400);
  });

  await t.test('C-7: カテゴリの削除後に復元したパーツは未分類のまま', async () => {
    assert.equal(detachedPartIds.length, 2, 'C-3 が先に成功している必要がある');
    const id = detachedPartIds[0];

    const res = await fetch(`${baseUrl}/parts/${id}/restore`, { method: 'POST' });
    assert.equal(res.status, 200);
    const part = await db.get('SELECT * FROM parts WHERE id = ?', [id]);
    assert.equal(part.deleted_at, null);
    assert.equal(part.category_id, null);
  });
});
