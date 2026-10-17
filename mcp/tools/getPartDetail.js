/**
 * get_part_detail ツール実装
 * 部品 ID を指定して電子部品の詳細情報を取得します。
 */

const { z } = require('zod');
const { ApiError } = require('../apiClient.js');
const { toPartDetail, toolResult, toolError } = require('../format.js');

const getPartDetailSchema = {
    id: z.number().int().positive(),
};

/**
 * McpServer に get_part_detail ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerGetPartDetailTool(server, { apiClient, apiUrl }) {
    server.registerTool(
        'get_part_detail',
        {
            title: '部品詳細取得',
            description: '部品 ID を指定して、電子部品の詳細情報（データシートURL、QRコード、作成日時、使用記録など）を取得します。',
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: getPartDetailSchema,
        },
        async (args) => {
            try {
                const part = await apiClient.getPart(args.id);
                const detail = toPartDetail(part, apiUrl);
                return toolResult(detail);
            } catch (err) {
                if (err instanceof ApiError && err.kind === 'not_found') {
                    return toolError(`部品 ID ${args.id} は見つかりません。search_parts で検索してください。`);
                }
                return toolError(err.message || String(err));
            }
        }
    );
}

module.exports = {
    getPartDetailSchema,
    registerGetPartDetailTool,
};
