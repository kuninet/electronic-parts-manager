/**
 * create_part ツール実装
 * 新規電子部品を登録します（カテゴリ・保管場所の名前解決、型番重複確認付き）。
 */

const { z } = require('zod');
const { toPartSummary, toolResult, toolError } = require('../format.js');
const { resolveByName, normalizePartNumberKey } = require('../resolveMaster.js');
const { ApiError } = require('../apiClient.js');

const createPartSchema = {
    name: z.string().min(1).max(200),
    part_number: z.string().max(100).optional(),
    quantity: z.number().int().min(0).default(0),
    category_id: z.number().int().positive().optional(),
    category_name: z.string().max(100).optional(),
    location_id: z.number().int().positive().optional(),
    location_name: z.string().max(100).optional(),
    description: z.string().max(2000).optional(),
    allow_duplicate: z.boolean().default(false),
};

/**
 * McpServer に create_part ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerCreatePartTool(server, { apiClient, apiUrl }) {
    server.registerTool(
        'create_part',
        {
            title: '電子部品登録',
            description: '新しい電子部品を登録します。実行するとデータが登録されます。必要に応じて事前に search_parts や list_master_data で重複や既存マスタを確認してください。',
            annotations: {
                readOnlyHint: false,
                idempotentHint: false,
                openWorldHint: false,
                destructiveHint: false,
            },
            inputSchema: createPartSchema,
        },
        async (args) => {
            try {
                // 1. ID と 名前の排他指定検証
                if (args.category_id !== undefined && args.category_name !== undefined) {
                    return toolError('category_id と category_name はどちらか一方だけ指定してください');
                }
                if (args.location_id !== undefined && args.location_name !== undefined) {
                    return toolError('location_id と location_name はどちらか一方だけ指定してください');
                }

                // 2. カテゴリの名前解決
                let resolvedCategoryId = args.category_id;
                if (args.category_name !== undefined) {
                    const categories = await apiClient.listCategories();
                    const resolved = resolveByName(categories, args.category_name);
                    if (resolved.error === 'ambiguous') {
                        return toolError(`カテゴリ名「${args.category_name}」が複数あります（id: ${resolved.ids.join(', ')}）。category_id で指定してください。`);
                    }
                    if (resolved.error === 'not_found') {
                        const candStr = resolved.candidates.length > 0
                            ? `既存の候補: [${resolved.candidates.map(c => `${c.name} (id: ${c.id})`).join(', ')}]。`
                            : '';
                        return toolError(`カテゴリ「${args.category_name}」は存在しません。${candStr}list_master_data で一覧を確認してください。`);
                    }
                    resolvedCategoryId = resolved.id;
                }

                // 3. 保管場所の名前解決
                let resolvedLocationId = args.location_id;
                if (args.location_name !== undefined) {
                    const locations = await apiClient.listLocations();
                    const resolved = resolveByName(locations, args.location_name);
                    if (resolved.error === 'ambiguous') {
                        return toolError(`保管場所名「${args.location_name}」が複数あります（id: ${resolved.ids.join(', ')}）。location_id で指定してください。`);
                    }
                    if (resolved.error === 'not_found') {
                        const candStr = resolved.candidates.length > 0
                            ? `既存の候補: [${resolved.candidates.map(l => `${l.name} (id: ${l.id})`).join(', ')}]。`
                            : '';
                        return toolError(`保管場所「${args.location_name}」は存在しません。${candStr}list_master_data で一覧を確認してください。`);
                    }
                    resolvedLocationId = resolved.id;
                }

                // 4. 型番の重複確認
                if (args.part_number && !args.allow_duplicate) {
                    const normKey = normalizePartNumberKey(args.part_number);
                    if (normKey) {
                        const existingParts = await apiClient.listParts({ search: args.part_number });
                        const duplicate = Array.isArray(existingParts) ? existingParts.find(p => {
                            return normalizePartNumberKey(p.part_number) === normKey;
                        }) : null;

                        if (duplicate) {
                            const locName = duplicate.location_name || '未設定';
                            return toolError(
                                `型番「${args.part_number}」の部品が既に存在します（id: ${duplicate.id}, 名前: ${duplicate.name}, 数量: ${duplicate.quantity}, 保管場所: ${locName}）。` +
                                'update_part_quantity で在庫を追加するか、新規に別パーツとして登録する場合は allow_duplicate: true を指定して再実行してください。'
                            );
                        }
                    }
                }

                // 5. API 呼び出し用のペイロード構築（undefined は含めない）
                const payload = {
                    name: args.name,
                    quantity: args.quantity ?? 0,
                };
                if (args.part_number !== undefined) payload.part_number = args.part_number;
                if (resolvedCategoryId !== undefined) payload.category_id = resolvedCategoryId;
                if (resolvedLocationId !== undefined) payload.location_id = resolvedLocationId;
                if (args.description !== undefined) payload.description = args.description;

                const createRes = await apiClient.createPart(payload);
                const newId = createRes.id;

                // 6. 作成後詳細の取得
                try {
                    const detail = await apiClient.getPart(newId);
                    const partSummary = toPartSummary(detail, apiUrl);
                    return toolResult({
                        created: true,
                        part: partSummary,
                    });
                } catch {
                    return toolResult({
                        created: true,
                        part: { id: newId, name: args.name },
                        warning: '作成済みですが詳細の取得に失敗しました',
                    });
                }
            } catch (err) {
                if (err instanceof ApiError && err.unknownOutcome) {
                    return toolError(
                        '結果不明です。リクエストがタイムアウトしたため、反映されたか確認できません。' +
                        `get_part_detail か search_parts で反映を確認してから再実行してください: ${err.message}`
                    );
                }
                return toolError(err.message || '部品の作成に失敗しました');
            }
        }
    );
}

module.exports = {
    registerCreatePartTool,
};
