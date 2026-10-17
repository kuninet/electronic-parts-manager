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
     * @param {'network' | 'timeout' | 'unauthorized' | 'forbidden' | 'not_found' | 'http' | 'invalid_response'} kind エラー種別
     * @param {number | null} status HTTP ステータスコード
     * @param {string} message エラーメッセージ
     */
    constructor(kind, status, message) {
        super(message);
        this.name = 'ApiError';
        this.kind = kind;
        this.status = status;
    }
}

/**
 * API クライアントを生成します。
 *
 * @param {{ apiUrl: string, authHeader: string | null, timeoutMs: number }} config
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
     * GET リクエストを実行します。
     *
     * @param {string} path API パス（例: '/api/parts'）
     * @param {Record<string, any>} [query] クエリパラメータ
     * @returns {Promise<any>}
     */
    async function get(path, query) {
        const url = new URL(config.apiUrl + path);

        if (query && typeof query === 'object') {
            for (const [key, value] of Object.entries(query)) {
                if (value !== undefined && value !== null && value !== '') {
                    url.searchParams.append(key, String(value));
                }
            }
        }

        let response;
        try {
            response = await fetchImpl(url.toString(), {
                method: 'GET',
                headers: defaultHeaders,
                signal: AbortSignal.timeout(config.timeoutMs),
            });
        } catch (err) {
            if (err instanceof ApiError) {
                throw err;
            }
            if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
                throw new ApiError('timeout', null, `API の応答が ${config.timeoutMs}ms 以内にありませんでした。`);
            }
            throw new ApiError(
                'network',
                null,
                `API サーバーに接続できません（${config.apiUrl}）。サーバーが起動しているか、EPM_API_URL を確認してください。`
            );
        }

        if (!response.ok) {
            const status = response.status;
            if (status === 401) {
                throw new ApiError('unauthorized', 401, '認証に失敗しました。EPM_BASIC_AUTH（user:pass）を確認してください。');
            }
            if (status === 403) {
                throw new ApiError('forbidden', 403, 'アクセスが拒否されました。AWS の場合は API Gateway ではなく CloudFront の URL を EPM_API_URL に指定してください。');
            }
            if (status === 404) {
                throw new ApiError('not_found', 404, 'リソースが見つかりません');
            }

            // その他 4xx / 5xx
            let errorDetail = '';
            try {
                const bodyText = await response.text();
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
        get,
        listParts: (params) => get('/api/parts', params),
        getPart: (id) => get(`/api/parts/${id}`),
        listCategories: () => get('/api/categories'),
        listLocations: () => get('/api/locations'),
    };
}

module.exports = {
    ApiError,
    createApiClient,
};
