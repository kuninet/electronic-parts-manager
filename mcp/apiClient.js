/**
 * EPM REST API クライアントモジュール
 * EPM バックエンドとの HTTP 通信、認証ヘッダー付与、エラー分類（ApiError）を担当します。
 */

const { version } = require('../package.json');
const { resolveImageRequestUrl, formatBytes } = require('./image');

/**
 * API 通信エラーを表すカスタムエラークラス
 */
class ApiError extends Error {
    /**
     * @param {'network' | 'timeout' | 'unauthorized' | 'forbidden' | 'not_found' | 'bad_request' | 'conflict' | 'http' | 'invalid_response' | 'too_large'} kind エラー種別
     * @param {number | null} status HTTP ステータスコード
     * @param {string} message エラーメッセージ
     * @param {Object} [options]
     * @param {boolean} [options.unknownOutcome=false] POST/PATCH タイムアウト等の結果不明フラグ
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
 * @param {{ apiUrl: string, authHeader: string | null, authType?: 'none' | 'basic' | 'bearer', timeoutMs: number, imageMaxBytes?: number }} config
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
     * HTTP ステータスコードに応じた ApiError を生成します。
     *
     * @param {number} status
     * @param {string} errorDetail
     * @param {{ defaultNotFoundMessage?: string }} [options]
     * @returns {ApiError}
     */
    function toHttpError(status, errorDetail, { defaultNotFoundMessage = 'リソースが見つかりません' } = {}) {
        if (status === 400) {
            const msg = errorDetail ? `不正なリクエストです: ${errorDetail}` : '不正なリクエストです';
            return new ApiError('bad_request', 400, msg);
        }

        if (status === 401) {
            let msg = '認証に失敗しました。EPM_BASIC_AUTH（user:pass）を確認してください。';
            if (config.authType === 'bearer') {
                msg = 'API トークンが一致しません。EPM_AUTH_TOKEN を確認してください。';
            } else if (config.authType === 'none') {
                msg = 'サーバーが API トークンを要求しています。EPM_AUTH_TOKEN にサーバーの EPM_API_TOKEN と同じ値を設定してください。';
            }
            return new ApiError('unauthorized', 401, msg);
        }

        if (status === 403) {
            return new ApiError('forbidden', 403, 'アクセスが拒否されました。AWS の場合は API Gateway ではなく CloudFront の URL を EPM_API_URL に指定してください。');
        }

        if (status === 404) {
            const msg = errorDetail || defaultNotFoundMessage;
            return new ApiError('not_found', 404, msg);
        }

        if (status === 409) {
            const msg = errorDetail ? `競合が発生しました: ${errorDetail}` : '競合が発生しました';
            return new ApiError('conflict', 409, msg);
        }

        const msg = errorDetail ? `API エラー（${status}）: ${errorDetail}` : `API エラー（${status}）`;
        return new ApiError('http', status, msg);
    }

    /**
     * 汎用 HTTP リクエストを実行します。
     *
     * @param {'GET' | 'POST' | 'PATCH'} method HTTP メソッド
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
        if (method !== 'GET') {
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
                const unknownOutcome = method !== 'GET';
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

            throw toHttpError(status, errorDetail);
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

    /**
     * 画像ファイル（バイナリ）を取得します。
     *
     * @param {string} imagePath 画像パス（/uploads/...）
     * @returns {Promise<{ buffer: Buffer, contentType: string | null, size: number }>}
     */
    async function getImage(imagePath) {
        const urlRes = resolveImageRequestUrl(imagePath, config.apiUrl);
        if (urlRes.error) {
            let msg = '画像パスが不正です';
            if (urlRes.error === 'empty') msg = '画像パスが不正です（空です）';
            else if (urlRes.error === 'invalid') msg = '画像パスが不正です（無効なURL形式です）';
            else if (urlRes.error === 'foreign_origin') msg = '画像パスが不正です（外部オリジンへのアクセスは禁止されています）';
            else if (urlRes.error === 'outside_uploads') msg = '画像パスが不正です（/uploads/ 以外のパスは取得できません）';
            throw new ApiError('bad_request', null, msg);
        }

        const headers = {
            'Accept': 'image/*',
            'User-Agent': `epm-mcp/${version}`,
        };
        if (config.authHeader) {
            headers['Authorization'] = config.authHeader;
        }

        let response;
        try {
            response = await fetchImpl(urlRes.url.toString(), {
                method: 'GET',
                headers,
                redirect: 'error',
                signal: AbortSignal.timeout(config.timeoutMs),
            });
        } catch (err) {
            if (err instanceof ApiError) {
                throw err;
            }
            if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
                throw new ApiError(
                    'timeout',
                    null,
                    `API の応答が ${config.timeoutMs}ms 以内にありませんでした。`,
                    { unknownOutcome: false }
                );
            }
            throw new ApiError(
                'network',
                null,
                `画像サーバーに接続できません（${config.apiUrl}）。サーバーが起動しているか、EPM_API_URL を確認してください。`
            );
        }

