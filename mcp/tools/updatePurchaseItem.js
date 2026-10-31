/**
 * update_purchase_item ツール実装
 * 購入明細（購入履歴）の項目を部分更新します。部品とのひも付けもここで行います。
 */

const { z } = require('zod');
const { toPurchaseRecord, toolResult, toolError } = require('../format.js');
const { ApiError } = require('../apiClient.js');

const updatePurchaseItemSchema = {
    id: z.number().int().positive(),
    shop: z.string().min(1).max(100).optional(),
    order_id: z.union([z.string().max(100), z.number()]).nullable().optional(),
    line_no: z.number().int().min(0).nullable().optional(),
    purchased_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    code: z.string().max(100).nullable().optional(),
    name: z.string().min(1).max(500).optional(),
    unit_price: z.number().min(0).max(1e9).nullable().optional(),
    currency: z.string().max(10).nullable().optional(),
    quantity: z.number().int().min(0).nullable().optional(),
    part_id: z.number().int().positive().nullable().optional(),
    source_msg_id: z.string().max(200).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
};

// PATCH /api/purchases/:id にそのまま渡せる項目
const PATCH_FIELDS = [
    'shop', 'order_id', 'line_no', 'purchased_at', 'code', 'name',
    'unit_price', 'currency', 'quantity', 'part_id', 'source_msg_id', 'note',
];

/**
 * McpServer に update_purchase_item ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerUpdatePurchaseItemTool(server, { apiClient }) {
    server.registerTool(
        'update_purchase_item',
        {
            title: '購入履歴更新',
            description:
                '購入明細 1 件の項目を更新します（id は search_purchase_items で調べます）。指定しない項目は変更しません。' +
                '部品とのひも付けは part_id に部品の id を指定し、外すときは part_id に null を指定します（存在しない部品の id はエラーです）。' +
                'order_id・line_no・source_msg_id・code・purchased_at・unit_price・quantity・note は null を指定すると消去できます。shop と name は消去できません。' +
                'shop・order_id・line_no・name・source_msg_id を変えた結果、ほかの明細と同じ明細になる場合は競合エラーになります。' +
                '実行するとデータが変更されます。',
            annotations: {
                readOnlyHint: false,
                idempotentHint: true,
                destructiveHint: false,
                openWorldHint: false,
            },
            inputSchema: updatePurchaseItemSchema,
        },
        async (args) => {
            try {
                const payload = {};
                for (const f of PATCH_FIELDS) {
                    if (args[f] !== undefined) payload[f] = args[f];
                }
                if (Object.keys(payload).length === 0) {
                    return toolError('更新する項目を1つ以上指定してください');
                }

                const updated = await apiClient.patchPurchase(args.id, payload);
                return toolResult({
                    updated: true,
                    item: toPurchaseRecord(updated),
                });
            } catch (err) {
                if (err instanceof ApiError && err.unknownOutcome) {
                    return toolError(
                        '結果不明です。リクエストがタイムアウトしたため、反映されたか確認できません。' +
                        `search_purchase_items で反映を確認してから再実行してください: ${err.message}`
                    );
                }
                return toolError(err.message || '購入履歴の更新に失敗しました');
            }
        }
    );
}

module.exports = {
    updatePurchaseItemSchema,
    registerUpdatePurchaseItemTool,
};
