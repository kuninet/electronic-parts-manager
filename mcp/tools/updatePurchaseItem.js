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
    suggested_part_id: z.number().int().positive().nullable().optional(),
    suggestion_note: z.string().max(1000).nullable().optional(),
};

// PATCH /api/purchases/:id にそのまま渡せる項目
const PATCH_FIELDS = [
    'shop', 'order_id', 'line_no', 'purchased_at', 'code', 'name',
    'unit_price', 'currency', 'quantity', 'part_id', 'source_msg_id', 'note',
    'suggested_part_id', 'suggestion_note',
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
                'ひも付けの運用: 型番やコードが一致するなど確実なものは part_id を直接設定します。このとき部品側の購入先・購入日・単価も、新しい購入であれば自動で更新されます（単価は JPY のときだけ。更新した項目は出力の part_updated に入ります。解除しても部品側は元に戻りません）。' +
                '迷うものは part_id を設定せず、suggested_part_id（候補の部品 id）と suggestion_note（判断理由、1000文字まで）を設定して、人が画面で承認するのを待ちます（承認や却下は画面で行う操作で、このツールにはありません）。part_id を設定すると候補は消えます。候補を取り消すには suggested_part_id に null を指定します。' +
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
                const { part_updated: partUpdated, ...record } = updated || {};
                return toolResult({
                    updated: true,
                    item: toPurchaseRecord(record),
                    part_updated: partUpdated ?? null,
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
