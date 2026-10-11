const multer = require('multer');

/**
 * multerファイルアップロードエラー用ミドルウェア
 * LIMIT_FILE_SIZEをHTTP 413 (Payload Too Large) として返却
 */
function multerErrorHandler(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'ファイルサイズが大きすぎます (最大50MB)' });
        }
        return res.status(400).json({ error: `ファイルアップロードエラー: ${err.message}` });
    }
    next(err);
}

module.exports = { multerErrorHandler };
