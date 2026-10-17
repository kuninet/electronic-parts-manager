const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/sdk/client/stdio.js');

describe('MCP Stdio Integration Tests (S-1 ~ S-4)', () => {
    let mockServer;
    let mockBaseUrl;
    let lastUrl = null;
    const entrypoint = path.resolve(__dirname, '../index.js');

    before(async () => {
        mockServer = http.createServer((req, res) => {
            lastUrl = req.url;
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

    test('S-1: stdio 経由でプロセスを起動し listTools で 3 ツールが取得できる', async () => {
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
            assert.equal(result.tools.length, 3);
            const names = result.tools.map((t) => t.name).sort();
            assert.deepEqual(names, ['get_part_detail', 'list_master_data', 'search_parts']);
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
        // 未使用ポートを確保して閉じる
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
            // 遅延接続のため listTools は成功する
            const listRes = await client.listTools();
            assert.equal(listRes.tools.length, 3);

            // ツール呼び出し時に network エラーで isError: true
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
});
