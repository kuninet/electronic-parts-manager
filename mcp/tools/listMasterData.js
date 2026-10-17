/**
 * list_master_data ツール実装
 * カテゴリ一覧や保管場所一覧などのマスタデータを取得します。
 */

const { z } = require('zod');
const { toCategory, toLocation, toolResult, toolError } = require('../format.js');

const listMasterDataSchema = {
    type: z.enum(['all', 'categories', 'locations']).default('all'),
};

/**
 * McpServer に list_master_data ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerListMasterDataTool(server, { apiClient, apiUrl }) {
    server.registerTool(
        'list_master_data',
        {
            title: 'マスタデータ一覧取得',
            description: 'カテゴリ一覧や保管場所一覧などのマスタデータを取得します。部品検索の条件指定や部品情報の把握に利用できます。',
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: listMasterDataSchema,
        },
        async (args) => {
            try {
                const type = args.type ?? 'all';

                if (type === 'categories') {
                    const categories = await apiClient.listCategories();
                    return toolResult({
                        categories: Array.isArray(categories) ? categories.map(toCategory) : [],
                    });
                }

                if (type === 'locations') {
                    const locations = await apiClient.listLocations();
                    return toolResult({
                        locations: Array.isArray(locations) ? locations.map((loc) => toLocation(loc, apiUrl)) : [],
                    });
                }

                // type === 'all'
                const [categories, locations] = await Promise.all([
                    apiClient.listCategories(),
                    apiClient.listLocations(),
                ]);

                return toolResult({
                    categories: Array.isArray(categories) ? categories.map(toCategory) : [],
                    locations: Array.isArray(locations) ? locations.map((loc) => toLocation(loc, apiUrl)) : [],
                });
            } catch (err) {
                return toolError(err.message || String(err));
            }
        }
    );
}

module.exports = {
    listMasterDataSchema,
    registerListMasterDataTool,
};
