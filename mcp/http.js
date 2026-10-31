#!/usr/bin/env node

/**
 * リモート MCP サーバーエントリポイント（Streamable HTTP）
 * LAN 内の別 PC の AI クライアントから http://<host>:<port>/mcp で接続できるようにします。
 * ステートレスモードで動作し、リクエストごとに McpServer と transport を生成します。
 *
 * 注意: クライアント → MCP サーバー間の認証は設けていません（家庭内 LAN 専用）。
 * インターネットに公開しないでください。ログはすべて stderr (console.error) に出力します。
 */

const http = require('node:http');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { version: packageVersion } = require('../package.json');
const { loadConfig } = require('./config.js');
const { createApiClient } = require('./apiClient.js');
const { createMcpServer } = require('./server.js');

/** リクエスト本文の上限（4 MiB） */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** allowedHosts 設定時でも常に許可するホスト名（PM2 のヘルスチェック等のループバック接続用） */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * JSON 応答を返します。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status HTTP ステータスコード
 * @param {object} body 応答本文（JSON 化される）
 * @param {Record<string, string>} [extraHeaders] 追加ヘッダー
 */
function sendJson(res, status, body, extraHeaders = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
    res.end(JSON.stringify(body));
}

/**
 * JSON-RPC 形式のエラー本文を組み立てます。
 *
 * @param {number} code JSON-RPC エラーコード
 * @param {string} message エラーメッセージ
 * @returns {object}
 */
function jsonRpcError(code, message) {
    return { jsonrpc: '2.0', error: { code, message }, id: null };
}

/** Host ヘッダーとして受け付ける形式（ホスト名または角括弧付き IPv6、任意のポート） */
const HOST_HEADER_PATTERN = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d+)?$/i;

/**
 * Host ヘッダーからホスト名（ポートなし・小文字）を取り出します。取り出せなければ null。
 * IPv6 は [::1] の形で返ります。形式に合わないヘッダー（evil@epm.local, epm.local/foo 等）は null です。
 *
 * @param {string | undefined} hostHeader
 * @returns {string | null}
 */
function extractHostname(hostHeader) {
    if (!hostHeader || !HOST_HEADER_PATTERN.test(hostHeader)) {
        return null;
    }
    try {
        return new URL('http://' + hostHeader).hostname.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * Origin ヘッダーを new URL(...).origin の形に正規化します。パースできない値（"null" を含む）は null。
 *
 * @param {string} originHeader
 * @returns {string | null}
 */
function normalizeOrigin(originHeader) {
    try {
        const origin = new URL(originHeader).origin;
        return origin === 'null' ? null : origin;
    } catch {
        return null;
    }
}

/**
 * クライアントによる接続切断かどうかを判定します。
 *
 * @param {any} err
 * @returns {boolean}
 */
function isClientDisconnect(err) {
    return Boolean(err) && (err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_PREMATURE_CLOSE' || err.message === 'aborted');
}

/**
 * 後始末用に close() を呼び、失敗しても握りつぶします。
 *
 * @param {{ close: () => Promise<void> }} target
 */
function safeClose(target) {
    try {
        target.close().catch(() => {});
    } catch {
        // 同期的な例外も無視する
    }
}

/**
 * リクエスト本文を読み取ります。上限を超えたら読み取りを打ち切って tooLarge: true を返します。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit 上限バイト数
 * @returns {Promise<{ tooLarge: boolean, text: string }>}
 */
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let received = 0;
        let settled = false;

        const onData = (chunk) => {
            received += chunk.length;
            if (received > limit) {
                settled = true;
                req.removeListener('data', onData);
                // 残りの本文は読み捨てる（応答を返せるようにストリームは流しておく）
                req.resume();
                resolve({ tooLarge: true, text: '' });
                return;
            }
            chunks.push(chunk);
        };

        req.on('data', onData);
        req.on('end', () => {
            if (!settled) {
                settled = true;
                resolve({ tooLarge: false, text: Buffer.concat(chunks).toString('utf8') });
            }
        });
        req.on('error', (err) => {
            if (!settled) {
                settled = true;
                reject(err);
            }
        });
        // 古い Node では切断が 'aborted' イベントで通知される
        req.on('aborted', () => {
            if (!settled) {
                settled = true;
                reject(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));
            }
        });
    });
}

/**
 * POST /mcp を処理します。リクエストごとに McpServer と transport を生成します（ステートレス）。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ config: object, apiClient: object, version: string }} context
 */
