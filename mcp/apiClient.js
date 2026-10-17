/**
 * EPM REST API クライアントモジュール
 * EPM バックエンドとの HTTP 通信、認証ヘッダー付与、エラー分類（ApiError）を担当します。
 */

const { version } = require('../package.json');

/**
 * API 通信エラーを表すカスタムエラークラス
 */
class ApiError extends Error {
    /**
     * @param {'network' | 'timeout' | 'unauthorized' | 'forbidden' | 'not_found' | 'bad_request' | 'conflict' | 'http' | 'invalid_response'} kind エラー種別
     * @param {number | null} status HTTP ステータスコード
     * @param {string} message エラーメッセージ
     * @param {Object} [options]
     * @param {boolean} [options.unknownOutcome=false] POST タイムアウト等の結果不明フラグ
     */
    constructor(kind, status, message, { unknownOutcome = false } = {}) {
        super(message);
        this.name = 'ApiError';
        this.kind = kind;
        this.status = status;
        this.unknownOutcome = unknownOutcome;
    }
}

/**
 * API クライアントを生成します。
 *
 * @param {{ apiUrl: string, authHeader: string | null, authType?: 'none' | 'basic' | 'bearer', timeoutMs: number }} config
 * @param {{ fetchImpl?: typeof globalThis.fetch }} [options]
 * @returns {object} API クライアント
 */
function createApiClient(config, { fetchImpl = globalThis.fetch } = {}) {
    const defaultHeaders = {
        'Accept': 'application/json',
        'User-Agent': `epm-mcp/${version}`,
    };

    if (config.authHeader) {
        defaultHeaders['Authorization'] = config.authHeader;
    }

    /**
     * 汎用 HTTP リクエストを実行します。
     *
     * @param {'GET' | 'POST'} method HTTP メソッド
     * @param {string} path API パス
     * @param {Object} [options]
     * @param {Record<string, any>} [options.query]
     * @param {any} [options.body]
     * @returns {Promise<any>}
     */
    async function request(method, path, { query, body } = {}) {
        const url = new URL(config.apiUrl + path);

        if (query && typeof query === 'object') {
            for (const [key, value] of Object.entries(query)) {
                if (value !== undefined && value !== null && value !== '') {
                    url.searchParams.append(key, String(value));
                }
            }
        }

        const headers = { ...defaultHeaders };
        let bodyPayload = undefined;
        if (method === 'POST') {
            headers['Content-Type'] = 'application/json';
            bodyPayload = body !== undefined ? JSON.stringify(body) : undefined;
        }

        let response;
        try {
            response = await fetchImpl(url.toString(), {
                method,
                headers,
                body: bodyPayload,
                signal: AbortSignal.timeout(config.timeoutMs),
            });
        } catch (err) {
            if (err instanceof ApiError) {
                throw err;
            }
            if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
                const unknownOutcome = method === 'POST';
                throw new ApiError(
                    'timeout',
                    null,
                    `API の応答が ${config.timeoutMs}ms 以内にありませんでした。`,
                    { unknownOutcome }
                );
            }
            throw new ApiError(
                'network',
                null,
                `API サーバーに接続できません（${config.apiUrl}）。サーバーが起動しているか、EPM_API_URL を確認してください。`
            );
        }

        if (!response.ok) {
            const status = response.status;

            // エラー本文の抽出（最大 200 文字）
            let bodyText = '';
            let errorDetail = '';
            try {
                bodyText = await response.text();
                try {
                    const bodyJson = JSON.parse(bodyText);
                    if (bodyJson && typeof bodyJson.error === 'string') {
                        errorDetail = bodyJson.error.slice(0, 200);
                    }
                } catch {
                    if (bodyText) {
                        errorDetail = bodyText.trim().slice(0, 200);
                    }
                }
            } catch {
                // 読み取り失敗時は無視
            }

            if (status === 400) {
                const msg = errorDetail ? `不正なリクエストです: ${errorDetail}` : '不正なリクエストです';
                throw new ApiError('bad_request', 400, msg);
            }

            if (status === 401) {
                let msg = '認証に失敗しました。EPM_BASIC_AUTH（user:pass）を確認してください。';
                if (config.authType === 'bearer') {
                    msg = 'API トークンが一致しません。EPM_AUTH_TOKEN を確認してください。';
                } else if (config.authType === 'none') {
                    msg = 'サーバーが API トークンを要求しています。EPM_AUTH_TOKEN にサーバーの EPM_API_TOKEN と同じ値を設定してください。';
                }
                throw new ApiError('unauthorized', 401, msg);
            }

            if (status === 403) {
                throw new ApiError('forbidden', 403, 'アクセスが拒否されました。AWS の場合は API Gateway ではなく CloudFront の URL を EPM_API_URL に指定してください。');
            }

            if (status === 404) {
                const msg = errorDetail || 'リソースが見つかりません';
                throw new ApiError('not_found', 404, msg);
            }

            if (status === 409) {
                const msg = errorDetail ? `競合が発生しました: ${errorDetail}` : '競合が発生しました';
                throw new ApiError('conflict', 409, msg);
            }

            // その他 4xx / 5xx
            const msg = errorDetail ? `API エラー（${status}）: ${errorDetail}` : `API エラー（${status}）`;
            throw new ApiError('http', status, msg);
        }

        // 2xx レスポンスの JSON パース
        let data;
        try {
            const text = await response.text();
            data = JSON.parse(text);
        } catch {
            throw new ApiError(
                'invalid_response',
                response.status,
                'API から JSON 以外の応答が返りました。EPM_API_URL がフロントエンドではなく API を指しているか確認してください。'
            );
        }

        return data;
    }

    return {
        apiUrl: config.apiUrl,
        get: (path, query) => request('GET', path, { query }),
        post: (path, body) => request('POST', path, { body }),
        request,
        listParts: (params) => request('GET', '/api/parts', { query: params }),
        getPart: (id) => request('GET', `/api/parts/${id}`),
        listCategories: () => request('GET', '/api/categories'),
        listLocations: () => request('GET', '/api/locations'),
        createPart: (body) => request('POST', '/api/parts', { body }),
        changeQuantity: (id, body) => request('POST', `/api/parts/${id}/quantity`, { body }),
        storePart: (body) => request('POST', '/api/qr/store', { body }),
    };
}

module.exports = {
    ApiError,
    createApiClient,
};
