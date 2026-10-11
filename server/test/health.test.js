const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDb } = require('./testHelper');

test('GET /api/health ヘルスチェック API のテスト', async (t) => {
    let app;
    let server;
    let baseUrl;
    let db;
    const databaseModule = require('../database');
    const originalGetDb = databaseModule.getDb;

    t.before(async () => {
        db = await createTestDb();
        databaseModule.getDb = () => db;

        app = express();
        app.use('/api/health', require('../routes/health'));

        server = await new Promise((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/health`;
    });

    t.after(async () => {
        databaseModule.getDb = originalGetDb;
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    await t.test('H-1: DB接続が正常な場合、200 OK と稼働時間を返すこと', async () => {
        databaseModule.getDb = () => db;
        const res = await fetch(baseUrl);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'ok');
        assert.equal(typeof body.uptime, 'number');
        assert.ok(body.uptime >= 0);
    });

    await t.test('H-2: DB接続エラーが発生した場合、503 と status: "error" を返し内部詳細を含めないこと', async () => {
        databaseModule.getDb = () => {
            throw new Error('Database connection failed');
        };
        const res = await fetch(baseUrl);
        assert.equal(res.status, 503);
        const body = await res.json();
        assert.deepEqual(body, { status: 'error' });
        assert.equal(body.message, undefined);
        assert.equal(body.stack, undefined);
    });

    await t.test('H-3: server/index.js で /api/health が /api/parts より前に登録されていること', () => {
        const indexPath = path.join(__dirname, '../index.js');
        const content = fs.readFileSync(indexPath, 'utf8');
        const healthIndex = content.indexOf("'/api/health'");
        const partsIndex = content.indexOf("'/api/parts'");
        assert.ok(healthIndex !== -1, '/api/health が index.js に登録されていること');
        assert.ok(partsIndex !== -1, '/api/parts が index.js に登録されていること');
        assert.ok(
            healthIndex < partsIndex,
            `/api/health (pos: ${healthIndex}) は /api/parts (pos: ${partsIndex}) より前でなければなりません`
        );
    });
});
