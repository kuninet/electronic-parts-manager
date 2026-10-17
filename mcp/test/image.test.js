const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    SOFT_LIMIT_BYTES,
    resolveImageRequestUrl,
    sniffImageMime,
    resolveImageMime,
    formatBytes,
} = require('../image.js');

describe('MCP Image Pure Functions Unit Tests (I-1 ~ I-16)', () => {
    const apiUrl = 'https://x.cloudfront.net';

    test('I-1: apiUrl が http://localhost:3001 で /uploads/a.jpg の URL 解決', () => {
        const res = resolveImageRequestUrl('/uploads/a.jpg', 'http://localhost:3001');
        assert.ok(res.url);
        assert.equal(res.url.href, 'http://localhost:3001/uploads/a.jpg');
    });

    test('I-2: 先頭のスラッシュなし uploads/a.jpg も受け付けて解決する', () => {
        const res = resolveImageRequestUrl('uploads/a.jpg', apiUrl);
        assert.ok(res.url);
        assert.equal(res.url.href, 'https://x.cloudfront.net/uploads/a.jpg');
    });

    test('I-3: 同じオリジンの絶対 URL を受け付ける', () => {
        const res = resolveImageRequestUrl('https://x.cloudfront.net/uploads/a.jpg', apiUrl);
        assert.ok(res.url);
        assert.equal(res.url.href, 'https://x.cloudfront.net/uploads/a.jpg');
    });

    test('I-4: 異なるオリジン（https://evil.example/uploads/a.jpg）は foreign_origin エラー', () => {
        const res = resolveImageRequestUrl('https://evil.example/uploads/a.jpg', apiUrl);
        assert.deepEqual(res, { error: 'foreign_origin' });
    });

    test('I-5: パストラバーサル（/uploads/../api/backup/export/full, /uploads/%2e%2e/api/parts）は outside_uploads エラー', () => {
        const res1 = resolveImageRequestUrl('/uploads/../api/backup/export/full', apiUrl);
        assert.deepEqual(res1, { error: 'outside_uploads' });

        const res2 = resolveImageRequestUrl('/uploads/%2e%2e/api/parts', apiUrl);
        assert.deepEqual(res2, { error: 'outside_uploads' });
    });

    test('I-6: /api/parts/1 など uploads 外のパスは outside_uploads エラー', () => {
        const res = resolveImageRequestUrl('/api/parts/1', apiUrl);
        assert.deepEqual(res, { error: 'outside_uploads' });
    });

    test('I-7: null, 空文字, 空白文字は empty エラー', () => {
        assert.deepEqual(resolveImageRequestUrl(null, apiUrl), { error: 'empty' });
        assert.deepEqual(resolveImageRequestUrl('', apiUrl), { error: 'empty' });
        assert.deepEqual(resolveImageRequestUrl('   ', apiUrl), { error: 'empty' });
    });

    test('I-8: JPEG 先頭バイト (FF D8 FF) から sniffImageMime が image/jpeg を判定する', () => {
        const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
        assert.equal(sniffImageMime(jpegBuffer), 'image/jpeg');
    });

    test('I-9: PNG, GIF89a, GIF87a の先頭バイトから正しい MIME を判定する', () => {
        const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
        assert.equal(sniffImageMime(pngBuffer), 'image/png');

        const gif89Buffer = Buffer.from('GIF89a...');
        assert.equal(sniffImageMime(gif89Buffer), 'image/gif');

        const gif87Buffer = Buffer.from('GIF87a...');
        assert.equal(sniffImageMime(gif87Buffer), 'image/gif');
    });

    test('I-10: RIFF....WEBP から image/webp を判定する', () => {
        const webpBuffer = Buffer.concat([
            Buffer.from('RIFF'),
            Buffer.from([0x20, 0x00, 0x00, 0x00]),
            Buffer.from('WEBP'),
            Buffer.from('VP8 '),
        ]);
        assert.equal(sniffImageMime(webpBuffer), 'image/webp');
    });

    test('I-11: RIFF....WAVE, <!doctype html>, 短いバッファは null を返す', () => {
        const waveBuffer = Buffer.concat([
            Buffer.from('RIFF'),
            Buffer.from([0x20, 0x00, 0x00, 0x00]),
            Buffer.from('WAVE'),
        ]);
        assert.equal(sniffImageMime(waveBuffer), null);

        const htmlBuffer = Buffer.from('<!doctype html><html></html>');
        assert.equal(sniffImageMime(htmlBuffer), null);

        const shortBuffer = Buffer.from([0xFF, 0xD8]);
        assert.equal(sniffImageMime(shortBuffer), null);
    });

    test('I-12: PNG のバイト列で contentType: image/jpeg, path: .jpg の場合、Magic Bytes 優先で image/png になる', () => {
        const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const res = resolveImageMime({
            buffer: pngBuffer,
            contentType: 'image/jpeg',
            imagePath: '/uploads/photo.jpg',
        });
        assert.deepEqual(res, { mimeType: 'image/png' });
    });

    test('I-13: 判定不能バイト列で contentType: image/webp; charset=binary の場合、Content-Type から image/webp になる', () => {
        const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
        const res = resolveImageMime({
            buffer: unknownBuffer,
            contentType: 'image/webp; charset=binary',
            imagePath: '/uploads/unknown',
        });
        assert.deepEqual(res, { mimeType: 'image/webp' });
    });

    test('I-14: 判定不能バイト列で contentType: application/octet-stream, path: .gif の場合、拡張子から image/gif になる', () => {
        const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
        const res = resolveImageMime({
            buffer: unknownBuffer,
            contentType: 'application/octet-stream',
            imagePath: '/uploads/anim.gif',
        });
        assert.deepEqual(res, { mimeType: 'image/gif' });
    });

    test('I-15: 判定不能バイト列で contentType: image/svg+xml の場合、unsupported エラーを返す', () => {
        const svgBuffer = Buffer.from('<svg></svg>');
        const res = resolveImageMime({
            buffer: svgBuffer,
            contentType: 'image/svg+xml',
            imagePath: '/uploads/vector.svg',
        });
        assert.deepEqual(res, { error: 'unsupported' });
    });

    test('I-16: 判定不能かつ contentType なし拡張子なしは image/jpeg（既定値）。formatBytes の動作検証', () => {
        const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
        const res = resolveImageMime({
            buffer: unknownBuffer,
            contentType: null,
            imagePath: '/uploads/noext',
        });
        assert.deepEqual(res, { mimeType: 'image/jpeg' });

        assert.equal(formatBytes(1536), '1.5 KB');
        assert.equal(formatBytes(10485760), '10.0 MB');
        assert.equal(SOFT_LIMIT_BYTES, 750 * 1024);
    });
});
