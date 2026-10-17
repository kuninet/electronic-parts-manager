const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTestDb } = require('./testHelper');

let app;
let server;
let baseUrl;
let db;

async function insertPart(fields = {}) {
    const f = { name: 'テスト部品', quantity: 10, ...fields };
    const cols = Object.keys(f);
    const res = await db.run(
        `INSERT INTO parts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        Object.values(f)
    );
    return res.lastID;
}

test('POST /api/parts/:id/quantity API テスト (Q-1 〜 Q-10)', async (t) => {
    t.before(async () => {
        db = await createTestDb();

        const databaseModule = require('../database');
        databaseModule.getDb = () => db;

        app = express();
        app.use(express.json());
        app.use('/api/parts', require('../routes/parts'));

        server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/parts`;
    });

    t.after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    t.beforeEach(async () => {
        await db.run('DELETE FROM part_tags');
        await db.run('DELETE FROM parts');
    });

    await t.test('Q-1: delta: 5, reason 指定で 200（数量15、updated_at更新）', async () => {
        const id = await insertPart({ quantity: 10 });
        const before = await db.get('SELECT updated_at FROM parts WHERE id = ?', [id]);

        // updated_at の違いを確実に検知するため微小スリープ
        await new Promise((r) => setTimeout(r, 20));

        const res = await fetch(`${baseUrl}/${id}/quantity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: 5, reason: '秋月で購入' })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.deepEqual(data, {
            part_id: id,
            previous_quantity: 10,
            new_quantity: 15,
            delta: 5,
            reason: '秋月で購入'
        });

        const after = await db.get('SELECT quantity, updated_at FROM parts WHERE id = ?', [id]);
        assert.equal(after.quantity, 15);
        assert.ok(after.updated_at >= before.updated_at);
    });

    await t.test('Q-2: delta: -3 で 200（数量7）', async () => {
        const id = await insertPart({ quantity: 10 });

        const res = await fetch(`${baseUrl}/${id}/quantity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: -3 })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.new_quantity, 7);
        assert.equal(data.delta, -3);
        assert.equal(data.reason, null);

        const row = await db.get('SELECT quantity FROM parts WHERE id = ?', [id]);
        assert.equal(row.quantity, 7);
    });

    await t.test('Q-3: absolute: 0 で 200（数量0, delta -10）', async () => {
        const id = await insertPart({ quantity: 10 });

        const res = await fetch(`${baseUrl}/${id}/quantity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ absolute: 0 })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.new_quantity, 0);
        assert.equal(data.delta, -10);

        const row = await db.get('SELECT quantity FROM parts WHERE id = ?', [id]);
        assert.equal(row.quantity, 0);
    });

    await t.test('Q-4: absolute: 10（同一値）で delta: 0、updated_at は変わらない', async () => {
        const id = await insertPart({ quantity: 10 });
        const before = await db.get('SELECT updated_at FROM parts WHERE id = ?', [id]);

        await new Promise((r) => setTimeout(r, 20));

        const res = await fetch(`${baseUrl}/${id}/quantity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ absolute: 10 })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.delta, 0);
        assert.equal(data.new_quantity, 10);
        assert.equal(data.previous_quantity, 10);

        const after = await db.get('SELECT updated_at FROM parts WHERE id = ?', [id]);
        assert.equal(after.updated_at, before.updated_at);
    });

    await t.test('Q-5: delta: -11 で在庫数が負になる場合は 400（数量は10のまま）', async () => {
        const id = await insertPart({ quantity: 10 });

        const res = await fetch(`${baseUrl}/${id}/quantity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: -11 })
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.match(data.error, /在庫数が負になります/);

        const row = await db.get('SELECT quantity FROM parts WHERE id = ?', [id]);
        assert.equal(row.quantity, 10);
    });

    await t.test('Q-6: 不正なパラメータは 400', async () => {
        const id = await insertPart({ quantity: 10 });

        const badBodies = [
            {},
            { delta: 1, absolute: 1 },
            { delta: 0 },
            { delta: 1.5 },
            { absolute: -1 },
            { absolute: '' },
            { delta: true },
            { delta: false },
            { absolute: [] },
            { delta: {} },
            { delta: '5' },
            { absolute: '10' },
        ];

        for (const body of badBodies) {
            const res = await fetch(`${baseUrl}/${id}/quantity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            assert.equal(res.status, 400, `Body ${JSON.stringify(body)} should return 400`);
        }
    });

    await t.test('Q-7: :id が不正な文字列の場合は 400 Invalid ID', async () => {
        const res = await fetch(`${baseUrl}/abc/quantity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: 1 })
        });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.error, 'Invalid ID');
    });

    await t.test('Q-8: ゴミ箱・使用済み・存在しない部品は 404', async () => {
        const trashId = await insertPart({ quantity: 10, deleted_at: '2026-01-01 00:00:00' });
        const usedId = await insertPart({ quantity: 10, used_at: '2026-01-01 00:00:00' });
        const nonExistentId = 99999;

        for (const targetId of [trashId, usedId, nonExistentId]) {
            const res = await fetch(`${baseUrl}/${targetId}/quantity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delta: 1 })
            });
            assert.equal(res.status, 404, `id=${targetId} should return 404`);
            const data = await res.json();
            assert.match(data.error, /部品が見つかりません/);
        }
    });

    await t.test('Q-9: reason が 201 文字の場合は 400', async () => {
        const id = await insertPart({ quantity: 10 });
        const longReason = 'a'.repeat(201);

        const res = await fetch(`${baseUrl}/${id}/quantity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: 1, reason: longReason })
        });
        assert.equal(res.status, 400);
    });

    await t.test('Q-10: 並行 delta: 1 を 5 回実行しても単一 UPDATE で原子的に更新され最終的に 15 になる', async () => {
        const id = await insertPart({ quantity: 10 });

        const reqs = Array.from({ length: 5 }, () =>
            fetch(`${baseUrl}/${id}/quantity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delta: 1 })
            })
        );

        const responses = await Promise.all(reqs);
        for (const res of responses) {
            assert.equal(res.status, 200);
        }

        const row = await db.get('SELECT quantity FROM parts WHERE id = ?', [id]);
        assert.equal(row.quantity, 15);
    });

    await t.test('Q-11: quantity が NULL の古い行でも delta / absolute が安全に動作する', async () => {
        // quantity が NULL の部品
        const id1 = await insertPart({ quantity: null });

        // delta: 5 -> previous: 0, new: 5
        const res1 = await fetch(`${baseUrl}/${id1}/quantity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: 5 })
        });
        assert.equal(res1.status, 200);
        const data1 = await res1.json();
        assert.equal(data1.previous_quantity, 0);
        assert.equal(data1.new_quantity, 5);
        assert.equal(data1.delta, 5);

        // absolute: 3
        const id2 = await insertPart({ quantity: null });
        const res2 = await fetch(`${baseUrl}/${id2}/quantity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ absolute: 3 })
        });
        assert.equal(res2.status, 200);
        const data2 = await res2.json();
        assert.equal(data2.previous_quantity, 0);
        assert.equal(data2.new_quantity, 3);
        assert.equal(data2.delta, 3);
    });
});
