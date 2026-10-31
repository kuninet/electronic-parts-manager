const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { loadConfig } = require('../config.js');
const { createApiClient } = require('../apiClient.js');
const { createHttpServer } = require('../http.js');

/**
 * ポート 0 で listen し、待ち受けポートを返します。
 */
function listen(server) {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

/**
 * HTTP サーバーを閉じます（keep-alive 接続が残っていても終了できるようにする）。
 */
function closeServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
    });
}

/**
 * Host ヘッダーを明示して HTTP リクエストを送り、ステータス・ヘッダー・本文を返します。
 */
function rawRequest({ port, method = 'GET', path = '/', headers = {}, body }) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                text: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        req.on('error', reject);
        if (body !== undefined) {
            req.write(body);
        }
        req.end();
    });
}

/**
 * 生のソケットで HTTP リクエスト文字列を送り、サーバーが閉じるまでの応答全体を返します。
 * Node の http.request では作れない形（Host 欠落、実体と食い違う Content-Length 等）の検証用です。
 */
function rawSocketRequest(port, requestText) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(requestText));
        const chunks = [];
        socket.on('data', (c) => chunks.push(c));
        socket.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: Number(/^HTTP\/1\.\d (\d+)/.exec(text)?.[1]), text });
        });
        socket.on('error', reject);
        socket.setTimeout(5000, () => {
            socket.destroy();
            reject(new Error('socket timeout'));
        });
    });
}

