/**
 * import_purchase_items ツール実装
 * 購入明細（購入履歴）を一括で取り込みます。同じ明細は重複登録されません。
 */

const { z } = require('zod');
const { toolResult, toolError } = require('../format.js');
const { ApiError } = require('../apiClient.js');

// 検証はサーバーに任せる（不正な明細 1 件で全件が弾かれず、明細ごとのエラーとして返るようにするため）。
// ここでは各項目を z.any() にとどめ、配列の件数と on_duplicate だけを検証する
const purchaseRecordInputSchema = z.object({
    shop: z.any().optional(),
    order_id: z.any().optional(),
    line_no: z.any().optional(),
    purchased_at: z.any().optional(),
    code: z.any().optional(),
    name: z.any().optional(),
    unit_price: z.any().optional(),
    currency: z.any().optional(),
    quantity: z.any().optional(),
    part_id: z.any().optional(),
    source_msg_id: z.any().optional(),
    note: z.any().optional(),
}).passthrough();

const importPurchaseItemsSchema = {
    records: z.array(purchaseRecordInputSchema).min(1).max(500),
    on_duplicate: z.enum(['skip', 'update']).default('skip'),
    dry_run: z.boolean().default(false),
    source: z.string().max(100).optional(),
    note: z.string().max(1000).optional(),
};

// dry_run の preview に載せる件数の上限
const PREVIEW_LIMIT = 20;

/**
 * McpServer に import_purchase_items ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerImportPurchaseItemsTool(server, { apiClient }) {
    server.registerTool(
        'import_purchase_items',
        {
            title: '購入履歴取り込み',
            description:
                '購入明細（注文の 1 明細が 1 レコード）を一括で登録します。1 回に 1〜500 件まで。500 件を超えるときは分けて呼んでください（順番に呼び、並列にはしないでください）。' +
                '項目は shop（購入店・必須）、name（商品名・必須）、order_id（注文番号）、line_no（注文内の明細行番号）、purchased_at（注文日 YYYY-MM-DD）、code（通販コードや型番）、' +
                'unit_price（単価）、currency（通貨、既定 JPY。外貨は換算せずそのまま）、quantity、part_id（対応する部品の id）、source_msg_id（元メールの ID）、note です。' +
                '重複の判定キーは shop に加えて、order_id と line_no があれば「order_id＋line_no」、order_id のみなら「order_id＋正規化した name」、' +
                'order_id がなく source_msg_id があれば「source_msg_id＋正規化した name」です。order_id と source_msg_id のどちらも無い明細はエラーになります。' +
                '同じ注文でも line_no の有無でキーが変わるため、同じ店では line_no を付けるかどうかをそろえてください。同じリクエスト内で同じキーになった明細には warning が付きます。' +
                '同じデータを再度取り込んでも二重に登録されません（on_duplicate: skip は既存を変えず、update は送った項目で上書きします。update でも part_id が null や未指定なら既存のひも付けは残ります）。' +
                '存在しない part_id はひも付けずに登録し、warning を返します。明細ごとのエラーはほかの明細に影響しません。' +
                '大量に取り込む前は dry_run: true で件数と内容を確認してください（何も登録せず、集計と、created・updated の先頭20件の preview を返します）。' +
                '本番の取り込みは batch_id を返します（同じデータを再実行しても明細は重複しませんが、取り込みバッチの記録は毎回作られます）。取り込みを取り消すには undo_import_batch に batch_id を指定します（list_import_batches で一覧、search_purchase_items の batch_id で内容を確認できます）。source と note は取り込みバッチの記録用の任意項目です。' +
                '数千件を超える大量のファイルは、REST の POST /api/purchases/import に直接送れます（docs/MCP.md 参照）。' +
                '実行するとデータが変更されます。',
            annotations: {
                readOnlyHint: false,
                idempotentHint: true,
                destructiveHint: false,
                openWorldHint: false,
            },
            inputSchema: importPurchaseItemsSchema,
        },
        async (args) => {
            try {
                const dryRun = args.dry_run === true;
                const payload = {
                    records: args.records,
                    on_duplicate: args.on_duplicate ?? 'skip',
                };
                if (dryRun) payload.dry_run = true;
                if (args.source !== undefined) payload.source = args.source;
                if (args.note !== undefined) payload.note = args.note;

                const res = await apiClient.importPurchases(payload);

                const results = Array.isArray(res?.results) ? res.results : [];
                // 全件を返すと長くなるため、エラーと warning のある明細だけを返す
                const notable = results.filter((r) => r.status === 'error' || r.warning);
                const summary = {
                    total: res.total,
                    created: res.created,
                    updated: res.updated,
                    skipped: res.skipped,
                    errors: res.errors,
                };

                if (dryRun) {
                    const preview = results
                        .filter((r) => r.status === 'created' || r.status === 'updated')
                        .slice(0, PREVIEW_LIMIT)
                        .map((r) => {
                            const item = { index: r.index, status: r.status, record: r.record };
                            if (r.before !== undefined) item.before = r.before;
                            return item;
                        });
                    return toolResult({
                        dry_run: true,
                        ...summary,
                        results: notable,
                        preview,
                        message: '何も登録していません。内容を確認して問題なければ、dry_run を外して実行してください。',
                    });
                }

                const ids = results
                    .filter((r) => (r.status === 'created' || r.status === 'updated') && r.id !== undefined)
                    .map((r) => r.id);
                return toolResult({
                    ...summary,
                    batch_id: res.batch_id ?? null,
                    ids,
                    results: notable,
                });
            } catch (err) {
                if (err instanceof ApiError && err.unknownOutcome) {
                    return toolError(
                        '結果不明です。リクエストがタイムアウトしたため、取り込まれたか確認できません。' +
                        '同じ内容で再実行しても重複は登録されません（search_purchase_items で確認することもできます）: ' + err.message
                    );
                }
                return toolError(err.message || '購入履歴の取り込みに失敗しました');
            }
        }
    );
}

module.exports = {
    importPurchaseItemsSchema,
    registerImportPurchaseItemsTool,
};
