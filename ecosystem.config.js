// PM2 定義（Windows 常駐運用）。詳細は docs/WINDOWS_SETUP.md
// script に npm を使わないこと（Windows で孫プロセスがポートを掴んだまま残るため）
const path = require('path');

const logDir = path.join(__dirname, 'logs', 'pm2');

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
  ],
};
