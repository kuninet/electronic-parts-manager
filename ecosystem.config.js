// PM2 定義（Windows 常駐運用）。詳細は docs/WINDOWS_SETUP.md
// script に npm を使わないこと（Windows で孫プロセスがポートを掴んだまま残るため）
// MCP（epm-mcp）の設定は mcp/.env に書く（mcp/.env.example 参照）。mcp/.env は未追跡なので update-and-restart を止めない
const fs = require('fs');
const path = require('path');
const { readEnvFile, buildMcpEnv } = require('./mcp/envFile.js');

const logDir = path.join(__dirname, 'logs', 'pm2');

// server/.env は server 本体（dotenv）と同じ解釈で読む。dotenv が読み込めない場合は簡易パーサーに戻す
function readServerEnv(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const dotenv = require('./server/node_modules/dotenv');
    return dotenv.parse(fs.readFileSync(filePath));
  } catch (err) {
    return readEnvFile(filePath);
  }
}

// epm-mcp に渡す環境変数（mcp/.env を優先し、API の URL とトークンは server/.env から補う）
const mcpEnv = buildMcpEnv(
  readEnvFile(path.join(__dirname, 'mcp', '.env')),
  readServerEnv(path.join(__dirname, 'server', '.env'))
);

module.exports = {
  apps: [
    {
      name: 'epm-server',
      namespace: 'electronic-parts-manager',
      cwd: path.join(__dirname, 'server'),
      script: 'index.js',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      kill_timeout: 5000,
      out_file: path.join(logDir, 'epm-server.out.log'),
      error_file: path.join(logDir, 'epm-server.err.log'),
      time: true,
    },
    {
      name: 'epm-web',
      namespace: 'electronic-parts-manager',
      cwd: path.join(__dirname, 'client'),
      script: 'node_modules/vite/bin/vite.js',
      args: 'preview --port 5173 --strictPort',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      out_file: path.join(logDir, 'epm-web.out.log'),
      error_file: path.join(logDir, 'epm-web.err.log'),
      time: true,
    },
    {
      name: 'epm-mcp',
      namespace: 'electronic-parts-manager',
      cwd: __dirname,
      script: 'mcp/http.js',
      env: mcpEnv,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      kill_timeout: 5000,
      out_file: path.join(logDir, 'epm-mcp.out.log'),
      error_file: path.join(logDir, 'epm-mcp.err.log'),
      time: true,
    },
  ],
};
