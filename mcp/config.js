/**
 * MCP サーバー環境設定モジュール
 * 環境変数を受け取り、検証・正規化して設定オブジェクトを返す純関数を提供します。
 */

/**
 * EPM_MCP_ALLOWED_HOSTS（カンマ区切り）を解析し、小文字化・重複除去したホスト名の配列を返します。
 * ポート付き（host:port, [::1]:3002）は不正として例外を投げます。IPv6 は角括弧付きで指定します。
 *
 * @param {string | undefined} raw 環境変数の値
 * @returns {string[]}
 */
function parseAllowedHosts(raw) {
    if (!raw) {
        return [];
    }
    const hosts = [];
    for (const part of raw.split(',')) {
        const original = part.trim();
        const host = original.toLowerCase();
        if (!host) {
            continue;
        }
        const isBracketed = /^\[[^\]]*\]$/.test(host);
        // 角括弧付き IPv6 以外でコロンを含むもの、および [...] の後ろに :port が続くものはポート付きとみなす
        if (!isBracketed && host.includes(':')) {
            throw new Error(`EPM_MCP_ALLOWED_HOSTS must contain hostnames without ports: '${original}'`);
        }
        if (!/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/.test(host)) {
            throw new Error(`EPM_MCP_ALLOWED_HOSTS contains an invalid hostname: '${original}'`);
        }
        // Host ヘッダー側と同じ正規化（192.168.001.010 → 192.168.1.10 など）をかけて保存する
        let normalized;
        try {
            normalized = new URL('http://' + host).hostname.toLowerCase();
        } catch {
            throw new Error(`EPM_MCP_ALLOWED_HOSTS contains an invalid hostname: '${original}'`);
        }
        if (!hosts.includes(normalized)) {
            hosts.push(normalized);
        }
    }
    return hosts;
}

/**
 * EPM_MCP_ALLOWED_ORIGINS（カンマ区切りの URL）を解析し、new URL(v).origin で正規化した配列を返します。
 * URL として不正な値、または origin が決まらない値（opaque origin）は例外を投げます。
 *
 * @param {string | undefined} raw 環境変数の値
 * @returns {string[]}
 */
function parseAllowedOrigins(raw) {
    if (!raw) {
        return [];
    }
    const origins = [];
    for (const part of raw.split(',')) {
        const value = part.trim();
        if (!value) {
            continue;
        }
        let origin;
        try {
            origin = new URL(value).origin;
        } catch {
            throw new Error(`EPM_MCP_ALLOWED_ORIGINS must contain valid URLs: '${value}'`);
        }
        if (origin === 'null') {
            throw new Error(`EPM_MCP_ALLOWED_ORIGINS must contain valid URLs: '${value}'`);
        }
        if (!origins.includes(origin)) {
            origins.push(origin);
        }
    }
    return origins;
}

/**
 * 環境変数を検証・正規化し、設定オブジェクトを返します。
 *
 * @param {Record<string, string | undefined>} [env={}] 環境変数オブジェクト
 * @returns {{ apiUrl: string, authHeader: string | null, authType: 'none' | 'basic' | 'bearer', readOnly: boolean, timeoutMs: number, imageMaxBytes: number, httpPort: number, httpHost: string, allowedHosts: string[], allowedOrigins: string[], warnings: string[] }}
 */
