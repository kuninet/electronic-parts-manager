const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTestDb } = require('./testHelper');

let app;
let server;
let partsUrl;
let locationsUrl;
let qrUrl;
let db;

test('画像アップロード制限 (multer 50MB / 画像20MB 413チェック) のテスト', async (t) => {
    t.before(async () => {
        db = await createTestDb();

        const databaseModule = require('../database');
        databaseModule.getDb = () => db;

        app = express();
        app.use(express.json());

        const partsRouter = require('../routes/parts');
        const locationsRouter = require('../routes/locations');
        const qrRouter = require('../routes/qr');

        app.use('/api/parts', partsRouter);
        app.use('/api/locations', locationsRouter);
        app.use('/api/qr', qrRouter);

        server = await new Promise((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        const port = server.address().port;
        partsUrl = `http://127.0.0.1:${port}/api/parts`;
        locationsUrl = `http://127.0.0.1:${port}/api/locations`;
        qrUrl = `http://127.0.0.1:${port}/api/qr`;
    });

    t.after(async () => {
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
    });

    t.beforeEach(async () => {
        await db.run('DELETE FROM part_tags');
        await db.run('DELETE FROM parts');
        await db.run('DELETE FROM locations');
        await db.run('DELETE FROM categories');
    });

    // 20MB超過のダミー画像（20MB + 1KB）
    const oversizedBufferSize = 20 * 1024 * 1024 + 1024;
    const oversizedBuffer = Buffer.alloc(oversizedBufferSize);

    await t.test('POST /api/parts - 20MB超の画像で 413 エラーを返すこと', async () => {
        const form = new FormData();
        form.append('name', 'テスト部品');
        form.append('quantity', '1');
        const oversizedBlob = new Blob([oversizedBuffer], { type: 'image/jpeg' });
        form.append('image', oversizedBlob, 'large.jpg');

        const res = await fetch(partsUrl, {
            method: 'POST',
            body: form
        });

        assert.strictEqual(res.status, 413);
        const data = await res.json();
        assert.match(data.error, /20MB以下/);
    });

    await t.test('PUT /api/parts/:id - 20MB超の画像で 413 エラーを返すこと', async () => {
        // 部品を事前に1件作成
        const insertRes = await db.run('INSERT INTO parts (name, quantity) VALUES (?, ?)', ['既存部品', 5]);
        const partId = insertRes.lastID;

        const form = new FormData();
        form.append('name', '既存部品更新');
        form.append('quantity', '5');
        const oversizedBlob = new Blob([oversizedBuffer], { type: 'image/jpeg' });
        form.append('image', oversizedBlob, 'large.jpg');

        const res = await fetch(`${partsUrl}/${partId}`, {
            method: 'PUT',
            body: form
        });

        assert.strictEqual(res.status, 413);
        const data = await res.json();
        assert.match(data.error, /20MB以下/);
    });

    await t.test('POST /api/locations - 20MB超の画像で 413 エラーを返すこと', async () => {
        const form = new FormData();
        form.append('name', 'テスト保管場所');
        const oversizedBlob = new Blob([oversizedBuffer], { type: 'image/jpeg' });
        form.append('image', oversizedBlob, 'large.jpg');

        const res = await fetch(locationsUrl, {
            method: 'POST',
            body: form
        });

        assert.strictEqual(res.status, 413);
        const data = await res.json();
        assert.match(data.error, /20MB以下/);
    });

    await t.test('PUT /api/locations/:id - 20MB超の画像で 413 エラーを返すこと', async () => {
        const insertRes = await db.run('INSERT INTO locations (name) VALUES (?)', ['既存保管場所']);
        const locId = insertRes.lastID;

        const form = new FormData();
        form.append('name', '保管場所更新');
        const oversizedBlob = new Blob([oversizedBuffer], { type: 'image/jpeg' });
        form.append('image', oversizedBlob, 'large.jpg');

        const res = await fetch(`${locationsUrl}/${locId}`, {
            method: 'PUT',
            body: form
        });

        assert.strictEqual(res.status, 413);
        const data = await res.json();
        assert.match(data.error, /20MB以下/);
    });

    await t.test('POST /api/qr/register-location - 20MB超の画像で 413 エラーを返すこと', async () => {
        const form = new FormData();
        form.append('name', 'QR保管場所');
        form.append('qr_code', 'LOC-TEST-001');
        const oversizedBlob = new Blob([oversizedBuffer], { type: 'image/jpeg' });
        form.append('image', oversizedBlob, 'large.jpg');

        const res = await fetch(`${qrUrl}/register-location`, {
            method: 'POST',
            body: form
        });

        assert.strictEqual(res.status, 413);
        const data = await res.json();
        assert.match(data.error, /20MB以下/);
    });

    await t.test('POST /api/qr/register-part - 20MB超の画像で 413 エラーを返すこと', async () => {
        const form = new FormData();
        form.append('name', 'QR部品');
        form.append('qr_code', 'PART-TEST-001');
        form.append('quantity', '10');
        const oversizedBlob = new Blob([oversizedBuffer], { type: 'image/jpeg' });
        form.append('image', oversizedBlob, 'large.jpg');

        const res = await fetch(`${qrUrl}/register-part`, {
            method: 'POST',
            body: form
        });

        assert.strictEqual(res.status, 413);
        const data = await res.json();
        assert.match(data.error, /20MB以下/);
    });

    await t.test('POST /api/parts - 50MB超のファイルで multer LIMIT_FILE_SIZE (413) を返すこと', async () => {
        const superSizeBuffer = Buffer.alloc(50 * 1024 * 1024 + 1024);
        const form = new FormData();
        form.append('name', '超巨大ファイル部品');
        form.append('quantity', '1');
        const superBlob = new Blob([superSizeBuffer], { type: 'application/pdf' });
        form.append('datasheet', superBlob, 'huge-datasheet.pdf');

        const res = await fetch(partsUrl, {
            method: 'POST',
            body: form
        });

        assert.strictEqual(res.status, 413);
        const data = await res.json();
        assert.strictEqual(data.error, 'ファイルサイズが大きすぎます (最大50MB)');
    });
});
