/**
 * search_parts ツール実装
 * 電子部品をキーワード、カテゴリ、保管場所で検索します。
 */

const { z } = require('zod');
const { toPartSummary, toolResult, toolError } = require('../format.js');

const searchPartsSchema = {
    query: z.string().max(200).optional(),
    category_id: z.number().int().positive().optional(),
    location_id: z.number().int().positive().optional(),
    shop: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(200).default(50),
};

/**
 * McpServer に search_parts ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerSearchPartsTool(server, { apiClient, apiUrl }) {
    server.registerTool(
        'search_parts',
        {
            title: '電子部品検索',
            description: '電子部品の在庫を名前・型番・説明・購入先のキーワードやカテゴリ・保管場所・購入先で検索します。使用済みとゴミ箱の部品は含みません。',
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: searchPartsSchema,
        },
        async (args) => {
            try {
                const query = typeof args.query === 'string' ? args.query.trim() : undefined;
                const search = query || undefined;
                const category_id = args.category_id;
                const location_id = args.location_id;
                const shop = typeof args.shop === 'string' ? args.shop.trim() || undefined : undefined;
                const limit = args.limit ?? 50;

                const allParts = await apiClient.listParts({ search, category_id, location_id, shop });
                const total = Array.isArray(allParts) ? allParts.length : 0;
                const truncated = total > limit;
                const sliced = Array.isArray(allParts) ? allParts.slice(0, limit) : [];
                const parts = sliced.map((part) => toPartSummary(part, apiUrl));

                const result = {
                    total,
                    returned: parts.length,
                    truncated,
                    parts,
                };

                if (truncated) {
                    result.hint = '条件を絞るか limit を増やしてください（最大 200）';
                }

                return toolResult(result);
            } catch (err) {
                return toolError(err.message || String(err));
            }
        }
    );
}

module.exports = {
    searchPartsSchema,
    registerSearchPartsTool,
};