function loadConfig(env = {}) {
    const warnings = [];

    // 1. API URL の検証と正規化
    const rawApiUrl = (env.EPM_API_URL && env.EPM_API_URL.trim()) ? env.EPM_API_URL.trim() : 'http://localhost:3001';
    let parsedUrl;
    try {
        parsedUrl = new URL(rawApiUrl);
    } catch {
        throw new Error(`Invalid EPM_API_URL: '${rawApiUrl}' is not a valid URL`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error(`Invalid EPM_API_URL protocol: '${parsedUrl.protocol}' is not supported (must be http: or https:)`);
    }

    // 末尾のスラッシュや /api パスを除去してベースURLを統一
    let normalizedUrl = parsedUrl.origin + parsedUrl.pathname;
    normalizedUrl = normalizedUrl.replace(/\/+$/, '');
    if (normalizedUrl.endsWith('/api')) {
        normalizedUrl = normalizedUrl.slice(0, -4);
    }
    normalizedUrl = normalizedUrl.replace(/\/+$/, '');

    // 2. タイムアウト値の検証
    let timeoutMs = 10000;
    if (env.EPM_API_TIMEOUT_MS !== undefined && env.EPM_API_TIMEOUT_MS !== '') {
        const parsedTimeout = Number(env.EPM_API_TIMEOUT_MS);
        if (!Number.isInteger(parsedTimeout) || parsedTimeout <= 0) {
            throw new Error('EPM_API_TIMEOUT_MS must be a positive integer');
        }
        timeoutMs = parsedTimeout;
    }

    // 3. 認証情報の検証とヘッダー生成
    const hasBasic = env.EPM_BASIC_AUTH !== undefined && env.EPM_BASIC_AUTH !== '';
    const hasToken = env.EPM_AUTH_TOKEN !== undefined && env.EPM_AUTH_TOKEN !== '';

    if (hasBasic && hasToken) {
        throw new Error('Cannot specify both EPM_BASIC_AUTH and EPM_AUTH_TOKEN');
    }

    let authHeader = null;
    let authType = 'none';

    if (hasBasic) {
        const rawBasic = env.EPM_BASIC_AUTH;
        const colonIndex = rawBasic.indexOf(':');
        if (colonIndex <= 0) {
            throw new Error('EPM_BASIC_AUTH must be in user:pass format');
        }
        authHeader = 'Basic ' + Buffer.from(rawBasic).toString('base64');
        authType = 'basic';

        // 平文 HTTP 送信のセキュリティ警告
        const hostname = parsedUrl.hostname;
        const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
        if (parsedUrl.protocol === 'http:' && !isLocalHost) {
            warnings.push(`EPM_BASIC_AUTH is configured over unencrypted HTTP for remote host '${hostname}'. Use HTTPS or localhost to ensure credentials are secure.`);
        }
    } else if (hasToken) {
        const token = env.EPM_AUTH_TOKEN.trim();
        if (!token) {
            throw new Error('EPM_AUTH_TOKEN must not be empty');
        }
        authHeader = `Bearer ${token}`;
        authType = 'bearer';
    }

    // 4. 読み取り専用モード（EPM_MCP_READONLY）の判定
    const rawReadOnly = env.EPM_MCP_READONLY ? env.EPM_MCP_READONLY.trim().toLowerCase() : '';
    const readOnly = rawReadOnly === '1' || rawReadOnly === 'true';

    // 5. 画像サイズ上限値の検証 (既定値 10MB = 10485760, 上限 50MB = 52428800)
    let imageMaxBytes = 10485760;
    if (env.EPM_IMAGE_MAX_BYTES !== undefined && env.EPM_IMAGE_MAX_BYTES !== '') {
        const parsedMaxBytes = Number(env.EPM_IMAGE_MAX_BYTES);
        if (!Number.isInteger(parsedMaxBytes) || parsedMaxBytes <= 0 || parsedMaxBytes > 52428800) {
            throw new Error('EPM_IMAGE_MAX_BYTES must be a positive integer up to 52428800');
        }
        imageMaxBytes = parsedMaxBytes;
    }

    // 6. リモート MCP（Streamable HTTP）の待ち受け設定。stdio 版は参照しない
    // 6-1. ポート（0 はテスト用のエフェメラルポート）
    let httpPort = 3002;
    const rawHttpPort = env.EPM_MCP_HTTP_PORT !== undefined ? env.EPM_MCP_HTTP_PORT.trim() : '';
    if (rawHttpPort !== '') {
        // PowerShell 側（Get-EpmPaths）と同じく、数字のみの値だけを受け付ける
        const parsedPort = /^\d+$/.test(rawHttpPort) ? Number(rawHttpPort) : NaN;
        if (!Number.isInteger(parsedPort) || parsedPort > 65535) {
            throw new Error('EPM_MCP_HTTP_PORT must be an integer between 0 and 65535');
        }
        httpPort = parsedPort;
    }

    // 6-2. 待ち受けアドレス
    const rawHttpHost = env.EPM_MCP_HTTP_HOST ? env.EPM_MCP_HTTP_HOST.trim() : '';
    const httpHost = rawHttpHost || '0.0.0.0';

    // 6-3. 許可する Host ヘッダー（空なら検証しない）
    const allowedHosts = parseAllowedHosts(env.EPM_MCP_ALLOWED_HOSTS);

    // 6-4. 許可する Origin（ブラウザ由来のリクエスト用。空なら Origin 付きはすべて拒否）
    const allowedOrigins = parseAllowedOrigins(env.EPM_MCP_ALLOWED_ORIGINS);

    return {
        apiUrl: normalizedUrl,
        authHeader,
        authType,
        readOnly,
        timeoutMs,
        imageMaxBytes,
        httpPort,
        httpHost,
        allowedHosts,
        allowedOrigins,
        warnings,
    };
}

module.exports = {
    loadConfig,
};
