/**
 * store_part_location ツール実装
 * 電子部品を指定した保管場所に格納（移動）します。
 */

const { z } = require('zod');
const { toolResult, toolError } = require('../format.js');
const { ApiError } = require('../apiClient.js');

const storePartLocationSchema = {
    part_id: z.number().int().positive(),
    location_id: z.number().int().positive(),
};

/**
 * McpServer に store_part_location ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object }} options
 */
function registerStorePartLocationTool(server, { apiClient }) {
    server.registerTool(
        'store_part_location',
        {
            title: '電子部品保管場所格納',
            description: '電子部品を指定した保管場所に格納（移動）します。実行すると部品の保管場所が更新され、入出庫ログが記録されます。',
            annotations: {
                readOnlyHint: false,
                idempotentHint: true,
                openWorldHint: false,
                destructiveHint: false,
            },
            inputSchema: storePartLocationSchema,
        },
        async (args) => {
            try {
                const res = await apiClient.storePart({
                    part_id: args.part_id,
                    location_id: args.location_id,
                    memo: 'MCP',
                });

                return toolResult({
                    part_id: res.part_id ?? args.part_id,
                    location_id: res.location_id ?? args.location_id,
                    previous_location_id: res.previous_location_id ?? null,
                    previous_location_name: res.previous_location_name ?? null,
                    unchanged: !!res.unchanged,
                    log_id: res.log_id ?? null,
                });
            } catch (err) {
                if (err instanceof ApiError && err.unknownOutcome) {
                    return toolError(
                        '結果不明です。リクエストがタイムアウトしたため、格納が反映されたか確認できません。' +
                        `get_part_detail で保管場所を確認してください: ${err.message}`
                    );
                }
                return toolError(err.message || '保管場所への格納に失敗しました');
            }
        }
    );
}

module.exports = {
    registerStorePartLocationTool,
};
