/**
 * update_part_quantity ツール実装
 * 電子部品の在庫数量を増減または絶対値で更新します。
 */

const { z } = require('zod');
const { toolResult, toolError } = require('../format.js');
const { ApiError } = require('../apiClient.js');

const updatePartQuantitySchema = {
    id: z.number().int().positive(),
    delta: z.number().int().optional(),
    absolute: z.number().int().min(0).optional(),
    reason: z.string().max(200).optional(),
};

/**
 * McpServer に update_part_quantity ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object }} options
 */
function registerUpdatePartQuantityTool(server, { apiClient }) {
    server.registerTool(
        'update_part_quantity',
        {
            title: '電子部品数量更新',
            description: '電子部品の在庫数量を増減（delta）または絶対値（absolute）で更新します。実行すると在庫数が変更されます。',
            annotations: {
                readOnlyHint: false,
                idempotentHint: false,
                openWorldHint: false,
                destructiveHint: true,
            },
            inputSchema: updatePartQuantitySchema,
        },
        async (args) => {
            try {
                const hasDelta = args.delta !== undefined;
                const hasAbsolute = args.absolute !== undefined;

                if ((hasDelta && hasAbsolute) || (!hasDelta && !hasAbsolute)) {
                    return toolError('delta または absolute のどちらか一方を指定してください');
                }

                if (hasDelta && args.delta === 0) {
                    return toolError('delta に 0 は指定できません');
                }

                const payload = {};
                if (hasDelta) payload.delta = args.delta;
                if (hasAbsolute) payload.absolute = args.absolute;
                if (args.reason !== undefined) payload.reason = args.reason;

                const res = await apiClient.changeQuantity(args.id, payload);

                return toolResult({
                    id: res.part_id ?? args.id,
                    previous_quantity: res.previous_quantity,
                    new_quantity: res.new_quantity,
                    delta: res.delta,
                    reason: res.reason,
                });
            } catch (err) {
                if (err instanceof ApiError) {
                    if (err.unknownOutcome) {
                        return toolError(
                            '結果不明です。リクエストがタイムアウトしたため、数量が反映されたか確認できません。' +
                            `get_part_detail で反映を確認してから再実行してください: ${err.message}`
                        );
                    }
                    if (err.status === 404) {
                        return toolError(`部品 ID ${args.id} は見つからないか、ゴミ箱・使用済みです。`);
                    }
                }
                return toolError(err.message || '数量の更新に失敗しました');
            }
        }
    );
}

module.exports = {
    registerUpdatePartQuantityTool,
};
