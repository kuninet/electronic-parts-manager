/**
 * search_purchase_items ツール実装
 * メール由来の購入明細（購入履歴）を検索します。
 */

const { z } = require('zod');
const { toPurchaseRecord, toolResult, toolError } = require('../format.js');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const searchPurchaseItemsSchema = {
    query: z.string().max(200).optional(),
    shop: z.string().max(100).optional(),
    order_id: z.string().max(100).optional(),
    part_id: z.number().int().positive().optional(),
    batch_id: z.number().int().positive().optional(),
    linked: z.boolean().optional(),
    from: z.string().regex(DATE_PATTERN).optional(),
    to: z.string().regex(DATE_PATTERN).optional(),
    currency: z.string().max(10).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
};

/**
 * McpServer に search_purchase_items ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerSearchPurchaseItemsTool(server, { apiClient }) {
    server.registerTool(
        'search_purchase_items',
        {
            title: '購入履歴検索',
            description:
                'メールの注文内容などから取り込んだ購入明細（何をいつどこでいくつ買ったか）を検索します。' +
                'query は商品名・型番や通販コード・注文番号の部分一致、shop は購入店の完全一致、from / to は注文日（YYYY-MM-DD、両端を含む）の範囲です。' +
                'batch_id を指定すると、その取り込みバッチ（import_purchase_items の batch_id）で新規登録した明細だけに絞れます（上書きされただけの明細は含みません）。' +
                '部品にひも付いていない明細を探すには linked: false を使います（linked: true はひも付け済み）。' +
                '部品との照合では、先に search_parts で部品を探し、その id を update_purchase_item の part_id に指定します。' +
                '結果は注文日の新しい順です。外貨の単価は換算せず、currency とともにそのまま返します。',
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: searchPurchaseItemsSchema,
        },
        async (args) => {
            try {
                const trimmed = (v) => (typeof v === 'string' ? v.trim() || undefined : undefined);
                const limit = args.limit ?? 50;
                const offset = args.offset ?? 0;

                const res = await apiClient.listPurchases({
                    search: trimmed(args.query),
                    shop: trimmed(args.shop),
                    order_id: trimmed(args.order_id),
                    part_id: args.part_id,
                    batch_id: args.batch_id,
                    linked: args.linked,
                    from: args.from,
                    to: args.to,
                    currency: trimmed(args.currency),
                    limit,
                    offset,
                });

                const total = typeof res?.total === 'number' ? res.total : 0;
                const items = Array.isArray(res?.items) ? res.items.map(toPurchaseRecord) : [];
                const truncated = offset + items.length < total;

                const result = {
                    total,
                    returned: items.length,
                    offset,
                    truncated,
                    items,
                };

                if (truncated) {
                    result.hint = `続きは offset: ${offset + items.length} で取得できます。条件を絞ることもできます（limit は最大 100）`;
                }

                return toolResult(result);
            } catch (err) {
                return toolError(err.message || String(err));
            }
        }
    );
}

module.exports = {
    searchPurchaseItemsSchema,
    registerSearchPurchaseItemsTool,
};
