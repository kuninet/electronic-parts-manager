/**
 * get_part_image ツール実装
 * 部品 ID を指定して登録されている部品写真を画像コンテンツとして返却します。
 */

const { z } = require('zod');
const { ApiError } = require('../apiClient.js');
const { toolError } = require('../format.js');
const { SOFT_LIMIT_BYTES, resolveImageMime, formatBytes } = require('../image.js');

const getPartImageSchema = {
    id: z.number().int().positive(),
};

/**
 * McpServer に get_part_image ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerGetPartImageTool(server, { apiClient, apiUrl }) {
    server.registerTool(
        'get_part_image',
        {
            title: '部品写真取得',
            description: '部品 ID を指定して、登録されている部品写真を画像として返します。刻印・型番・形状の確認に使えます。画像の無い部品はテキストで通知します。',
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: getPartImageSchema,
        },
        async (args) => {
            const id = args.id;

            // 1. 部品情報の取得
            let part;
            try {
                part = await apiClient.getPart(id);
            } catch (err) {
                if (err instanceof ApiError && err.kind === 'not_found') {
                    return toolError(`部品 ID ${id} は見つかりません。`);
                }
                return toolError(err.message || String(err));
            }

            const partName = part?.name || '名称未設定';

            // 2. 画像パスの有無チェック（null, undefined, 空文字, 空白のみ）
            const rawImagePath = typeof part?.image_path === 'string' ? part.image_path.trim() : null;
            if (!rawImagePath) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `部品 ID ${id} (${partName}) には画像が登録されていません。`,
                        },
                    ],
                };
            }

            // 3. 画像バイナリの取得
            let imageResult;
            try {
                imageResult = await apiClient.getImage(rawImagePath);
            } catch (err) {
                return toolError(`部品 ID ${id} (${partName}) の画像を取得できませんでした: ${err.message || String(err)}`);
            }

            // 4. MIME タイプの決定
            const mimeResult = resolveImageMime({
                buffer: imageResult.buffer,
                contentType: imageResult.contentType,
                imagePath: rawImagePath,
            });

            if (mimeResult.error === 'unsupported') {
                const ct = imageResult.contentType || 'unknown';
                return toolError(`部品 ID ${id} (${partName}) の画像形式（${ct}）には対応していません。`);
            }

            // 5. ソフトリミット目安（750KB）チェック
            let sizeNote = '';
            if (imageResult.size > SOFT_LIMIT_BYTES) {
                sizeNote = ` （画像サイズ ${formatBytes(imageResult.size)}。クライアントによっては大きすぎて表示できない場合があります）`;
            }

            return {
                content: [
                    {
                        type: 'image',
                        data: imageResult.buffer.toString('base64'),
                        mimeType: mimeResult.mimeType,
                    },
                    {
                        type: 'text',
                        text: `部品 ID ${id} (${partName}) の登録写真です。${sizeNote}`,
                    },
                ],
            };
        }
    );
}

module.exports = {
    getPartImageSchema,
    registerGetPartImageTool,
};