async function handleMcpPost(req, res, { config, apiClient, version }) {
    // Content-Length が上限を超えるなら、本文を読む前に拒否する
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        sendJson(res, 413, jsonRpcError(-32000, 'Request body too large'), { Connection: 'close' });
        return;
    }

    const { tooLarge, text } = await readBody(req, MAX_BODY_BYTES);
    if (tooLarge) {
        sendJson(res, 413, jsonRpcError(-32000, 'Request body too large'), { Connection: 'close' });
        return;
    }

    let body;
    try {
        body = JSON.parse(text);
    } catch {
        sendJson(res, 400, jsonRpcError(-32700, 'Parse error'));
        return;
    }

    const server = createMcpServer({ apiClient, version, readOnly: config.readOnly });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
        safeClose(transport);
        safeClose(server);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
}

/**
 * HTTP サーバーを生成します（listen はしません）。
 *
 * @param {{ config: object, apiClient: object, version?: string }} options
 * @returns {import('node:http').Server}
 */
function createHttpServer({ config, apiClient, version = packageVersion }) {
    const allowedHosts = config.allowedHosts && config.allowedHosts.length > 0
        ? new Set([...config.allowedHosts, ...LOOPBACK_HOSTS])
        : null;
    const allowedOrigins = new Set(config.allowedOrigins || []);

    return http.createServer(async (req, res) => {
        try {
            // 1. Host 検証（allowedHosts 設定時のみ。DNS リバインディング対策）
            if (allowedHosts) {
                const hostname = extractHostname(req.headers.host);
                if (hostname === null || !allowedHosts.has(hostname)) {
                    console.error(`[epm-mcp-http] rejected host: ${req.headers.host}`);
                    sendJson(res, 403, jsonRpcError(-32000, 'Forbidden: Host header is not allowed'));
                    return;
                }
            }

            // 2. Origin 検証（常に有効）。MCP 仕様でサーバーに義務づけられている。
            // Origin ヘッダーが無いリクエスト（Node 製クライアント等）は通し、ブラウザ由来は許可リストにあるものだけ通す
            if (req.headers.origin !== undefined) {
                const origin = normalizeOrigin(req.headers.origin);
                if (origin === null || !allowedOrigins.has(origin)) {
                    console.error(`[epm-mcp-http] rejected origin: ${req.headers.origin}`);
                    sendJson(res, 403, jsonRpcError(-32000, 'Forbidden: Origin is not allowed'));
                    return;
                }
            }

            // 3. ルーティング
            const pathname = new URL(req.url, 'http://localhost').pathname;

            if (pathname === '/health' && req.method === 'GET') {
                sendJson(res, 200, {
                    status: 'ok',
                    name: 'electronic-parts-manager-mcp',
                    version,
                    readOnly: Boolean(config.readOnly),
                });
                return;
            }

            if (pathname === '/mcp') {
                if (req.method === 'POST') {
                    await handleMcpPost(req, res, { config, apiClient, version });
                    return;
                }
                if (req.method === 'GET' || req.method === 'DELETE') {
                    sendJson(res, 405, jsonRpcError(-32000, 'Method not allowed.'), { Allow: 'POST' });
                    return;
                }
            }

            sendJson(res, 404, { error: 'Not Found' });
        } catch (err) {
            if (isClientDisconnect(err)) {
                console.error(`[epm-mcp-http] client disconnected during request: ${err.message}`);
                return;
            }
            console.error('[epm-mcp-http] request error:', err);
            if (!res.headersSent) {
                sendJson(res, 500, jsonRpcError(-32603, 'Internal server error'));
            }
        }
    });
}

async function main() {
    let config;
    try {
        config = loadConfig(process.env);
    } catch (err) {
        console.error(`[epm-mcp-http] configuration error: ${err.message}`);
        process.exit(1);
    }

    for (const warning of config.warnings) {
        console.error(`[epm-mcp-http] warning: ${warning}`);
    }

    const apiClient = createApiClient(config);
    const server = createHttpServer({ config, apiClient, version: packageVersion });

    server.on('error', (err) => {
        console.error(`[epm-mcp-http] server error: ${err.message}`);
        process.exit(1);
    });

    server.listen(config.httpPort, config.httpHost, () => {
        console.error(
            `[epm-mcp-http] listening on http://${config.httpHost}:${server.address().port}/mcp ` +
            `(api: ${config.apiUrl}, auth: ${config.authType}, readOnly: ${config.readOnly})`
        );
        if (config.allowedHosts.length === 0) {
            console.error('[epm-mcp-http] warning: Host header validation is disabled (set EPM_MCP_ALLOWED_HOSTS to enable)');
        }
        console.error('[epm-mcp-http] this server has no client authentication. Do not expose it to the internet.');
    });

    const cleanup = () => {
        server.close(() => process.exit(0));
        // keep-alive 接続が残っていても終了できるようにする
        if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
        }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

module.exports = {
    createHttpServer,
};

if (require.main === module) {
    process.on('unhandledRejection', (reason) => {
        console.error('[epm-mcp-http] unhandledRejection:', reason);
    });

    main().catch((err) => {
        console.error('[epm-mcp-http] fatal error:', err);
        process.exit(1);
    });
}
