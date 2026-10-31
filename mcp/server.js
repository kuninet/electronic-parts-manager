/**
 * MCP サーバー構築モジュール
 * McpServer インスタンスを生成し、各ツールを登録します。
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { registerSearchPartsTool } = require('./tools/searchParts.js');
const { registerGetPartDetailTool } = require('./tools/getPartDetail.js');
const { registerListMasterDataTool } = require('./tools/listMasterData.js');
const { registerGetPartImageTool } = require('./tools/getPartImage.js');
const { registerCreatePartTool } = require('./tools/createPart.js');
const { registerUpdatePartTool } = require('./tools/updatePart.js');
const { registerUpdatePartQuantityTool } = require('./tools/updatePartQuantity.js');
const { registerStorePartLocationTool } = require('./tools/storePartLocation.js');
const { registerSearchPurchaseItemsTool } = require('./tools/searchPurchaseItems.js');
const { registerImportPurchaseItemsTool } = require('./tools/importPurchaseItems.js');
const { registerUpdatePurchaseItemTool } = require('./tools/updatePurchaseItem.js');

/**
 * MCP サーバーインスタンスを生成してツールを登録します。
 *
 * @param {{ apiClient: object, version?: string, readOnly?: boolean }} options
 * @returns {McpServer}
 */
function createMcpServer({ apiClient, version = '1.0.0', readOnly = false }) {
    const server = new McpServer({
        name: 'electronic-parts-manager',
        version,
    });

    const apiUrl = apiClient.apiUrl || '';

    // 参照系ツール（常に登録）
    registerSearchPartsTool(server, { apiClient, apiUrl });
    registerGetPartDetailTool(server, { apiClient, apiUrl });
    registerListMasterDataTool(server, { apiClient, apiUrl });
    registerGetPartImageTool(server, { apiClient, apiUrl });
    registerSearchPurchaseItemsTool(server, { apiClient, apiUrl });

    // 書き込み系ツール（readOnly が false の場合のみ登録）
    if (!readOnly) {
        registerCreatePartTool(server, { apiClient, apiUrl });
        registerUpdatePartTool(server, { apiClient, apiUrl });
        registerUpdatePartQuantityTool(server, { apiClient, apiUrl });
        registerStorePartLocationTool(server, { apiClient, apiUrl });
        registerImportPurchaseItemsTool(server, { apiClient, apiUrl });
        registerUpdatePurchaseItemTool(server, { apiClient, apiUrl });
    }

    return server;
}

module.exports = {
    createMcpServer,
};
