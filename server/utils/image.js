const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 *画像をリサイズして保存する
 * @param {string} filePath - 元ファイルのパス
 * @param {number} maxWidth - 最大幅 (デフォルト 1000px)
 * @returns {Promise<void>}
 */
async function resizeImage(filePath, maxWidth = 1000) {
    try {
        const metadata = await sharp(filePath).metadata();

        if (metadata.width > maxWidth) {
            const buffer = await sharp(filePath)
                .resize({ width: maxWidth, withoutEnlargement: true })
                .toBuffer();

            // 元ファイルを上書き
            await fs.promises.writeFile(filePath, buffer);
            console.log(`Resized image: ${filePath} (${metadata.width}px -> ${maxWidth}px)`);
        }
    } catch (err) {
        console.error('Failed to resize image:', err);
        // リサイズに失敗しても元の画像は残るので、続行可能とする
    }
}

module.exports = {
    resizeImage
};
