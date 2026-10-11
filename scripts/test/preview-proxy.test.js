const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const clientDir = path.resolve(repoRoot, 'client');
const viteConfigPath = path.resolve(clientDir, 'vite.config.js');
const distDir = path.resolve(clientDir, 'dist');
const viteBin = path.resolve(clientDir, 'node_modules/vite/bin/vite.js');

function checkPortInUse(port) {
    return new Promise((resolve) => {
        const client = net.connect(port, 'localhost', () => {
            client.destroy();
            resolve(true);
        });
        client.on('error', () => resolve(false));
        client.setTimeout(1000, () => {
            client.destroy();
            resolve(false);
        });
    });
}

function getAvailablePort(startPort = 5210) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(startPort, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => {
            getAvailablePort(startPort + 1).then(resolve, reject);
        });
    });
}

function fetchHttps(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { rejectUnauthorized: false }, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, headers: res.headers, body });
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy(new Error('Request timeout'));
        });
    });
}

test('vite preview プロキシ自動テスト (PP-1 〜 PP-3)', async (t) => {
    await t.test('PP-1: vite.config.js の preview.proxy 設定が正しいこと', () => {
        const content = fs.readFileSync(viteConfigPath, 'utf8');
        assert.match(content, /preview:\s*\{/, 'preview 設定ブロックが存在すること');
        assert.match(content, /'\/api':\s*\{\s*target:\s*'http:\/\/localhost:3001'/, 'preview.proxy に /api -> http://localhost:3001 設定が存在すること');
        assert.match(content, /'\/uploads':\s*\{\s*target:\s*'http:\/\/localhost:3001'/, 'preview.proxy に /uploads -> http://localhost:3001 設定が存在すること');
        assert.match(content, /changeOrigin:\s*true/, 'changeOrigin が true であること');
    });

    await t.test('PP-2: client/dist ビルド成果物が存在すること', (t2) => {
        if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
            t2.skip('client/dist が未ビルドのためスキップ');
            return;
        }
        assert.ok(fs.existsSync(distDir), 'client/dist ディレクトリが存在すること');
        const indexHtml = path.join(distDir, 'index.html');
        assert.ok(fs.existsSync(indexHtml), 'client/dist/index.html が存在すること');
    });

    await t.test('PP-3: vite preview 経由で静的ファイルおよび /api プロキシが正常に応答すること', async (t2) => {
        if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
            t2.skip('client/dist が未ビルドのためスキップ');
            return;
        }
        assert.ok(fs.existsSync(viteBin), 'vite 実行ファイルが存在すること');

        const port3001Busy = await checkPortInUse(3001);
        let mockServer = null;

        if (!port3001Busy) {
            // CI環境など 3001 が空いている場合はモック HTTP サーバーを起動
            mockServer = http.createServer((req, res) => {
                if (req.url === '/api/parts') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify([{ id: 1, name: 'test-part', source: 'mock-server' }]));
                } else if (req.url === '/api/health') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', source: 'mock-server' }));
                } else {
                    res.writeHead(404);
                    res.end('not found');
                }
            });
            await new Promise((resolve) => mockServer.listen(3001, '0.0.0.0', resolve));
        }

        const previewPort = await getAvailablePort(5210);

        // vite preview を起動
        const child = spawn(process.execPath, [viteBin, 'preview', '--port', String(previewPort), '--strictPort'], {
            cwd: clientDir,
            env: { ...process.env, VITE_PORT: String(previewPort) },
            stdio: ['ignore', 'ignore', 'ignore']
        });

        function cleanup() {
            try { child.kill('SIGTERM'); } catch (_) {}
            if (mockServer) {
                try { mockServer.close(); } catch (_) {}
            }
        }

        // 起動待ち (最大 10 秒)
        await new Promise((resolve, reject) => {
            let done = false;
            let timer = null;

            const timeout = setTimeout(() => {
                if (done) return;
                done = true;
                if (timer) clearTimeout(timer);
                cleanup();
                reject(new Error('vite preview の起動がタイムアウトしました'));
            }, 10000);

            function check() {
                if (done) return;
                const tester = net.connect(previewPort, '127.0.0.1', () => {
                    tester.destroy();
                    if (done) return;
                    done = true;
                    clearTimeout(timeout);
                    if (timer) clearTimeout(timer);
                    resolve();
                });
                tester.on('error', () => {
                    if (done) return;
                    timer = setTimeout(check, 200);
                });
            }
            check();
        });

        try {
            // 1. 静的ファイルへのアクセス確認
            const staticRes = await fetchHttps(`https://127.0.0.1:${previewPort}/index.html`);
            assert.equal(staticRes.statusCode, 200, 'index.html は 200 OK を返すこと');
            assert.ok(staticRes.body.includes('<html') || staticRes.body.includes('<!DOCTYPE html>'), 'HTMLコンテンツが返ること');

            // 2. /api へのプロキシ転送確認
            const apiRes = await fetchHttps(`https://127.0.0.1:${previewPort}/api/parts`);
            assert.equal(apiRes.statusCode, 200, '/api/parts へのプロキシ転送が 200 OK であること');
            assert.ok(apiRes.headers['content-type']?.includes('application/json'), 'Content-Type が JSON であること');

            const bodyJson = JSON.parse(apiRes.body);
            assert.ok(Array.isArray(bodyJson), 'パーツ一覧の配列が返ること');

            if (mockServer) {
                assert.equal(bodyJson[0].source, 'mock-server', 'モックサーバーからのレスポンスを受信したこと');
            }
        } finally {
            cleanup();
        }
    });
});
