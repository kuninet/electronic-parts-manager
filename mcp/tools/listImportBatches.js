/**
 * list_import_batches ツール実装
 * import_purchase_items などで取り込んだバッチの一覧を返します。
 */

const { z } = require('zod');
const { toImportBatch, toolResult, toolError } = require('../format.js');

const listImportBatchesSchema = {
    limit: z.number().int().min(1).max(50).default(20),
};

/**
 * McpServer に list_import_batches ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerListImportBatchesTool(server, { apiClient }) {
    server.registerTool(
        'list_import_batches',
        {
            title: '取り込みバッチ一覧',
            description:
                '購入履歴の取り込みバッチ（import_purchase_items の 1 回分）を新しい順に返します。' +
                '各バッチの id、source、note、件数（total / created / updated / skipped / errors）、created_at、undone_at（取り消し済みなら日時）を含みます。' +
                'バッチで取り込んだ明細は search_purchase_items の batch_id で調べられ、取り消しは undo_import_batch で行います。',
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: listImportBatchesSchema,
        },
        async (args) => {
            try {
                const limit = args.limit ?? 20;
                const rows = await apiClient.listImportBatches({ limit });
                const batches = Array.isArray(rows) ? rows.map(toImportBatch) : [];
                return toolResult({ returned: batches.length, batches });
            } catch (err) {
                return toolError(err.message || String(err));
            }
        }
    );
}

module.exports = {
    listImportBatchesSchema,
    registerListImportBatchesTool,
};
