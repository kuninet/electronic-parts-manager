const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');
const { createTestDb } = require('./testHelper');

let app;
let server;
let baseUrl;
let db;

test('POST /api/parts の JSON 対応と入力検証 (P-1 〜 P-8)', async (t) => {
    t.before(async () => {
        db = await createTestDb();

        const databaseModule = require('../database');
        databaseModule.getDb = () => db;

        app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
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
        await db.run('DELETE FROM tags');
        await db.run('DELETE FROM parts');
        await db.run('DELETE FROM locations');
        await db.run('DELETE FROM categories');
    });

    await t.test('P-1: カテゴリと保管場所を指定した JSON で正常作成 (201)', async () => {
        const catRes = await db.run('INSERT INTO categories (name) VALUES (?)', ['受動部品']);
        const locRes = await db.run('INSERT INTO locations (name) VALUES (?)', ['引き出しA']);
        const categoryId = catRes.lastID;
        const locationId = locRes.lastID;

        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'LED',
                part_number: 'OSR5JA',
                quantity: 10,
                category_id: categoryId,
                location_id: locationId
            })
        });

        assert.equal(res.status, 201);
        const data = await res.json();
        assert.ok(data.id);

        const row = await db.get('SELECT * FROM parts WHERE id = ?', [data.id]);
        assert.equal(row.name, 'LED');
        assert.equal(row.part_number, 'OSR5JA');
        assert.equal(row.quantity, 10);
        assert.equal(row.category_id, categoryId);
        assert.equal(row.location_id, locationId);
    });

    await t.test('P-2: quantity 未指定時は 0 が設定される (201, NULL ではない)', async () => {
        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'R' })
        });

        assert.equal(res.status, 201);
        const data = await res.json();
        assert.ok(data.id);

        const row = await db.get('SELECT quantity FROM parts WHERE id = ?', [data.id]);
        assert.equal(row.quantity, 0);
    });

    await t.test('P-3: name 未指定または空白は 400 (部品名は必須です)', async () => {
        const res1 = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.equal(res1.status, 400);
        const data1 = await res1.json();
        assert.equal(data1.error, '部品名は必須です');

        const res2 = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '   ' })
        });
        assert.equal(res2.status, 400);
        const data2 = await res2.json();
        assert.equal(data2.error, '部品名は必須です');
    });

    await t.test('P-4: quantity が負数、小数、文字列の場合は 400', async () => {
        for (const badQty of [-1, 1.5, 'abc']) {
            const res = await fetch(baseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'R', quantity: badQty })
            });
            assert.equal(res.status, 400, `quantity ${badQty} should be 400`);
            const data = await res.json();
            assert.equal(data.error, '数量は0以上の整数で指定してください');
        }
    });

    await t.test('P-5: 存在しない category_id / location_id は 400', async () => {
        const resCat = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'R', category_id: 999 })
        });
        assert.equal(resCat.status, 400);
        const dataCat = await resCat.json();
        assert.equal(dataCat.error, '指定されたカテゴリが存在しません');

        const resLoc = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'R', location_id: 999 })
        });
        assert.equal(resLoc.status, 400);
        const dataLoc = await resLoc.json();
        assert.equal(dataLoc.error, '指定された保管場所が存在しません');
    });

    await t.test('P-6: JSON で tags 配列を指定した場合は part_tags が作成される (201)', async () => {
        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'R', tags: ['a', 'b'] })
        });

        assert.equal(res.status, 201);
        const data = await res.json();
        assert.ok(data.id);

        const rows = await db.all('SELECT * FROM part_tags WHERE part_id = ?', [data.id]);
        assert.equal(rows.length, 2);
    });

    await t.test('P-7: multipart 形式で画像付きパーツ作成 (201, 回帰)', async () => {
        const pngBuffer = await sharp({
            create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } }
        }).png().toBuffer();

        const form = new FormData();
        form.append('name', '画像付きパーツ');
        form.append('quantity', '5');
        const imgBlob = new Blob([pngBuffer], { type: 'image/png' });
        form.append('image', imgBlob, 'sample.png');

        const res = await fetch(baseUrl, {
            method: 'POST',
            body: form
        });

        assert.equal(res.status, 201);
        const data = await res.json();
        assert.ok(data.id);

        const row = await db.get('SELECT * FROM parts WHERE id = ?', [data.id]);
        assert.equal(row.name, '画像付きパーツ');
        assert.equal(row.quantity, 5);
        assert.ok(row.image_path && row.image_path.startsWith('/uploads/'));
    });

    await t.test('P-8: multipart 形式で category_id="" かつ tags="x,y" (201, 回帰)', async () => {
        const form = new FormData();
        form.append('name', 'タグ付きパーツ');
        form.append('category_id', '');
        form.append('tags', 'x,y');

        const res = await fetch(baseUrl, {
            method: 'POST',
            body: form
        });

        assert.equal(res.status, 201);
        const data = await res.json();
        assert.ok(data.id);

        const row = await db.get('SELECT * FROM parts WHERE id = ?', [data.id]);
        assert.equal(row.category_id, null);

        const rows = await db.all('SELECT * FROM part_tags WHERE part_id = ?', [data.id]);
        assert.equal(rows.length, 2);
    });
});
