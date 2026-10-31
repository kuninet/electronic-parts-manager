const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApiClient, ApiError } = require('../apiClient.js');

describe('MCP API Client Unit Tests (A-1 ~ A-34)', () => {
    let server;
    let baseUrl;
    let lastRequest = null;
    let handlerMode = 'default';

    before(async () => {
        server = http.createServer((req, res) => {
            let bodyStr = '';
            req.on('data', (chunk) => { bodyStr += chunk; });
            req.on('end', () => {
                lastRequest = {
                    method: req.method,
                    url: req.url,
                    headers: req.headers,
                    body: bodyStr,
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

                if (handlerMode === '400') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '部品名は必須です' }));
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
                    res.end(JSON.stringify({ error: '保管場所が見つかりません' }));
                    return;
                }

                if (handlerMode === '409') {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'QRコードが重複しています' }));
                    return;
                }

                if (handlerMode === '500') {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'SQLITE_BUSY' }));
                    return;
                }

                if (handlerMode === 'image-png') {
                    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02]);
                    res.writeHead(200, {
                        'Content-Type': 'image/png',
                        'Content-Length': String(pngBytes.length),
                    });
                    res.end(pngBytes);
                    return;
                }

                if (handlerMode === 'image-empty') {
                    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': '0' });
                    res.end();
                    return;
                }

                if (handlerMode === 'image-html') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<!doctype html><html><body>Error</body></html>');
                    return;
                }

                if (handlerMode === 'image-404-html') {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end('<!DOCTYPE html><html lang="en"><head><title>Error</title></head><body>Cannot GET /uploads/notfound.jpg</body></html>');
                    return;
                }

                if (handlerMode === 'image-too-large-cl') {
                    const bigBuf = Buffer.alloc(5000, 0xAA);
                    res.writeHead(200, {
                        'Content-Type': 'image/png',
                        'Content-Length': '5000',
                    });
                    res.end(bigBuf);
                    return;
                }

                if (handlerMode === 'image-chunked-too-large') {
                    res.writeHead(200, {
                        'Content-Type': 'image/png',
                    });
                    const chunk = Buffer.alloc(600, 0xBB);
                    res.write(chunk);
                    res.write(chunk);
                    res.write(chunk);
                    res.end();
                    return;
                }

                if (handlerMode === 'image-exact-limit') {
                    const exactBuf = Buffer.alloc(1000, 0xCC);
                    res.writeHead(200, {
                        'Content-Type': 'image/png',
                        'Content-Length': '1000',
                    });
                    res.end(exactBuf);
                    return;
                }

                if (handlerMode === 'redirect-302') {
                    res.writeHead(302, { 'Location': 'http://127.0.0.1:9999/other' });
                    res.end();
                    return;
                }

                // デフォルト応答
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(req.method === 'POST' ? { id: 1 } : []));
            });
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

    test('A-12: POST リクエストで Content-Type: application/json と JSON 文字列化された body が送信される', async () => {
        handlerMode = 'default';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: 'Bearer testtoken',
            timeoutMs: 3000
        });
        const res = await client.post('/api/parts', { name: 'R' });
        assert.deepEqual(res, { id: 1 });
        assert.equal(lastRequest.method, 'POST');
        assert.equal(lastRequest.headers['content-type'], 'application/json');
        assert.equal(lastRequest.headers['authorization'], 'Bearer testtoken');
        assert.equal(lastRequest.body, JSON.stringify({ name: 'R' }));
    });

    test('A-13: 400 レスポンス時は ApiError(bad_request, 400) を投げ、エラー詳細を含む', async () => {
        handlerMode = '400';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.post('/api/parts', {});
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'bad_request');
                assert.equal(err.status, 400);
                assert.match(err.message, /部品名は必須です/);
                return true;
            }
        );
    });

    test('A-14: 404 レスポンス時は ApiError(not_found, 404) を投げ、本文のエラー詳細を保持する', async () => {
        handlerMode = '404';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.post('/api/qr/store', { part_id: 1, location_id: 999 });
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'not_found');
                assert.equal(err.status, 404);
                assert.match(err.message, /保管場所が見つかりません/);
                return true;
            }
        );
    });

    test('A-15: 409 レスポンス時は ApiError(conflict, 409) を投げる', async () => {
        handlerMode = '409';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.post('/api/parts', { qr_code: 'DUP' });
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'conflict');
                assert.equal(err.status, 409);
                assert.match(err.message, /QRコードが重複しています/);
                return true;
            }
        );
    });

    test('A-16: authType: "none" で 401 の場合、EPM_AUTH_TOKEN の設定を案内するメッセージを返す', async () => {
        handlerMode = '401';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: null,
            authType: 'none',
            timeoutMs: 3000
        });
        await assert.rejects(
            async () => {
                await client.get('/api/parts');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'unauthorized');
                assert.equal(err.status, 401);
                assert.match(err.message, /EPM_AUTH_TOKEN/);
                assert.match(err.message, /EPM_API_TOKEN/);
                return true;
            }
        );
    });

    test('A-17: authType: "bearer" で 401 の場合、「一致しません」と EPM_AUTH_TOKEN を含むメッセージを返す', async () => {
        handlerMode = '401';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: 'Bearer wrongtoken',
            authType: 'bearer',
            timeoutMs: 3000
        });
        await assert.rejects(
            async () => {
                await client.get('/api/parts');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'unauthorized');
                assert.equal(err.status, 401);
                assert.match(err.message, /一致しません/);
                assert.match(err.message, /EPM_AUTH_TOKEN/);
                return true;
            }
        );
    });

    test('A-18: authType: "basic" で 401 の場合、EPM_BASIC_AUTH を含むメッセージを返す', async () => {
        handlerMode = '401';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: 'Basic dXNlcjp3cm9uZw==',
            authType: 'basic',
            timeoutMs: 3000
        });
        await assert.rejects(
            async () => {
                await client.get('/api/parts');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'unauthorized');
                assert.equal(err.status, 401);
                assert.match(err.message, /EPM_BASIC_AUTH/);
                return true;
            }
        );
    });

    test('A-19: POST リクエストがタイムアウトした場合、unknownOutcome: true が付与され、GET では偽となる', async () => {
        handlerMode = 'hang';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 100 });

        // POST のタイムアウト
        await assert.rejects(
            async () => {
                await client.post('/api/parts', { name: 'LED' });
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'timeout');
                assert.equal(err.unknownOutcome, true);
                return true;
            }
        );

        // GET のタイムアウト
        await assert.rejects(
            async () => {
                await client.get('/api/parts');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'timeout');
                assert.equal(err.unknownOutcome, false);
                return true;
            }
        );
    });

    test('A-19b: patchPart は PATCH メソッドで Content-Type と JSON body を送り、タイムアウトは unknownOutcome: true になる', async () => {
        handlerMode = 'default';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: 'Bearer testtoken',
            timeoutMs: 3000
        });
        await client.patchPart(7, { shop: '秋月電子', unit_price: null });
        assert.equal(lastRequest.method, 'PATCH');
        assert.equal(lastRequest.url, '/api/parts/7');
        assert.equal(lastRequest.headers['content-type'], 'application/json');
        assert.equal(lastRequest.body, JSON.stringify({ shop: '秋月電子', unit_price: null }));

        handlerMode = 'hang';
        const slowClient = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 100 });
        await assert.rejects(
            async () => {
                await slowClient.patchPart(7, { shop: 'x' });
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'timeout');
                assert.equal(err.unknownOutcome, true);
                return true;
            }
        );
    });

    test('A-19c: 購入履歴の API（listPurchases / getPurchase / importPurchases / patchPurchase）が正しいメソッド・パス・本文で呼ばれ、書き込みのタイムアウトは unknownOutcome: true になる', async () => {
        handlerMode = 'default';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });

        await client.listPurchases({ search: 'LED', linked: false, part_id: undefined, limit: 10, offset: 0 });
        assert.equal(lastRequest.method, 'GET');
        const listUrl = new URL(lastRequest.url, 'http://x');
        assert.equal(listUrl.pathname, '/api/purchases');
        assert.equal(listUrl.searchParams.get('search'), 'LED');
        assert.equal(listUrl.searchParams.get('linked'), 'false');
        assert.equal(listUrl.searchParams.get('limit'), '10');
        assert.equal(listUrl.searchParams.get('offset'), '0');
        assert.equal(listUrl.searchParams.has('part_id'), false);

        await client.getPurchase(5);
        assert.equal(lastRequest.method, 'GET');
        assert.equal(lastRequest.url, '/api/purchases/5');

        const importBody = { records: [{ shop: 'A', name: 'x', order_id: '1' }], on_duplicate: 'update' };
        await client.importPurchases(importBody);
        assert.equal(lastRequest.method, 'POST');
        assert.equal(lastRequest.url, '/api/purchases/import');
        assert.equal(lastRequest.headers['content-type'], 'application/json');
        assert.equal(lastRequest.body, JSON.stringify(importBody));

        await client.patchPurchase(5, { part_id: null });
        assert.equal(lastRequest.method, 'PATCH');
        assert.equal(lastRequest.url, '/api/purchases/5');
        assert.equal(lastRequest.body, JSON.stringify({ part_id: null }));

        handlerMode = 'hang';
        const slowClient = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 100 });
        for (const run of [
            () => slowClient.importPurchases({ records: [] }),
            () => slowClient.patchPurchase(5, { note: 'x' }),
        ]) {
            await assert.rejects(run, (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'timeout');
                assert.equal(err.unknownOutcome, true);
                return true;
            });
        }
        await assert.rejects(() => slowClient.listPurchases({}), (err) => {
            assert.equal(err.unknownOutcome, false);
            return true;
        });
    });

    test('A-21: getImage(/uploads/a.png) が PNG バイト列、contentType、size を正しく取得する', async () => {
        handlerMode = 'image-png';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        const res = await client.getImage('/uploads/a.png');
        assert.ok(Buffer.isBuffer(res.buffer));
        assert.equal(res.contentType, 'image/png');
        assert.equal(res.size, 10);
        assert.equal(res.buffer[0], 0x89);
        assert.equal(res.buffer[1], 0x50);
    });

    test('A-22: authHeader が設定されている場合、Authorization と Accept: image/* が送信される', async () => {
        handlerMode = 'image-png';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: 'Basic dXNlcjpwYXNz',
            timeoutMs: 3000,
        });
        await client.getImage('/uploads/a.png');
        assert.equal(lastRequest.headers['authorization'], 'Basic dXNlcjpwYXNz');
        assert.equal(lastRequest.headers['accept'], 'image/*');
    });

    test('A-23: authHeader が null の場合、Authorization ヘッダーは送信されない', async () => {
        handlerMode = 'image-png';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await client.getImage('/uploads/a.png');
        assert.equal(lastRequest.headers['authorization'], undefined);
    });

    test('A-24: モックが 404 の場合、kind: not_found で「画像ファイルが見つかりません」を投げる', async () => {
        handlerMode = '404';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.getImage('/uploads/missing.jpg');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'not_found');
                assert.equal(err.status, 404);
                assert.match(err.message, /画像ファイルが見つかりません/);
                return true;
            }
        );
    });

    test('A-25: モックが 401 かつ authType: basic の場合、kind: unauthorized で EPM_BASIC_AUTH 案内を含む', async () => {
        handlerMode = '401';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: 'Basic xxx',
            authType: 'basic',
            timeoutMs: 3000,
        });
        await assert.rejects(
            async () => {
                await client.getImage('/uploads/secret.jpg');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'unauthorized');
                assert.equal(err.status, 401);
                assert.match(err.message, /EPM_BASIC_AUTH/);
                return true;
            }
        );
    });

    test('A-26: モックが 200 かつ text/html の場合、kind: invalid_response で text/html を含む', async () => {
        handlerMode = 'image-html';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.getImage('/uploads/missing-on-s3.jpg');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'invalid_response');
                assert.match(err.message, /text\/html/);
                return true;
            }
        );
    });

    test('A-27: Content-Length: 5000 かつ imageMaxBytes: 1000 の場合、kind: too_large で上限エラー', async () => {
        handlerMode = 'image-too-large-cl';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: null,
            timeoutMs: 3000,
            imageMaxBytes: 1000,
        });
        await assert.rejects(
            async () => {
                await client.getImage('/uploads/too-big.png');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'too_large');
                assert.match(err.message, /EPM_IMAGE_MAX_BYTES/);
                return true;
            }
        );
    });

    test('A-28: chunked で 600×3 送信かつ imageMaxBytes: 1000 の場合、読み取り途中で kind: too_large', async () => {
        handlerMode = 'image-chunked-too-large';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: null,
            timeoutMs: 3000,
            imageMaxBytes: 1000,
        });
        await assert.rejects(
            async () => {
                await client.getImage('/uploads/chunked.png');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'too_large');
                assert.match(err.message, /EPM_IMAGE_MAX_BYTES/);
                return true;
            }
        );
    });

    test('A-29: imageMaxBytes: 1000 でちょうど 1000 バイトの場合は成功する（境界値）', async () => {
        handlerMode = 'image-exact-limit';
        const client = createApiClient({
            apiUrl: baseUrl,
            authHeader: null,
            timeoutMs: 3000,
            imageMaxBytes: 1000,
        });
        const res = await client.getImage('/uploads/exact.png');
        assert.equal(res.size, 1000);
        assert.equal(res.buffer.length, 1000);
    });

    test('A-30: 応答がない場合、timeoutMs: 100 で kind: timeout, unknownOutcome: false', async () => {
        handlerMode = 'hang';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 100 });
        await assert.rejects(
            async () => {
                await client.getImage('/uploads/slow.jpg');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'timeout');
                assert.equal(err.unknownOutcome, false);
                return true;
            }
        );
    });

    test('A-31: 302 リダイレクト時は redirect: error により失敗しリダイレクト先に要求は出ない', async () => {
        handlerMode = 'redirect-302';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.getImage('/uploads/redirect.jpg');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.ok(err.kind === 'network' || err.kind === 'http');
                return true;
            }
        );
    });

    test('A-32: 他オリジンや uploads 外のパスは kind: bad_request となり fetchImpl は呼ばれない', async () => {
        let fetchCalled = 0;
        const mockFetch = async () => {
            fetchCalled++;
            return new Response('ok');
        };
        const client = createApiClient(
            { apiUrl: 'http://localhost:3001', authHeader: 'Basic secret', timeoutMs: 3000 },
            { fetchImpl: mockFetch }
        );

        await assert.rejects(
            async () => {
                await client.getImage('https://evil.example/uploads/a.jpg');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'bad_request');
                return true;
            }
        );

        await assert.rejects(
            async () => {
                await client.getImage('/api/parts/1');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'bad_request');
                return true;
            }
        );

        assert.equal(fetchCalled, 0, 'fetchImpl must not be called for unsafe paths');
    });

    test('A-33: モックが 200 で長さ 0 の場合、kind: invalid_response で「画像データが空です」', async () => {
        handlerMode = 'image-empty';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.getImage('/uploads/empty.jpg');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'invalid_response');
                assert.match(err.message, /画像データが空です/);
                return true;
            }
        );
    });

    test('A-34: Express の 404 HTML レスポンス時も HTML 断片を含まず「画像ファイルが見つかりません」を投げる', async () => {
        handlerMode = 'image-404-html';
        const client = createApiClient({ apiUrl: baseUrl, authHeader: null, timeoutMs: 3000 });
        await assert.rejects(
            async () => {
                await client.getImage('/uploads/notfound.jpg');
            },
            (err) => {
                assert.ok(err instanceof ApiError);
                assert.equal(err.kind, 'not_found');
                assert.equal(err.status, 404);
                assert.match(err.message, /画像ファイルが見つかりません/);
                assert.doesNotMatch(err.message, /<html|Cannot GET/i);
                return true;
            }
        );
    });
});