        if (!response.ok) {
            const status = response.status;
            if (status === 404) {
                // 画像配信の 404 は一貫して固定文言を返却（Express や CloudFront の HTML 断片混入を防止）
                throw new ApiError('not_found', 404, '画像ファイルが見つかりません');
            }

            // 404 以外のエラー本文抽出（JSON の error プロパティのみ許可し、HTML/XML 断片等は除外）
            let errorDetail = '';
            try {
                const bodyText = await response.text();
                try {
                    const bodyJson = JSON.parse(bodyText);
                    if (bodyJson && typeof bodyJson.error === 'string') {
                        errorDetail = bodyJson.error.slice(0, 200);
                    }
                } catch {
                    // 非 JSON 本文（HTML/XML 等）は AI への混入防止のため errorDetail に含めない
                }
            } catch {
                // 読み取り失敗時は無視
            }

            throw toHttpError(status, errorDetail);
        }

        // Content-Type 検査（text/* や application/json は invalid_response）
        const rawContentType = (typeof response.headers?.get === 'function' ? response.headers.get('content-type') : null) || '';
        const ct = rawContentType.split(';')[0].trim().toLowerCase();
        if (ct.startsWith('text/') || ct === 'application/json') {
            throw new ApiError(
                'invalid_response',
                response.status,
                `画像ではなく ${rawContentType} が返りました。画像ファイルが削除されている可能性があります。`
            );
        }

        // サイズ上限検査
        const maxBytes = config.imageMaxBytes || 10485760;
        const contentLengthHeader = typeof response.headers?.get === 'function' ? response.headers.get('content-length') : null;
        if (contentLengthHeader !== null && contentLengthHeader !== undefined && contentLengthHeader !== '') {
            const cl = Number(contentLengthHeader);
            if (Number.isFinite(cl) && cl > maxBytes) {
                if (response.body && typeof response.body.cancel === 'function') {
                    try { await response.body.cancel(); } catch {}
                }
                throw new ApiError(
                    'too_large',
                    null,
                    `画像が大きすぎます（${formatBytes(cl)} / 上限 ${formatBytes(maxBytes)}）。EPM_IMAGE_MAX_BYTES で上限を変更できます。`
                );
            }
        }

        // ストリーム読み取りによる累計サイズ上限ガード
        let buffer;
        if (response.body && typeof response.body.getReader === 'function') {
            const reader = response.body.getReader();
            const chunks = [];
            let totalBytes = 0;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        totalBytes += value.length;
                        if (totalBytes > maxBytes) {
                            try { await reader.cancel(); } catch {}
                            throw new ApiError(
                                'too_large',
                                null,
                                `画像が大きすぎます（上限 ${formatBytes(maxBytes)} 超過）。EPM_IMAGE_MAX_BYTES で上限を変更できます。`
                            );
                        }
                        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
                    }
                }
            } catch (err) {
                if (err instanceof ApiError) throw err;
                throw err;
            }
            buffer = Buffer.concat(chunks);
        } else if (typeof response.arrayBuffer === 'function') {
            const ab = await response.arrayBuffer();
            if (ab.byteLength > maxBytes) {
                throw new ApiError(
                    'too_large',
                    null,
                    `画像が大きすぎます（${formatBytes(ab.byteLength)} / 上限 ${formatBytes(maxBytes)}）。EPM_IMAGE_MAX_BYTES で上限を変更できます。`
                );
            }
            buffer = Buffer.from(ab);
        } else {
            throw new ApiError('invalid_response', null, '応答ボディの読み取りに対応していません');
        }

        if (buffer.length === 0) {
            throw new ApiError('invalid_response', response.status, '画像データが空です');
        }

        return {
            buffer,
            contentType: rawContentType || null,
            size: buffer.length,
        };
    }

    return {
        apiUrl: config.apiUrl,
        get: (path, query) => request('GET', path, { query }),
        post: (path, body) => request('POST', path, { body }),
        request,
        getImage,
        listParts: (params) => request('GET', '/api/parts', { query: params }),
        getPart: (id) => request('GET', `/api/parts/${id}`),
        listCategories: () => request('GET', '/api/categories'),
        listLocations: () => request('GET', '/api/locations'),
        createPart: (body) => request('POST', '/api/parts', { body }),
        patchPart: (id, body) => request('PATCH', `/api/parts/${id}`, { body }),
        changeQuantity: (id, body) => request('POST', `/api/parts/${id}/quantity`, { body }),
        storePart: (body) => request('POST', '/api/qr/store', { body }),
        listPurchases: (params) => request('GET', '/api/purchases', { query: params }),
        getPurchase: (id) => request('GET', `/api/purchases/${id}`),
        importPurchases: (body) => request('POST', '/api/purchases/import', { body }),
        patchPurchase: (id, body) => request('PATCH', `/api/purchases/${id}`, { body }),
    };
}

module.exports = {
    ApiError,
    createApiClient,
};
