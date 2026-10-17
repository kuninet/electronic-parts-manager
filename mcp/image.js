/**
 * MCP 画像処理純関数モジュール
 * 画像 URL の安全検証、Magic Bytes 判定、MIME 解決、サイズ表記フォーマットを提供します。
 */

const path = require('node:path');

/**
 * 一部クライアントの 1MiB 制限を考慮したソフトリミット目安（約 750KB）
 */
const SOFT_LIMIT_BYTES = 750 * 1024;

/**
 * 画像リクエスト先 URL の安全性を検証・解決します。
 * 外部オリジンへの誤送信（認証情報漏洩防止）や /uploads 外へのアクセストラバーサルを防止します。
 *
 * @param {string | null | undefined} imagePath
 * @param {string} apiUrl
 * @returns {{ url: URL } | { error: 'empty' | 'invalid' | 'foreign_origin' | 'outside_uploads' }}
 */
function resolveImageRequestUrl(imagePath, apiUrl) {
    if (imagePath === null || imagePath === undefined) {
        return { error: 'empty' };
    }
    const trimmedPath = String(imagePath).trim();
    if (!trimmedPath) {
        return { error: 'empty' };
    }

    let apiBase;
    try {
        apiBase = new URL(apiUrl);
    } catch {
        return { error: 'invalid' };
    }

    const baseWithSlash = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;

    let resolvedUrl;
    try {
        resolvedUrl = new URL(trimmedPath, baseWithSlash);
    } catch {
        return { error: 'invalid' };
    }

    if (resolvedUrl.origin !== apiBase.origin) {
        return { error: 'foreign_origin' };
    }

    if (!resolvedUrl.pathname.startsWith('/uploads/')) {
        return { error: 'outside_uploads' };
    }

    return { url: resolvedUrl };
}

/**
 * Buffer の先頭バイト（Magic Bytes）から画像 MIME タイプを判定します。
 *
 * @param {Buffer | null | undefined} buffer
 * @returns {'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null}
 */
function sniffImageMime(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 3) {
        return null;
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0D &&
        buffer[5] === 0x0A &&
        buffer[6] === 0x1A &&
        buffer[7] === 0x0A
    ) {
        return 'image/png';
    }

    // GIF: GIF87a または GIF89a
    if (
        buffer.length >= 6 &&
        buffer.toString('ascii', 0, 4) === 'GIF8' &&
        (buffer.toString('ascii', 4, 6) === '7a' || buffer.toString('ascii', 4, 6) === '9a')
    ) {
        return 'image/gif';
    }

    // WEBP: 先頭が RIFF かつ 8〜11バイト目が WEBP
    if (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
        return 'image/webp';
    }

    return null;
}

/**
 * 画像データの MIME タイプを決定します。
 * 判定優先順位: 1. Magic Bytes, 2. Content-Type ヘッダー, 3. 拡張子, 4. 既定値（image/jpeg）
 *
 * @param {Object} params
 * @param {Buffer} [params.buffer]
 * @param {string | null} [params.contentType]
 * @param {string | null} [params.imagePath]
 * @returns {{ mimeType: string } | { error: 'unsupported' }}
 */
function resolveImageMime({ buffer, contentType, imagePath } = {}) {
    // 1. Magic Bytes（最優先）
    if (buffer) {
        const sniffed = sniffImageMime(buffer);
        if (sniffed) {
            return { mimeType: sniffed };
        }
    }

    // 2. Content-Type ヘッダー
    let parsedCt = null;
    if (typeof contentType === 'string' && contentType.trim()) {
        parsedCt = contentType.split(';')[0].trim().toLowerCase();
        if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(parsedCt)) {
            return { mimeType: parsedCt };
        }
    }

    // 3. 拡張子
    if (typeof imagePath === 'string' && imagePath.trim()) {
        const ext = path.extname(imagePath.split('?')[0]).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') {
            return { mimeType: 'image/jpeg' };
        }
        if (ext === '.png') {
            return { mimeType: 'image/png' };
        }
        if (ext === '.gif') {
            return { mimeType: 'image/gif' };
        }
        if (ext === '.webp') {
            return { mimeType: 'image/webp' };
        }
    }

    // 4. サポート外形式の検出（image/* で4種以外）
    if (parsedCt && parsedCt.startsWith('image/')) {
        return { error: 'unsupported' };
    }

    // 5. 既定値
    return { mimeType: 'image/jpeg' };
}

/**
 * バイト数を人間が読みやすい文字列（KB / MB）に整形します。
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) {
        return '0 B';
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = {
    SOFT_LIMIT_BYTES,
    resolveImageRequestUrl,
    sniffImageMime,
    resolveImageMime,
    formatBytes,
};