describe('MCP Remote HTTP Integration Tests (H-1 ~ H-18)', () => {
    let mockServer;
    let mockBaseUrl;
    let httpServer;
    let httpPort;
    let readOnlyServer;
    let readOnlyPort;
    let hostsServer;
    let hostsPort;
    let originsServer;
    let originsPort;
    const clients = [];

    function buildServer(extraEnv = {}) {
        const config = loadConfig({ EPM_API_URL: mockBaseUrl, ...extraEnv });
        return createHttpServer({ config, apiClient: createApiClient(config), version: 'test' });
    }

    async function connectClient(port) {
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
        const client = new Client({ name: 'http-test-client', version: '1.0.0' });
        await client.connect(transport);
        clients.push(client);
        return client;
    }

    before(async () => {
        mockServer = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (req.method === 'GET' && req.url === '/api/categories') {
                res.end(JSON.stringify([{ id: 10, name: 'LED' }]));
                return;
            }
            if (req.url.startsWith('/api/parts')) {
                res.end(JSON.stringify([{ id: 10, name: '10kΩ抵抗', part_number: 'R-10K' }]));
                return;
            }
            res.end(JSON.stringify([]));
        });
        await new Promise((resolve) => {
            mockServer.listen(0, '127.0.0.1', () => {
                mockBaseUrl = `http://127.0.0.1:${mockServer.address().port}`;
                resolve();
            });
        });

        httpServer = buildServer();
        httpPort = await listen(httpServer);

        readOnlyServer = buildServer({ EPM_MCP_READONLY: '1' });
        readOnlyPort = await listen(readOnlyServer);

        hostsServer = buildServer({ EPM_MCP_ALLOWED_HOSTS: 'epm.local' });
        hostsPort = await listen(hostsServer);

        originsServer = buildServer({ EPM_MCP_ALLOWED_ORIGINS: 'http://192.168.1.10:5173' });
        originsPort = await listen(originsServer);
    });

    after(async () => {
        for (const client of clients) {
            try {
                await client.close();
            } catch {
                // 既に閉じている場合は無視
            }
        }
        await Promise.all([
            closeServer(httpServer),
            closeServer(readOnlyServer),
            closeServer(hostsServer),
            closeServer(originsServer),
            closeServer(mockServer),
        ]);
    });

    test('H-1: listTools で 13 ツールが取得できる', async () => {
        const client = await connectClient(httpPort);
        const result = await client.listTools();
        assert.equal(result.tools.length, 13);
        assert.deepEqual(result.tools.map((t) => t.name).sort(), [
            'create_part',
            'get_part_detail',
            'get_part_image',
            'import_purchase_items',
            'list_import_batches',
            'list_master_data',
            'search_parts',
            'search_purchase_items',
            'store_part_location',
            'undo_import_batch',
            'update_part',
            'update_part_quantity',
            'update_purchase_item',
        ]);
    });

    test('H-2: callTool search_parts がモック API の結果を返す', async () => {
        const client = await connectClient(httpPort);
        const result = await client.callTool({ name: 'search_parts', arguments: { query: 'R' } });
        assert.equal(result.isError, undefined);
        const data = JSON.parse(result.content[0].text);
        assert.equal(data.total, 1);
        assert.equal(data.parts[0].name, '10kΩ抵抗');
    });

    test('H-3: 同じクライアントで callTool を続けて 2 回呼べる（ステートレス）', async () => {
        const client = await connectClient(httpPort);
        const first = await client.callTool({ name: 'search_parts', arguments: { query: 'R' } });
        const second = await client.callTool({ name: 'search_parts', arguments: { query: 'R' } });
        assert.equal(first.isError, undefined);
        assert.equal(second.isError, undefined);
        assert.equal(JSON.parse(second.content[0].text).total, 1);
    });

    test('H-4: readOnly の config では参照系 6 ツールのみ公開される', async () => {
        const client = await connectClient(readOnlyPort);
        const result = await client.listTools();
        assert.deepEqual(result.tools.map((t) => t.name).sort(), [
            'get_part_detail',
            'get_part_image',
            'list_import_batches',
            'list_master_data',
            'search_parts',
            'search_purchase_items',
        ]);
    });

    test('H-5: GET /health が 200 と status: ok を返す', async () => {
        const res = await rawRequest({ port: httpPort, path: '/health' });
        assert.equal(res.status, 200);
        const body = JSON.parse(res.text);
        assert.equal(body.status, 'ok');
        assert.equal(body.name, 'electronic-parts-manager-mcp');
        assert.equal(body.version, 'test');
        assert.equal(body.readOnly, false);
    });

    test('H-6: GET /mcp は 405 と Allow: POST を返す', async () => {
        const res = await rawRequest({ port: httpPort, path: '/mcp' });
        assert.equal(res.status, 405);
        assert.equal(res.headers.allow, 'POST');
        assert.equal(JSON.parse(res.text).error.message, 'Method not allowed.');
    });

    test('H-7: 未定義のパスは 404 を返す', async () => {
        const res = await rawRequest({ port: httpPort, path: '/unknown' });
        assert.equal(res.status, 404);
        assert.deepEqual(JSON.parse(res.text), { error: 'Not Found' });
    });

    test('H-8: 不正な JSON の POST /mcp は 400 と -32700 を返す', async () => {
        const res = await rawRequest({
            port: httpPort,
            method: 'POST',
            path: '/mcp',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: '{not json',
        });
        assert.equal(res.status, 400);
        assert.equal(JSON.parse(res.text).error.code, -32700);
    });

    test('H-9: allowedHosts 設定時は許可外の Host を 403 にし、許可済み・ループバックは通す', async () => {
        const evil = await rawRequest({ port: hostsPort, path: '/health', headers: { Host: 'evil.example' } });
        assert.equal(evil.status, 403);
        assert.equal(JSON.parse(evil.text).error.message, 'Forbidden: Host header is not allowed');

        const allowed = await rawRequest({ port: hostsPort, path: '/health', headers: { Host: 'epm.local:3002' } });
        assert.notEqual(allowed.status, 403);

        const loopback = await rawRequest({ port: hostsPort, path: '/health', headers: { Host: `127.0.0.1:${hostsPort}` } });
        assert.notEqual(loopback.status, 403);

        // IPv6 ループバック（ポート付き）と大文字の Host も通る
        const ipv6 = await rawRequest({ port: hostsPort, path: '/health', headers: { Host: `[::1]:${hostsPort}` } });
        assert.equal(ipv6.status, 200);
        const upper = await rawRequest({ port: hostsPort, path: '/health', headers: { Host: 'EPM.LOCAL:3002' } });
        assert.equal(upper.status, 200);

        // 形式に合わない Host は、許可ホスト名を含んでいても拒否する
        for (const badHost of ['evil@epm.local', 'epm.local/foo', 'epm.local:abc', 'epm local']) {
            const res = await rawRequest({ port: hostsPort, path: '/health', headers: { Host: badHost } });
            assert.equal(res.status, 403, `Host: ${badHost} は 403 であること (実際: ${res.status})`);
        }

        // Host ヘッダーが無い（HTTP/1.0）場合も拒否する
        const noHost = await rawSocketRequest(hostsPort, 'GET /health HTTP/1.0\r\n\r\n');
        assert.equal(noHost.status, 403);
    });

    test('H-10: allowedHosts が空なら任意の Host で 403 にならない', async () => {
        const res = await rawRequest({ port: httpPort, path: '/health', headers: { Host: 'evil.example' } });
        assert.notEqual(res.status, 403);
        assert.equal(res.status, 200);
    });

    test('H-11: 4 MiB を超える body は 413 を返す', async () => {
        const res = await rawRequest({
            port: httpPort,
            method: 'POST',
            path: '/mcp',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: Buffer.alloc(4 * 1024 * 1024 + 1024, 0x20),
        });
        assert.equal(res.status, 413);
        assert.equal(JSON.parse(res.text).error.message, 'Request body too large');
    });

    test('H-12: Content-Length が上限を大きく超える場合は本文を待たずに 413 を返す', async () => {
        const res = await rawSocketRequest(
            httpPort,
            'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 999999999\r\n\r\n'
        );
        assert.equal(res.status, 413);
        assert.match(res.text, /Request body too large/);
    });

    test('H-13: Origin ヘッダーが無いリクエストは通る', async () => {
        const res = await rawRequest({ port: originsPort, path: '/health' });
        assert.equal(res.status, 200);
    });

    test('H-14: 許可リストに無い Origin は 403 を返す（allowedOrigins が空なら Origin 付きはすべて拒否）', async () => {
        const evil = await rawRequest({ port: originsPort, path: '/health', headers: { Origin: 'http://evil.example' } });
        assert.equal(evil.status, 403);
        assert.equal(JSON.parse(evil.text).error.message, 'Forbidden: Origin is not allowed');

        const defaultServerRes = await rawRequest({ port: httpPort, path: '/health', headers: { Origin: 'http://192.168.1.10:5173' } });
        assert.equal(defaultServerRes.status, 403);
    });

    test('H-15: 許可リストにある Origin は通る', async () => {
        const res = await rawRequest({ port: originsPort, path: '/health', headers: { Origin: 'http://192.168.1.10:5173' } });
        assert.equal(res.status, 200);
    });

    test('H-16: Origin: null とパースできない Origin は 403 を返す', async () => {
        for (const origin of ['null', 'not a url']) {
            const res = await rawRequest({ port: originsPort, path: '/health', headers: { Origin: origin } });
            assert.equal(res.status, 403, `Origin: ${origin} は 403 であること`);
        }
    });

    test('H-17: Origin 検証は全パス・全メソッドに適用される', async () => {
        const post = await rawRequest({
            port: originsPort,
            method: 'POST',
            path: '/mcp',
            headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
            body: '{}',
        });
        assert.equal(post.status, 403);
        const get = await rawRequest({ port: originsPort, path: '/mcp', headers: { Origin: 'http://evil.example' } });
        assert.equal(get.status, 403);
    });

    test('H-18: 本文の受信中にクライアントが切断してもサーバーは落ちず、スタックを出さない', async () => {
        const originalError = console.error;
        const logged = [];
        console.error = (...args) => { logged.push(args); };
        try {
            await new Promise((resolve) => {
                const socket = net.connect(httpPort, '127.0.0.1', () => {
                    socket.write('POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"jsonrpc"');
                    setTimeout(() => socket.destroy(), 50);
                });
                socket.on('close', resolve);
                socket.on('error', () => {});
            });
            await new Promise((resolve) => setTimeout(resolve, 100));
        } finally {
            console.error = originalError;
        }
        // サーバーが生きていること
        const health = await rawRequest({ port: httpPort, path: '/health' });
        assert.equal(health.status, 200);
        // Error オブジェクト（スタック）をそのまま出力していないこと
        for (const args of logged) {
            assert.ok(!args.some((a) => a instanceof Error), 'Error オブジェクトを出力しない');
        }
    });
});
