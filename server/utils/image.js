const sharp = require('sharp');

async function resizeImageBuffer(buffer, maxWidth = 1200, quality = 80) {
    try {
        const metadata = await sharp(buffer).metadata();
        // スマホなどのカメラで撮影された画像のEXIF(Orientation)情報をもとに正しい向きに自動回転させる
        let pipeline = sharp(buffer).rotate();

        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const maxDim = Math.max(width, height);

        if (maxDim > maxWidth) {
            if (width >= height) {
                pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
            } else {
                pipeline = pipeline.resize({ height: maxWidth, withoutEnlargement: true });
            }
        }

        // クライアント側と基準を統一（長辺1200px・JPEG品質80%）
        if (metadata.format === 'jpeg') {
            pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        } else if (metadata.format === 'webp') {
            pipeline = pipeline.webp({ quality });
        }

        return await pipeline.toBuffer();
    } catch (err) {
        console.error('Failed to resize image:', err);
        throw new Error('INVALID_IMAGE');
    }
}

async function validateImage(buffer) {
    try {
        await sharp(buffer).metadata();
        return true;
    } catch (err) {
        return false;
    }
}

module.exports = { resizeImageBuffer, validateImage };
