const crypto = require('crypto');

/**
 * API トークン認証ミドルウェアを生成する
 * 
 * @param {Object} options
 * @param {string} [options.token] - 期待される API トークン（EPM_API_TOKEN）
 * @param {boolean} [options.isLambda] - Lambda 環境フラグ
 * @returns {import('express').RequestHandler}
 */
function createApiTokenAuth({ token, isLambda = false } = {}) {
    const trimmedToken = typeof token === 'string' ? token.trim() : '';

    // トークンが未設定または空の場合は無認証で通過（オプトイン設計）
    if (!trimmedToken) {
        return (req, res, next) => next();
    }

    const expectedHash = crypto.createHash('sha256').update(trimmedToken).digest();

    return (req, res, next) => {
        // OPTIONS リクエストはプリフライトのため素通し
        if (req.method === 'OPTIONS') {
            return next();
        }

        // GET/HEAD /health は更新スクリプトや死活監視のため免除
        if ((req.method === 'GET' || req.method === 'HEAD') && req.path === '/health') {
            return next();
        }

        // Lambda 環境下での非同期バックアップワーカーのみ免除（LAN では免除しない）
        if (isLambda && req.method === 'POST' && req.path === '/backup/export/worker') {
            return next();
        }

        const authHeader = req.headers['authorization'];
        if (typeof authHeader === 'string') {
            const match = authHeader.match(/^Bearer\s+(.+)$/i);
            if (match) {
                const receivedToken = match[1];
                const receivedHash = crypto.createHash('sha256').update(receivedToken).digest();
                if (crypto.timingSafeEqual(expectedHash, receivedHash)) {
                    return next();
                }
            }
        }

        // 認証失敗
        const ip = req.ip || req.socket?.remoteAddress || '';
        const targetPath = req.originalUrl || req.baseUrl + req.path || req.path;
        console.error(`Unauthorized API access: ${req.method} ${targetPath} ip=${ip}`);

        res.setHeader('WWW-Authenticate', 'Bearer realm="epm"');
        return res.status(401).json({
            error: 'Unauthorized',
            code: 'API_TOKEN_REQUIRED'
        });
    };
}

module.exports = {
    createApiTokenAuth
};
