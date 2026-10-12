const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTestDb } = require('./testHelper');

let app;
let server;
let baseUrl;
let db;

async function insertLocation(name) {
  const res = await db.run('INSERT INTO locations (name) VALUES (?)', [name]);
  return res.lastID;
}

async function insertPart(fields = {}) {
  const f = { name: 'テスト部品', quantity: 1, ...fields };
  const cols = Object.keys(f);
  const res = await db.run(
    `INSERT INTO parts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(f)
  );
  return res.lastID;
}

const TRASHED = '2026-01-01 00:00:00';
const USED = '2026-01-01 00:00:00';

test('QR入出庫 /store および /store/undo API のテスト (Q-1 〜 Q-15)', async (t) => {
  t.before(async () => {
    db = await createTestDb();

    const databaseModule = require('../database');
    databaseModule.getDb = () => db;

    app = express();
    app.use(express.json());
    app.use('/api/qr', require('../routes/qr'));
    app.use('/api/locations', require('../routes/locations'));

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

  let locAId, locBId, locCId;
  let part1Id, part2Id, part3Id;
  let q1LogId, q2LogId;

  await t.test('準備: テスト用保管場所と部品を作成', async () => {
    locAId = await insertLocation('棚A');
    locBId = await insertLocation('棚B');
    locCId = await insertLocation('棚C');

    part1Id = await insertPart({ name: '抵抗 10k', location_id: locAId });
    part2Id = await insertPart({ name: 'コンデンサ 100uF', location_id: null });
    part3Id = await insertPart({ name: 'IC 555', location_id: locBId });
  });

  await t.test('Q-1: 保管場所 A にある部品を B にしまう -> 200, ログ記録, previous_location_id が A', async () => {
    const res = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: part1Id, location_id: locBId })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.unchanged, false);
    assert.strictEqual(data.part_id, part1Id);
    assert.strictEqual(data.location_id, locBId);
    assert.strictEqual(data.previous_location_id, locAId);
    assert.strictEqual(data.previous_location_name, '棚A');
    assert.strictEqual(typeof data.log_id, 'number');
    q1LogId = data.log_id;

    // DB確認
    const partInDb = await db.get('SELECT location_id FROM parts WHERE id = ?', [part1Id]);
    assert.strictEqual(partInDb.location_id, locBId);
    const logInDb = await db.get('SELECT * FROM storage_logs WHERE id = ?', [q1LogId]);
    assert.strictEqual(logInDb.part_id, part1Id);
    assert.strictEqual(logInDb.location_id, locBId);
    assert.strictEqual(logInDb.previous_location_id, locAId);
  });

  await t.test('Q-2: 保管場所が未設定の部品を B にしまう -> 200, previous_location_id が null', async () => {
    const res = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: part2Id, location_id: locBId })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.unchanged, false);
    assert.strictEqual(data.part_id, part2Id);
    assert.strictEqual(data.location_id, locBId);
    assert.strictEqual(data.previous_location_id, null);
    assert.strictEqual(data.previous_location_name, null);
    assert.strictEqual(typeof data.log_id, 'number');
    q2LogId = data.log_id;

    const partInDb = await db.get('SELECT location_id FROM parts WHERE id = ?', [part2Id]);
    assert.strictEqual(partInDb.location_id, locBId);
  });

  await t.test('Q-3: すでに B にある部品を B にしまう -> 200, unchanged: true, log_id: null, ログ不変', async () => {
    const logsBefore = await db.all('SELECT COUNT(*) as cnt FROM storage_logs');
    const res = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: part3Id, location_id: locBId })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.unchanged, true);
    assert.strictEqual(data.log_id, null);
    assert.strictEqual(data.part_id, part3Id);
    assert.strictEqual(data.location_id, locBId);

    const logsAfter = await db.all('SELECT COUNT(*) as cnt FROM storage_logs');
    assert.strictEqual(logsAfter[0].cnt, logsBefore[0].cnt);
  });

  await t.test('Q-4: part_id / location_id が欠落・0・文字列 -> 400', async () => {
    const cases = [
      {},
      { part_id: part1Id },
      { location_id: locBId },
      { part_id: 0, location_id: locBId },
      { part_id: part1Id, location_id: 0 },
      { part_id: 'abc', location_id: locBId },
      { part_id: part1Id, location_id: 'xyz' },
      { part_id: -1, location_id: locBId },
      { part_id: 1.5, location_id: locBId }
    ];
    for (const body of cases) {
      const res = await fetch(`${baseUrl}/qr/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      assert.strictEqual(res.status, 400, `Expected 400 for ${JSON.stringify(body)}`);
    }
  });

  await t.test('Q-5: ゴミ箱内の部品、使用済みの部品、存在しない ID -> 404', async () => {
    const trashedPartId = await insertPart({ name: 'ゴミ箱部品', location_id: locAId, deleted_at: TRASHED });
    const usedPartId = await insertPart({ name: '使用済み部品', location_id: locAId, used_at: USED });

    // ゴミ箱
    let res = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: trashedPartId, location_id: locBId })
    });
    assert.strictEqual(res.status, 404);
    let p = await db.get('SELECT location_id FROM parts WHERE id = ?', [trashedPartId]);
    assert.strictEqual(p.location_id, locAId);

    // 使用済み
    res = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: usedPartId, location_id: locBId })
    });
    assert.strictEqual(res.status, 404);
    p = await db.get('SELECT location_id FROM parts WHERE id = ?', [usedPartId]);
    assert.strictEqual(p.location_id, locAId);

    // 存在しない
    res = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: 999999, location_id: locBId })
    });
    assert.strictEqual(res.status, 404);
  });

  await t.test('Q-6: 存在しない保管場所 -> 404', async () => {
    const res = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: part1Id, location_id: 999999 })
    });
    assert.strictEqual(res.status, 404);
  });

  await t.test('Q-7: Q-1 の直後 -> POST /store/undo { log_id } -> 200, 部品が A に戻りログ削除', async () => {
    const res = await fetch(`${baseUrl}/qr/store/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: q1LogId })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.part_id, part1Id);
    assert.strictEqual(data.restored_location_id, locAId);
    assert.strictEqual(data.restored_location_name, '棚A');
    assert.strictEqual(data.previous_location_missing, false);

    // DB確認: 部品が棚Aに戻っていること
    const partInDb = await db.get('SELECT location_id FROM parts WHERE id = ?', [part1Id]);
    assert.strictEqual(partInDb.location_id, locAId);

    // ログが消えていること
    const logInDb = await db.get('SELECT * FROM storage_logs WHERE id = ?', [q1LogId]);
    assert.strictEqual(logInDb, undefined);
  });

  await t.test('Q-8: Q-2 の直後 -> 取り消す -> 部品の location_id が null に戻る', async () => {
    const res = await fetch(`${baseUrl}/qr/store/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: q2LogId })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.part_id, part2Id);
    assert.strictEqual(data.restored_location_id, null);
    assert.strictEqual(data.restored_location_name, null);
    assert.strictEqual(data.previous_location_missing, false);

    const partInDb = await db.get('SELECT location_id FROM parts WHERE id = ?', [part2Id]);
    assert.strictEqual(partInDb.location_id, null);
  });

  await t.test('Q-9: Q-7 の後 -> 同じ log_id でもう一度取り消す -> 404', async () => {
    const res = await fetch(`${baseUrl}/qr/store/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: q1LogId })
    });
    assert.strictEqual(res.status, 404);
  });

  await t.test('Q-10: A->B にしまった後、さらに C にしまった -> 最初のログを取り消す -> 409', async () => {
    // part1 を A -> B にしまう
    const res1 = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: part1Id, location_id: locBId })
    });
    const data1 = await res1.json();
    const firstLogId = data1.log_id;

    // さらに B -> C にしまう
    const res2 = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: part1Id, location_id: locCId })
    });
    assert.strictEqual(res2.status, 200);

    // 最初のログを取り消そうとすると、現在の場所(locCId)がログの場所(locBId)と異なるため 409
    const undoRes = await fetch(`${baseUrl}/qr/store/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: firstLogId })
    });
    assert.strictEqual(undoRes.status, 409);

    // 部品は C のまま、ログも残っていること
    const partInDb = await db.get('SELECT location_id FROM parts WHERE id = ?', [part1Id]);
    assert.strictEqual(partInDb.location_id, locCId);
    const logInDb = await db.get('SELECT * FROM storage_logs WHERE id = ?', [firstLogId]);
    assert.ok(logInDb);
  });

  await t.test('Q-11: A->B にしまった後、保管場所 A を削除した -> 取り消す -> 200, location_id: null, previous_location_missing: true', async () => {
    const tempLocId = await insertLocation('一時棚');
    const tempPartId = await insertPart({ name: '一時部品', location_id: tempLocId });

    // 一時棚 -> 棚B にしまう
    const storeRes = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: tempPartId, location_id: locBId })
    });
    const storeData = await storeRes.json();
    const logId = storeData.log_id;

    // 保管場所 一時棚 を削除する（#70 の API を経由）
    const delRes = await fetch(`${baseUrl}/locations/${tempLocId}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);

    // 取り消す
    const undoRes = await fetch(`${baseUrl}/qr/store/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: logId })
    });
    assert.strictEqual(undoRes.status, 200);
    const undoData = await undoRes.json();
    assert.strictEqual(undoData.restored_location_id, null);
    assert.strictEqual(undoData.restored_location_name, null);
    assert.strictEqual(undoData.previous_location_missing, true);

    const partInDb = await db.get('SELECT location_id FROM parts WHERE id = ?', [tempPartId]);
    assert.strictEqual(partInDb.location_id, null);
  });

  await t.test('Q-12: log_id が欠落・0・文字列 -> 400', async () => {
    const cases = [
      {},
      { log_id: 0 },
      { log_id: 'abc' },
      { log_id: -5 },
      { log_id: 2.5 },
      { log_id: null }
    ];
    for (const body of cases) {
      const res = await fetch(`${baseUrl}/qr/store/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      assert.strictEqual(res.status, 400, `Expected 400 for ${JSON.stringify(body)}`);
    }
  });

  await t.test('Q-13: B にしまった後、部品をゴミ箱へ移した -> 取り消す -> 200, deleted_at は不変', async () => {
    const partTrashedLater = await insertPart({ name: '後でゴミ箱部品', location_id: locAId });
    const storeRes = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: partTrashedLater, location_id: locBId })
    });
    const storeData = await storeRes.json();
    const logId = storeData.log_id;

    // 部品をゴミ箱へ（直接DB更新）
    await db.run('UPDATE parts SET deleted_at = ? WHERE id = ?', [TRASHED, partTrashedLater]);

    // 取り消す
    const undoRes = await fetch(`${baseUrl}/qr/store/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: logId })
    });
    assert.strictEqual(undoRes.status, 200);
    const undoData = await undoRes.json();
    assert.strictEqual(undoData.restored_location_id, locAId);

    const partInDb = await db.get('SELECT location_id, deleted_at FROM parts WHERE id = ?', [partTrashedLater]);
    assert.strictEqual(partInDb.location_id, locAId);
    assert.strictEqual(partInDb.deleted_at, TRASHED);
  });

  await t.test('Q-14: A->B にしまったログがある状態で保管場所 A を DELETE /api/locations/:id で削除できる（外部キー制約なし）', async () => {
    const locToDelete = await insertLocation('削除予定棚');
    const p = await insertPart({ name: '外部キー検証部品', location_id: locToDelete });

    const storeRes = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: p, location_id: locBId })
    });
    assert.strictEqual(storeRes.status, 200);

    // locToDelete は storage_logs の previous_location_id として参照されているが、
    // 外部キーが付いていないため、DELETE /locations/:id で正常に削除できるはず
    const delRes = await fetch(`${baseUrl}/locations/${locToDelete}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);
  });

  await t.test('Q-15: 存在しない部品IDを持つログの取り消し -> 404', async () => {
    // 外部キーを一時的に無効化して孤立ログを作成
    await db.exec('PRAGMA foreign_keys = OFF');
    const dummyLog = await db.run(
      'INSERT INTO storage_logs (part_id, location_id, previous_location_id) VALUES (?, ?, ?)',
      [888888, locBId, locAId]
    );
    await db.exec('PRAGMA foreign_keys = ON');

    const undoRes = await fetch(`${baseUrl}/qr/store/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: dummyLog.lastID })
    });
    assert.strictEqual(undoRes.status, 404);
  });

  await t.test('Q-16: A->B、C->B の後に、最初のログ（A->B）を取り消そうとすると最新ログではないため 409', async () => {
    const q16PartId = await insertPart({ name: '巡回部品', location_id: locAId });

    // 1回目: A -> B にしまう
    const res1 = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: q16PartId, location_id: locBId })
    });
    assert.strictEqual(res1.status, 200);
    const data1 = await res1.json();
    const firstLogId = data1.log_id;

    // 部品を C に移す（編集画面等での移動を想定）
    await db.run('UPDATE parts SET location_id = ? WHERE id = ?', [locCId, q16PartId]);

    // 2回目: C -> B に再度しまう（新しいログが作られる）
    const res2 = await fetch(`${baseUrl}/qr/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: q16PartId, location_id: locBId })
    });
    assert.strictEqual(res2.status, 200);

    // 部品の現在の場所は locBId だが、最初のログ(firstLogId)は最新ではないため 409
    const undoRes = await fetch(`${baseUrl}/qr/store/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: firstLogId })
    });
    assert.strictEqual(undoRes.status, 409);
    const errData = await undoRes.json();
    assert.strictEqual(errData.error, 'この部品はその後さらに操作されているため、この記録からは戻せません');
  });
});
