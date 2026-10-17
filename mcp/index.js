#!/usr/bin/env node

/**
 * MCP サーバーエントリポイント
 * stdio トランスポート経由で Claude Desktop や Antigravity 等の MCP クライアントと通信します。
 * 注意: stdout は JSON-RPC プロトコルが専有するため、ログはすべて stderr (console.error) に出力します。
 */

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { version } = require('../package.json');
const { loadConfig } = require('./config.js');
const { createApiClient } = require('./apiClient.js');
const { createMcpServer } = require('./server.js');

async function main() {
    let config;
    try {
        config = loadConfig(process.env);
    } catch (err) {
        console.error(`[epm-mcp] configuration error: ${err.message}`);
        process.exit(1);
    }

    for (const warning of config.warnings) {
        console.error(`[epm-mcp] warning: ${warning}`);
    }

    const apiClient = createApiClient(config);
    const server = createMcpServer({ apiClient, version, readOnly: config.readOnly });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`[epm-mcp] started (api: ${config.apiUrl}, auth: ${config.authType})`);

    const cleanup = async () => {
        try {
            await server.close();
        } catch (err) {
            console.error('[epm-mcp] error during shutdown:', err);
        }
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

process.on('unhandledRejection', (reason) => {
    console.error('[epm-mcp] unhandledRejection:', reason);
});

main().catch((err) => {
    console.error('[epm-mcp] fatal error:', err);
    process.exit(1);
});
