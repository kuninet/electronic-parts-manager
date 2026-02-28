const sharp = require('sharp');

async function resizeImageBuffer(buffer, maxWidth = 1000) {
    try {
        const metadata = await sharp(buffer).metadata();
        if (metadata.width > maxWidth) {
            const resized = await sharp(buffer)
                .resize({ width: maxWidth, withoutEnlargement: true })
                .toBuffer();
            console.log(`Resized image buffer (${metadata.width}px -> ${maxWidth}px)`);
            return resized;
        }
        return buffer;
    } catch (err) {
        console.error('Failed to resize image:', err);
        return buffer;
    }
}

module.exports = { resizeImageBuffer };
