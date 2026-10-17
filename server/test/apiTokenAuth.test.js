const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const { createApiTokenAuth } = require('../middleware/apiTokenAuth');

async function createServer(options) {
    const app = express();
    app.use(cors());
    app.use('/api', createApiTokenAuth(options));
    app.get('/api/parts', (req, res) => res.json({ ok: true }));
    app.post('/api/parts', (req, res) => res.json({ ok: true }));
    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
    app.post('/api/backup/export/worker', (req, res) => res.json({ worker: true }));

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/api`;
    const close = () => new Promise((resolve) => server.close(resolve));
    return { app, server, baseUrl, close };
}

test('API トークン認証ミドルウェア (M-1 〜 M-12)', async (t) => {
    await t.test('M-1: token が未設定の場合は素通し（200）', async () => {
        const { baseUrl, close } = await createServer({});
        try {
            const res = await fetch(`${baseUrl}/parts`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.deepEqual(body, { ok: true });
        } finally {
            await close();
        }
    });

    await t.test('M-2: token が空白文字のみの場合は無効扱い（素通し 200）', async () => {
        const { baseUrl, close } = await createServer({ token: '   ' });
        try {
            const res = await fetch(`${baseUrl}/parts`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.deepEqual(body, { ok: true });
        } finally {
            await close();
        }
    });

    await t.test('M-3: token 設定時にヘッダーなしは 401（code: API_TOKEN_REQUIRED, Basicを含まない）', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret' });
        try {
            const res = await fetch(`${baseUrl}/parts`);
            assert.equal(res.status, 401);
            const authHeader = res.headers.get('www-authenticate') || '';
            assert.match(authHeader, /Bearer/i);
            assert.doesNotMatch(authHeader, /Basic/i);
            const body = await res.json();
            assert.deepEqual(body, { error: 'Unauthorized', code: 'API_TOKEN_REQUIRED' });
        } finally {
            await close();
        }
    });

    await t.test('M-4: 不正なトークンの場合は 401', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret' });
        try {
            const res = await fetch(`${baseUrl}/parts`, {
                headers: { Authorization: 'Bearer wrong' }
            });
            assert.equal(res.status, 401);
        } finally {
            await close();
        }
    });

    await t.test('M-5: 正しいトークンの場合は 200', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret' });
        try {
            const res = await fetch(`${baseUrl}/parts`, {
                headers: { Authorization: 'Bearer s3cret' }
            });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.deepEqual(body, { ok: true });
        } finally {
            await close();
        }
    });

    await t.test('M-6: 小文字 bearer かつ 複数空白でも 200', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret' });
        try {
            const res = await fetch(`${baseUrl}/parts`, {
                headers: { Authorization: 'bearer  s3cret' }
            });
            assert.equal(res.status, 200);
        } finally {
            await close();
        }
    });

    await t.test('M-7: Basic 認証ヘッダーの場合は 401', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret' });
        try {
            const res = await fetch(`${baseUrl}/parts`, {
                headers: { Authorization: 'Basic YTpi' }
            });
            assert.equal(res.status, 401);
        } finally {
            await close();
        }
    });

    await t.test('M-8: GET /api/health はトークンなしでも免除（200）', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret' });
        try {
            const res = await fetch(`${baseUrl}/health`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.deepEqual(body, { status: 'ok' });
        } finally {
            await close();
        }
    });

    await t.test('M-9: isLambda: false の場合、POST /api/backup/export/worker は 401（LAN では免除しない）', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret', isLambda: false });
        try {
            const res = await fetch(`${baseUrl}/backup/export/worker`, { method: 'POST' });
            assert.equal(res.status, 401);
        } finally {
            await close();
        }
    });

    await t.test('M-10: isLambda: true の場合、POST /api/backup/export/worker は免除（200）', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret', isLambda: true });
        try {
            const res = await fetch(`${baseUrl}/backup/export/worker`, { method: 'POST' });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.deepEqual(body, { worker: true });
        } finally {
            await close();
        }
    });

    await t.test('M-11: 127.0.0.1 からの POST /api/parts も免除されず 401（ループバック免除なし）', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret' });
        try {
            const res = await fetch(`${baseUrl}/parts`, { method: 'POST' });
            assert.equal(res.status, 401);
        } finally {
            await close();
        }
    });

    await t.test('M-12: OPTIONS プリフライトリクエストは 204 を返す', async () => {
        const { baseUrl, close } = await createServer({ token: 's3cret' });
        try {
            const res = await fetch(`${baseUrl}/parts`, { method: 'OPTIONS' });
            assert.equal(res.status, 204);
        } finally {
            await close();
        }
    });
});
