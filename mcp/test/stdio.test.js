const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/sdk/client/stdio.js');

describe('MCP Stdio Integration Tests (S-1 ~ S-12)', () => {
    let mockServer;
    let mockBaseUrl;
    let lastUrl = null;
    let lastPostedBody = null;
    const entrypoint = path.resolve(__dirname, '../index.js');

    before(async () => {
        mockServer = http.createServer((req, res) => {
            lastUrl = req.url;

            // Bearer 認証が必要なテスト用エンドポイント
            if (req.url.startsWith('/api/auth-test')) {
                const auth = req.headers['authorization'];
                if (auth !== 'Bearer tok') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized', code: 'API_TOKEN_REQUIRED' }));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify([{ id: 1, name: '認証成功パーツ' }]));
                return;
            }

            // create_part 結合テスト用
            if (req.method === 'POST' && req.url === '/api/parts') {
                let bodyStr = '';
                req.on('data', chunk => { bodyStr += chunk; });
                req.on('end', () => {
                    try {
                        lastPostedBody = JSON.parse(bodyStr);
                    } catch {
                        lastPostedBody = bodyStr;
                    }
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ id: 1 }));
                });
                return;
            }

            if (req.method === 'GET' && req.url === '/api/parts/1') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ id: 1, name: 'LED', category_id: 10 }));
                return;
            }

            if (req.method === 'GET' && req.url === '/api/parts/2') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ id: 2, name: 'カメラモジュール', image_path: '/uploads/test.png' }));
                return;
            }

            if (req.method === 'GET' && req.url === '/api/parts/3') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ id: 3, name: '画像なし部品', image_path: null }));
                return;
            }

            if (req.method === 'GET' && req.url === '/uploads/test.png') {
                const png1x1 = Buffer.from([
                    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
                    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
                    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
                    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
                    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
                    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
                    0x42, 0x60, 0x82,
                ]);
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': String(png1x1.length),
                });
                res.end(png1x1);
                return;
            }

            if (req.method === 'GET' && req.url === '/api/categories') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify([{ id: 10, name: 'LED' }]));
                return;
            }

            if (req.url.startsWith('/api/parts')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify([{ id: 10, name: '10kΩ抵抗', part_number: 'R-10K' }]));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([]));
        });

        await new Promise((resolve) => {
            mockServer.listen(0, '127.0.0.1', () => {
                const port = mockServer.address().port;
                mockBaseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((resolve) => mockServer.close(resolve));
    });

    test('S-1: stdio 経由でプロセスを起動し listTools で 13 ツールが取得できる', async () => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: mockBaseUrl,
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const result = await client.listTools();
            assert.equal(result.tools.length, 13);
            const names = result.tools.map((t) => t.name).sort();
            assert.deepEqual(names, [
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
        } finally {
            await client.close();
        }
    });

    test('S-2: stdio 経由で callTool search_parts を呼び出し API レスポンスを取得できる', async () => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: mockBaseUrl,
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const result = await client.callTool({
                name: 'search_parts',
                arguments: { query: 'R' },
            });

            assert.equal(result.isError, undefined);
            assert.equal(lastUrl, '/api/parts?search=R');
            const data = JSON.parse(result.content[0].text);
            assert.equal(data.total, 1);
            assert.equal(data.parts[0].name, '10kΩ抵抗');
        } finally {
            await client.close();
        }
    });

    test('S-3: 未起動のポートでも起動自体は成功し、ツール呼出時に isError: true が返る（遅延接続）', async () => {
        const tempServer = http.createServer();
        await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
        const deadPort = tempServer.address().port;
        await new Promise((resolve) => tempServer.close(resolve));
        const deadUrl = `http://127.0.0.1:${deadPort}`;

        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: deadUrl,
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const listRes = await client.listTools();
            assert.equal(listRes.tools.length, 13);

            const callRes = await client.callTool({
                name: 'search_parts',
                arguments: {},
            });
            assert.equal(callRes.isError, true);
            assert.match(callRes.content[0].text, /API サーバーに接続できません/);
        } finally {
            await client.close();
        }
    });

    test('S-4: EPM_BASIC_AUTH と EPM_AUTH_TOKEN の両方を設定すると終了コード 1 で終了し stdout は空', async () => {
        const child = spawn(process.execPath, [entrypoint], {
            env: {
                ...getDefaultEnvironment(),
                EPM_BASIC_AUTH: 'admin:password',
                EPM_AUTH_TOKEN: 'token123',
            },
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        const exitCode = await new Promise((resolve) => {
            child.on('close', resolve);
        });

        assert.equal(exitCode, 1);
        assert.equal(stdout, '');
        assert.match(stderr, /Cannot specify both EPM_BASIC_AUTH and EPM_AUTH_TOKEN/);
    });

    test('S-5: EPM_AUTH_TOKEN=tok が設定されている場合、Authorization: Bearer が送られ認証に成功する', async () => {
        // 認証必須サーバーを立ち上げる
        const authServer = http.createServer((req, res) => {
            if (req.headers['authorization'] !== 'Bearer tok') {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized', code: 'API_TOKEN_REQUIRED' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([{ id: 1, name: '認証成功パーツ' }]));
        });

        let authPort;
        await new Promise((resolve) => {
            authServer.listen(0, '127.0.0.1', () => {
                authPort = authServer.address().port;
                resolve();
            });
        });

        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: `http://127.0.0.1:${authPort}`,
                EPM_AUTH_TOKEN: 'tok',
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const res = await client.callTool({
                name: 'search_parts',
                arguments: {},
            });
            assert.equal(res.isError, undefined);
            const data = JSON.parse(res.content[0].text);
            assert.equal(data.parts[0].name, '認証成功パーツ');
        } finally {
            await client.close();
            await new Promise((r) => authServer.close(r));
        }
    });

    test('S-6: 認証必須サーバーに対して EPM_AUTH_TOKEN が未設定の場合、isError: true で EPM_AUTH_TOKEN 案内を含む', async () => {
        const authServer = http.createServer((req, res) => {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized', code: 'API_TOKEN_REQUIRED' }));
        });

        let authPort;
        await new Promise((resolve) => {
            authServer.listen(0, '127.0.0.1', () => {
                authPort = authServer.address().port;
                resolve();
            });
        });

        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: `http://127.0.0.1:${authPort}`,
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const res = await client.callTool({
                name: 'search_parts',
                arguments: {},
            });
            assert.equal(res.isError, true);
            assert.match(res.content[0].text, /EPM_AUTH_TOKEN/);
        } finally {
            await client.close();
            await new Promise((r) => authServer.close(r));
        }
    });

    test('S-7: create_part { name: "LED", category_name: "LED" } でマスタ解決され POST された category_id が渡り作成結果が返る', async () => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: mockBaseUrl,
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const res = await client.callTool({
                name: 'create_part',
                arguments: { name: 'LED', category_name: 'LED' },
            });

            assert.equal(res.isError, undefined);
            assert.ok(lastPostedBody);
            assert.equal(lastPostedBody.name, 'LED');
            assert.equal(lastPostedBody.category_id, 10);

            const body = JSON.parse(res.content[0].text);
            assert.equal(body.created, true);
            assert.equal(body.part.id, 1);
        } finally {
            await client.close();
        }
    });

    test('S-8: EPM_MCP_READONLY=1 の場合、listTools で参照系 6 ツールのみ返る', async () => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: mockBaseUrl,
                EPM_MCP_READONLY: '1',
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const result = await client.listTools();
            assert.equal(result.tools.length, 6);
            const names = result.tools.map((t) => t.name).sort();
            assert.deepEqual(names, ['get_part_detail', 'get_part_image', 'list_import_batches', 'list_master_data', 'search_parts', 'search_purchase_items']);
        } finally {
            await client.close();
        }
    });

    test('S-9: stdio 経由で callTool get_part_image { id: 2 } を呼び出し画像コンテンツを受信できる', async () => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: mockBaseUrl,
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const res = await client.callTool({
                name: 'get_part_image',
                arguments: { id: 2 },
            });

            assert.equal(res.isError, undefined);
            assert.equal(res.content.length, 2);
            assert.equal(res.content[0].type, 'image');
            assert.equal(res.content[0].mimeType, 'image/png');
            assert.ok(typeof res.content[0].data === 'string');
            assert.equal(res.content[1].type, 'text');
            assert.match(res.content[1].text, /カメラモジュール/);
        } finally {
            await client.close();
        }
    });

    test('S-10: stdio 経由で画像未登録部品 (id: 3) はテキストで「登録されていません」を返す', async () => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: mockBaseUrl,
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const res = await client.callTool({
                name: 'get_part_image',
                arguments: { id: 3 },
            });

            assert.equal(res.isError, undefined);
            assert.equal(res.content.length, 1);
            assert.equal(res.content[0].type, 'text');
            assert.match(res.content[0].text, /画像が登録されていません/);
        } finally {
            await client.close();
        }
    });

    test('S-11: EPM_IMAGE_MAX_BYTES=10 で上限超過時は isError: true となり、その後もサーバーは継続して応答する', async () => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: mockBaseUrl,
                EPM_IMAGE_MAX_BYTES: '10',
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const res = await client.callTool({
                name: 'get_part_image',
                arguments: { id: 2 },
            });

            assert.equal(res.isError, true);
            assert.match(res.content[0].text, /大きすぎます/);

            // 継続して listTools が実行可能
            const toolsRes = await client.listTools();
            assert.equal(toolsRes.tools.length, 13);
        } finally {
            await client.close();
        }
    });

    test('S-12: EPM_MCP_READONLY=1 環境下で get_part_image が正しく動作する', async () => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entrypoint],
            env: {
                ...getDefaultEnvironment(),
                EPM_API_URL: mockBaseUrl,
                EPM_MCP_READONLY: '1',
            },
        });

        const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
        await client.connect(transport);

        try {
            const res = await client.callTool({
                name: 'get_part_image',
                arguments: { id: 2 },
            });

            assert.equal(res.isError, undefined);
            assert.equal(res.content[0].type, 'image');
        } finally {
            await client.close();
        }
    });
});
