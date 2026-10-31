/**
 * undo_import_batch ツール実装
 * 取り込みバッチ単位で、登録した明細を削除し、更新した明細を元に戻します。
 */

const { z } = require('zod');
const { toolResult, toolError } = require('../format.js');
const { ApiError } = require('../apiClient.js');

const undoImportBatchSchema = {
    batch_id: z.number().int().positive(),
    confirm: z.boolean().default(false),
};

/**
 * McpServer に undo_import_batch ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerUndoImportBatchTool(server, { apiClient }) {
    server.registerTool(
        'undo_import_batch',
        {
            title: '取り込みバッチの取り消し',
            description:
                '購入履歴の取り込みバッチ（batch_id）を取り消します。そのバッチで新規登録した明細は削除し、上書きした明細は取り込み前の値に戻します（part_id も戻ります）。' +
                'confirm: true を指定しないときは何も変更せず、取り消した場合の件数だけを返します（deleted: 削除する件数、restored: 戻す件数、' +
                'missing: すでに存在しない件数、linked_deleted: 削除する明細のうち部品にひも付いている件数、modified_after_import: 取り込み後に変更された明細の件数）。' +
                '件数を確認してから confirm: true で実行してください。取り込み後に手で変更・ひも付けした内容も、削除または元に戻されます。' +
                '取り消し済みのバッチや、あとのバッチが同じ明細を変更しているバッチは取り消せません（あとのバッチを先に取り消してください）。' +
                '取り消したバッチの記録は残ります。',
            annotations: {
                readOnlyHint: false,
                idempotentHint: false,
                destructiveHint: true,
                openWorldHint: false,
            },
            inputSchema: undoImportBatchSchema,
        },
        async (args) => {
            const confirm = args.confirm === true;
            try {
                const res = await apiClient.undoImportBatch(args.batch_id, { dry_run: !confirm });
                if (!confirm) {
                    return toolResult({
                        ...res,
                        message: '確認のみで、何も変更していません。実行するには confirm: true を指定してください。',
                    });
                }
                return toolResult({ ...res, undone: true });
            } catch (err) {
                if (confirm && err instanceof ApiError && err.unknownOutcome) {
                    return toolError(
                        '結果不明です。リクエストがタイムアウトしたため、取り消されたか確認できません。' +
                        `list_import_batches で undone_at を確認してから再実行してください: ${err.message}`
                    );
                }
                return toolError(err.message || '取り込みバッチの取り消しに失敗しました');
            }
        }
    );
}

module.exports = {
    undoImportBatchSchema,
    registerUndoImportBatchTool,
};
