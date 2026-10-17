/**
 * MCP サーバー構築モジュール
 * McpServer インスタンスを生成し、各ツールを登録します。
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { registerSearchPartsTool } = require('./tools/searchParts.js');
const { registerGetPartDetailTool } = require('./tools/getPartDetail.js');
const { registerListMasterDataTool } = require('./tools/listMasterData.js');

/**
 * MCP サーバーインスタンスを生成してツールを登録します。
 *
 * @param {{ apiClient: object, version?: string }} options
 * @returns {McpServer}
 */
function createMcpServer({ apiClient, version = '1.0.0' }) {
    const server = new McpServer({
        name: 'electronic-parts-manager',
        version,
    });

    const apiUrl = apiClient.apiUrl || '';

    registerSearchPartsTool(server, { apiClient, apiUrl });
    registerGetPartDetailTool(server, { apiClient, apiUrl });
    registerListMasterDataTool(server, { apiClient, apiUrl });

    return server;
}

module.exports = {
    createMcpServer,
};
