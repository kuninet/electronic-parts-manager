/**
 * MCP サーバー環境設定モジュール
 * 環境変数を受け取り、検証・正規化して設定オブジェクトを返す純関数を提供します。
 */

/**
 * 環境変数を検証・正規化し、設定オブジェクトを返します。
 *
 * @param {Record<string, string | undefined>} [env={}] 環境変数オブジェクト
 * @returns {{ apiUrl: string, authHeader: string | null, timeoutMs: number, warnings: string[] }}
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

    if (hasBasic) {
        const rawBasic = env.EPM_BASIC_AUTH;
        const colonIndex = rawBasic.indexOf(':');
        if (colonIndex <= 0) {
            throw new Error('EPM_BASIC_AUTH must be in user:pass format');
        }
        authHeader = 'Basic ' + Buffer.from(rawBasic).toString('base64');

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
    }

    return {
        apiUrl: normalizedUrl,
        authHeader,
        timeoutMs,
        warnings,
    };
}

module.exports = {
    loadConfig,
};
