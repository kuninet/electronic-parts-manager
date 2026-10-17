const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApiClient, ApiError } = require('../apiClient.js');

describe('MCP API Client Unit Tests (A-1 ~ A-11)', () => {
    let server;
    let baseUrl;
    let lastRequest = null;
    let handlerMode = 'default';

    before(async () => {
        server = http.createServer((req, res) => {
            lastRequest = {
                method: req.method,
                url: req.url,
                headers: req.headers,
            };

            if (handlerMode === 'hang') {
                // 応答を返さずに放置（タイムアウト検証用）
                return;
            }

            if (handlerMode === 'html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<!doctype html><html><body>Error</body></html>');
                return;
            }

            if (handlerMode === '401') {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }

            if (handlerMode === '403') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Forbidden' }));
                return;
            }

            if (handlerMode === '404') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Part not found' }));
                return;
            }

            if (handlerMode === '500') {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'SQLITE_BUSY' }));
                return;
            }

            // デフォルト応答
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([]));
        });

        await new Promise((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    test('A-1: クエリパラメータが正しく付与される', async () => {
        handlerMode = 'default';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        const res = await client.listParts({ search: 'LED', category_id: 2 });
        assert.deepEqual(res, []);
        assert.equal(lastRequest.url, '/api/parts?search=LED&category_id=2');
    });

    test('A-2: 空文字や undefined のクエリパラメータは除外される', async () => {
        handlerMode = 'default';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        const res = await client.listParts({ search: '', location_id: undefined, tag_id: null });
        assert.deepEqual(res, []);
        assert.equal(lastRequest.url, '/api/parts');
    });

    test('A-3: Authorization ヘッダーと Accept ヘッダーが送信される', async () => {
        handlerMode = 'default';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: 'Basic xxx', timeoutMs: 3000 });
        await client.listParts({});
        assert.equal(lastRequest.headers['authorization'], 'Basic xxx');
        assert.match(lastRequest.headers['accept'], /application\/json/);
        assert.match(lastRequest.headers['user-agent'], /^epm-mcp\//);
    });

    test('A-4: authHeader が null の場合は Authorization ヘッダーが含まれない', async () => {
        handlerMode = 'default';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await client.listParts({});
        assert.equal(lastRequest.headers['authorization'], undefined);
    });

    test('A-5: 404 レスポンス時は ApiError(not_found, 404) を投げる', async () => {
        handlerMode = '404';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.getPart(9999);
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'not_found');
                assert.equal(err.status, 404);
                return true;
            }
        );
    });

    test('A-6: 401 レスポンス時は ApiError(unauthorized, 401) を投げる', async () => {
        handlerMode = '401';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.listCategories();
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'unauthorized');
                assert.equal(err.status, 401);
                assert.match(err.message, /認証に失敗しました/);
                return true;
            }
        );
    });

    test('A-7: 403 レスポンス時は ApiError(forbidden, 403) を投げる', async () => {
        handlerMode = '403';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.listLocations();
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'forbidden');
                assert.equal(err.status, 403);
                assert.match(err.message, /アクセスが拒否されました/);
                return true;
            }
        );
    });

    test('A-8: 500 レスポンス時は ApiError(http, 500) を投げ、エラー詳細を含む', async () => {
        handlerMode = '500';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.listParts({});
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'http');
                assert.equal(err.status, 500);
                assert.match(err.message, /500/);
                assert.match(err.message, /SQLITE_BUSY/);
                return true;
            }
        );
    });

    test('A-9: 200 だが HTML などの非 JSON レスポンス時は ApiError(invalid_response) を投げる', async () => {
        handlerMode = 'html';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.listParts({});
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'invalid_response');
                assert.equal(err.status, 200);
                assert.match(err.message, /JSON 以外の応答/);
                return true;
            }
        );
    });

    test('A-10: 応答がない場合、約 100ms で ApiError(timeout) を投げる', async () => {
        handlerMode = 'hang';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 100 });
        const start = Date.now();
        await assert.rejects(
            async () => {
                await client.listParts({});
            },
            (err) => {
                const duration = Date.now() - start;
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'timeout');
                assert.equal(err.status, null);
                assert.match(err.message, /100ms/);
                assert.ok(duration >= 80 && duration <= 1000, `Duration was ${duration}ms`);
                return true;
            }
        );
    });

    test('A-11: 誰も listen していないポートへのリクエストは ApiError(network) を投げ、認証情報は漏洩しない', async () => {
        // 未使用ポートを確保して即座に閉じる
        const tempServer = http.createServer();
        await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
        const closedPort = tempServer.address().port;
        await new Promise((resolve) => tempServer.close(resolve));

        const deadUrl = `http://127.0.0.1:${closedPort}`;
        const secretAuth = 'Basic c2VjcmV0dXNlcjpzZWNyZXRwYXNz';
        const client = createApiClient({
            apiUrl: deadUrl,
            authHeader: secretAuth,
            timeoutMs: 1000,
        });

        await assert.rejects(
            async () => {
                await client.listParts({});
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'network');
                assert.equal(err.status, null);
                assert.match(err.message, new RegExp(deadUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
                assert.doesNotMatch(err.message, /secretuser/);
                assert.doesNotMatch(err.message, /secretpass/);
                assert.doesNotMatch(err.message, /c2VjcmV0/);
                return true;
            }
        );
    });
});
