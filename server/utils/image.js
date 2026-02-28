const sharp = require('sharp');

async function resizeImageBuffer(buffer, maxWidth = 1000) {
    try {
        const metadata = await sharp(buffer).metadata();
        // スマホなどのカメラで撮影された画像のEXIF(Orientation)情報をもとに正しい向きに自動回転させる
        const pipeline = sharp(buffer).rotate();

        if (metadata.width > maxWidth) {
            const resized = await pipeline
                .resize({ width: maxWidth, withoutEnlargement: true })
                .toBuffer();
            console.log(`Resized and auto-rotated image buffer (${metadata.width}px -> ${maxWidth}px)`);
            return resized;
        }

        // リサイズ不要な場合でも回転だけは適用して返す
        return await pipeline.toBuffer();
    } catch (err) {
        console.error('Failed to resize image:', err);
        return buffer;
    }
}

module.exports = { resizeImageBuffer };
