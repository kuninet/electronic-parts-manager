// pm2 jlist を Node 側でパースし「name\tstatus」を1行ずつ出力する
// PS 5.1 の ConvertFrom-Json は username/USERNAME 等の大文字小文字違いのキーで失敗するため
const { execSync } = require('child_process');
let raw;
try {
  raw = execSync('pm2 jlist', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const start = raw.search(/\[\s*[{\]]/);
const end = raw.lastIndexOf(']');
if (start < 0 || end < start) {
  console.error('pm2 jlist の JSON が見つかりません');
  process.exit(3);
}
try {
  const list = JSON.parse(raw.slice(start, end + 1));
  for (const a of list) {
    process.stdout.write(`${a.name}\t${a.pm2_env ? a.pm2_env.status : ''}\n`);
  }
} catch (e) {
  console.error('JSON パース失敗: ' + e.message);
  process.exit(4);
}
