const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const scriptsDir = path.resolve(__dirname, '..');

function getPs1Files(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'test') {
                results = results.concat(getPs1Files(fullPath));
            }
        } else if (entry.isFile() && entry.name.endsWith('.ps1')) {
            results.push(fullPath);
        }
    }
    return results;
}

function getBatFiles(dir) {
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.bat'))
        .map(f => path.join(dir, f));
}

test('Windows スクリプト静的検査 (S-1 〜 S-8)', async (t) => {
    const ps1Files = getPs1Files(scriptsDir);
    const batFiles = getBatFiles(scriptsDir);

    await t.test('S-1: scripts/**/*.ps1 の先頭が UTF-8 BOM (EF BB BF) であること', () => {
        assert.ok(ps1Files.length > 0, '.ps1 ファイルが存在すること');
        for (const file of ps1Files) {
            const buf = fs.readFileSync(file);
            assert.ok(buf.length >= 3, `${file} のサイズが3バイト以上であること`);
            const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
            assert.ok(hasBom, `${path.basename(file)} は UTF-8 BOM 付きでなければなりません`);
        }
    });

    await t.test('S-2: scripts/**/*.ps1 および scripts/*.bat の改行コードがすべて CRLF であること', () => {
        const allScripts = [...ps1Files, ...batFiles];
        for (const file of allScripts) {
            const buf = fs.readFileSync(file);
            let hasAloneLf = false;
            for (let i = 0; i < buf.length; i++) {
                if (buf[i] === 0x0a) { // LF
                    if (i === 0 || buf[i - 1] !== 0x0d) { // Not preceded by CR
                        hasAloneLf = true;
                        break;
                    }
                }
            }
            assert.equal(hasAloneLf, false, `${path.basename(file)} に単独 LF が含まれています (CRLF必須)`);
        }
    });

    await t.test('S-3: scripts/*.bat が ASCII のみで D10 仕様（1行完結・引数転送・pause・exit /b）を満たすこと', () => {
        assert.ok(batFiles.length > 0, '.bat ファイルが存在すること');
        for (const file of batFiles) {
            const content = fs.readFileSync(file, 'utf8');
            // ASCII チェック (文字コード <= 127)
            for (let i = 0; i < content.length; i++) {
                assert.ok(content.charCodeAt(i) <= 127, `${path.basename(file)} に非 ASCII 文字が含まれています`);
            }

            assert.match(content, /chcp\s+65001/);
            assert.match(content, /-ExecutionPolicy\s+Bypass/);
            assert.match(content, /%~dp0/);
            assert.match(content, /\bpause\b/);
            assert.match(content, /\bexit\s+\/b\b/);

            // powershell.exe と pause が同一行にあること (D10 1行形式)
            const lines = content.split('\r\n').filter(l => l.trim().length > 0);
            const psLine = lines.find(l => l.includes('powershell.exe'));
            assert.ok(psLine, `${path.basename(file)} に powershell.exe 呼び出し行が存在すること`);
            assert.ok(psLine.includes('pause'), `${path.basename(file)} で powershell.exe と pause は同一行にあること`);

            if (path.basename(file) === 'update-and-restart.bat') {
                assert.match(content, /-Force\b/, 'update-and-restart.bat は既定で -Force を渡すこと');
            }
        }
    });

    await t.test('S-4: すべての .ps1 に PS 5.1 非互換構文・禁止構文が含まれていないこと', () => {
        const forbiddenPatterns = [
            { regex: /\?\?/, name: 'ヌル合体演算子 (??)' },
            { regex: /\?\./, name: 'オプショナルチェーン (?.)' },
            { regex: /-SkipCertificateCheck\b/, name: '-SkipCertificateCheck' },
            { regex: /-AsHashtable\b/, name: '-AsHashtable' },
            { regex: /git\s+clean\b/, name: 'git clean' }
        ];

        for (const file of ps1Files) {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split(/\r?\n/);
            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                const line = lines[lineNum];
                const trimmed = line.trim();
                if (trimmed.startsWith('#')) {
                    continue; // コメント行はスキップ
                }
                for (const pat of forbiddenPatterns) {
                    assert.equal(
                        pat.regex.test(line),
                        false,
                        `${path.basename(file)}:${lineNum + 1} に禁止構文 "${pat.name}" が含まれています: ${line}`
                    );
                }
            }
        }
    });

    await t.test('S-5: update-and-restart.ps1 に必須キーワードが含まれていること', () => {
        const updateScript = path.join(scriptsDir, 'update-and-restart.ps1');
        assert.ok(fs.existsSync(updateScript), 'update-and-restart.ps1 が存在すること');
        const content = fs.readFileSync(updateScript, 'utf8');

        assert.match(content, /--ff-only/);
        assert.match(content, /--untracked-files=no/);
        assert.match(content, /merge-base\s+--is-ancestor/);
        assert.match(content, /dist\.next/);
        assert.match(content, /\/api\/health/);
        assert.match(content, /\bfinally\b/);
        assert.match(content, /\$needRestart\s*=\s*\$true/, 'update-and-restart.ps1 で $needRestart が担保されていること');
        assert.match(content, /リモートコミットの差分はありませんが、再ビルド・再起動処理を継続します/, 'コミット差分なし時の継続ログが含まれていること');
    });

    await t.test('S-6: scripts/lib/epm-common.ps1 に必須関数と仕様が含まれていること', () => {
        const commonScript = path.join(scriptsDir, 'lib/epm-common.ps1');
        assert.ok(fs.existsSync(commonScript), 'scripts/lib/epm-common.ps1 が存在すること');
        const content = fs.readFileSync(commonScript, 'utf8');

        const requiredFunctions = [
            'Initialize-EpmLog',
            'Write-EpmLog',
            'Invoke-Native',
            'Get-GitOutput',
            'Get-RepoRoot',
            'Read-DotEnvValue',
            'Get-EpmPaths',
            'Test-NodeVersion',
            'Test-Prerequisites',
            'Get-Pm2Apps',
            'Stop-EpmApps',
            'Start-EpmApps',
            'Wait-EpmHealthy',
            'Test-EpmMcpHealthy',
            'Test-PortFree',
            'Get-FileCountSafe',
            'Invoke-ClientBuild',
            'Switch-ClientDist',
            'Restore-ClientDist',
            'Remove-OldDbBackups'
        ];

        for (const fn of requiredFunctions) {
            const pattern = new RegExp(`function\\s+${fn}\\b`);
            assert.match(content, pattern, `関数 ${fn} が定義されていること`);
        }

        assert.match(content, /database-\\d\{8\}_\\d\{6\}/, 'バックアップ削除正規表現が含まれていること');
        assert.match(content, /pm2-apps\.js/, 'Get-Pm2Apps で pm2-apps.js ヘルパーが呼び出されていること');
        assert.match(content, /curl\.exe\s+-k\s+-s\s+-m\s+3/, 'Wait-EpmHealthy に curl.exe によるプロキシ疎通確認が含まれていること');
        assert.match(content, /System\.Net\.Sockets\.TcpClient/, 'Wait-EpmHealthy に TCP フォールバックが含まれていること');
        assert.match(content, /WebScheme\s*=\s*\$webScheme/, 'Get-EpmPaths に WebScheme が定義されていること');
        // PS 5.1 の Get-Content は BOM なし UTF-8 を Shift_JIS として読み、日本語コメントの後ろの行を壊すため
        assert.match(content, /Get-Content -LiteralPath \$Path -Encoding UTF8/, 'Read-DotEnvValue が .env を UTF-8 として読むこと');
    });

    await t.test('S-7: ecosystem.config.js の構造と設定が正しいこと', () => {
        const configPath = path.join(repoRoot, 'ecosystem.config.js');
        assert.ok(fs.existsSync(configPath), 'ecosystem.config.js が存在すること');
        const config = require(configPath);

        assert.ok(Array.isArray(config.apps), 'apps が配列であること');
        assert.equal(config.apps.length, 3, '3つのアプリが定義されていること');

        const serverApp = config.apps.find(a => a.name === 'epm-server');
        const webApp = config.apps.find(a => a.name === 'epm-web');
        const mcpApp = config.apps.find(a => a.name === 'epm-mcp');

        assert.ok(serverApp, 'epm-server が定義されていること');
        assert.ok(webApp, 'epm-web が定義されていること');
        assert.ok(mcpApp, 'epm-mcp が定義されていること');

        assert.equal(serverApp.namespace, 'electronic-parts-manager');
        assert.equal(webApp.namespace, 'electronic-parts-manager');
        assert.equal(mcpApp.namespace, 'electronic-parts-manager');

        assert.ok(!serverApp.script.includes('npm'), 'epm-server の script に npm が含まれないこと');
        assert.ok(!webApp.script.includes('npm'), 'epm-web の script に npm が含まれないこと');
        assert.ok(!mcpApp.script.includes('npm'), 'epm-mcp の script に npm が含まれないこと');

        // ファイル存在確認
        const serverScriptPath = path.resolve(serverApp.cwd, serverApp.script);
        assert.ok(fs.existsSync(serverScriptPath), `server script が存在すること: ${serverScriptPath}`);

        const mcpScriptPath = path.resolve(mcpApp.cwd, mcpApp.script);
        assert.ok(fs.existsSync(mcpScriptPath), `mcp script が存在すること: ${mcpScriptPath}`);

        // client/node_modules がある場合のみ web script 確認
        const clientNm = path.join(webApp.cwd, 'node_modules');
        if (fs.existsSync(clientNm)) {
            const webScriptPath = path.resolve(webApp.cwd, webApp.script);
            assert.ok(fs.existsSync(webScriptPath), `web script が存在すること: ${webScriptPath}`);
        }

        assert.match(webApp.args, /--port\s+5173/);
        assert.match(webApp.args, /--strictPort/);
    });

    await t.test('S-8: .gitattributes と .gitignore に必須エントリが含まれていること', () => {
        const gitattributes = fs.readFileSync(path.join(repoRoot, '.gitattributes'), 'utf8');
        assert.match(gitattributes, /\*\.ps1\s+text\s+eol=crlf/);
        assert.match(gitattributes, /\*\.bat\s+text\s+eol=crlf/);

        const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
        assert.match(gitignore, /client\/dist\.next\//);
        assert.match(gitignore, /client\/dist\.prev\//);
        assert.match(gitignore, /logs\//);
    });

    await t.test('S-9: PM2個別操作バッチ (pm2-start, pm2-stop, pm2-restart) の検証', () => {
        const expected = [
            { name: 'pm2-start.bat', cmd: 'pm2 start' },
            { name: 'pm2-stop.bat', cmd: 'pm2 stop' },
            { name: 'pm2-restart.bat', cmd: 'pm2 restart' }
        ];

        for (const item of expected) {
            const filePath = path.join(scriptsDir, item.name);
            assert.ok(fs.existsSync(filePath), `${item.name} が存在すること`);

            const buf = fs.readFileSync(filePath);
            // BOM なしチェック (先頭3バイトが EF BB BF でないこと)
            const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
            assert.equal(hasBom, false, `${item.name} は BOM なしであること`);

            // 単独 LF なし（CRLF）チェック
            let hasAloneLf = false;
            for (let i = 0; i < buf.length; i++) {
                if (buf[i] === 0x0a) {
                    if (i === 0 || buf[i - 1] !== 0x0d) {
                        hasAloneLf = true;
                        break;
                    }
                }
            }
            assert.equal(hasAloneLf, false, `${item.name} は CRLF 改行であること`);

            const content = buf.toString('utf8');
            assert.match(content, /ecosystem\.config\.js/, `${item.name} は ecosystem.config.js を指定していること`);
            assert.match(content, new RegExp(item.cmd), `${item.name} は "${item.cmd}" を含んでいること`);
        }
    });

    await t.test('S-10: client/vite.config.js に preview.proxy 設定が含まれていること', () => {
        const viteConfigPath = path.join(repoRoot, 'client/vite.config.js');
        const content = fs.readFileSync(viteConfigPath, 'utf8');
        assert.match(content, /preview:\s*\{/, 'preview ブロックが定義されていること');
        assert.match(content, /'\/api':\s*\{\s*target:\s*'http:\/\/localhost:3001'/, 'preview.proxy で /api がプロキシされていること');
        assert.match(content, /'\/uploads':\s*\{\s*target:\s*'http:\/\/localhost:3001'/, 'preview.proxy で /uploads がプロキシされていること');
    });

    await t.test('S-11: scripts/lib/pm2-apps.js の存在、構文、実行仕様の検証', () => {
        const pm2AppsScript = path.join(scriptsDir, 'lib/pm2-apps.js');
        assert.ok(fs.existsSync(pm2AppsScript), 'scripts/lib/pm2-apps.js が存在すること');

        const content = fs.readFileSync(pm2AppsScript, 'utf8');
        assert.match(content, /pm2\s+jlist/, 'pm2 jlist 呼び出しが含まれていること');
        assert.match(content, /maxBuffer:\s*64\s*\*\s*1024\s*\*\s*1024/, 'maxBuffer 64MB が指定されていること');
        assert.match(content, /process\.exit\(2\)/, 'execSync 失敗時の exit 2 が定義されていること');
        assert.match(content, /process\.exit\(3\)/, 'JSON 不在時の exit 3 が定義されていること');
        assert.match(content, /process\.exit\(4\)/, 'JSON パース失敗時の exit 4 が定義されていること');

        // Node.js で構文チェック (--check)
        const { spawnSync } = require('node:child_process');
        const res = spawnSync(process.execPath, ['--check', pm2AppsScript]);
        assert.equal(res.status, 0, 'pm2-apps.js の構文が正常であること');
    });
});
