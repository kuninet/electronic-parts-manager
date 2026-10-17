const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('MCP Static Wiring and Safety Verification (W-1 ~ W-5)', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const mcpDir = path.resolve(rootDir, 'mcp');

    /**
     * 指定ディレクトリ以下の .js ファイルを再帰的に取得します（除外ディレクトリ指定可能）。
     */
    function getJsFiles(dir, excludeDirs = []) {
        const results = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!excludeDirs.includes(entry.name)) {
                    results.push(...getJsFiles(fullPath, excludeDirs));
                }
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                results.push(fullPath);
            }
        }
        return results;
    }

    test('W-1: mcp/**/*.js (mcp/test を除く) に stdout 出力処理が存在しないこと', () => {
        const jsFiles = getJsFiles(mcpDir, ['test']);
        assert.ok(jsFiles.length >= 6, `Expected at least 6 files, found ${jsFiles.length}`);

        const forbiddenPatterns = [
            'console.log(',
            'console.info(',
            'process.stdout.write(',
        ];

        for (const filePath of jsFiles) {
            const content = fs.readFileSync(filePath, 'utf-8');
            for (const pattern of forbiddenPatterns) {
                assert.equal(
                    content.includes(pattern),
                    false,
                    `Forbidden pattern "${pattern}" found in ${path.relative(rootDir, filePath)}`
                );
            }
        }
    });

    test('W-2: mcp/ 配下に DB アクセスやファイル書き込み API が存在しないこと (参照専用の担保)', () => {
        const jsFiles = getJsFiles(mcpDir, ['test']);

        const forbiddenApis = [
            'sqlite',
            "require('../server",
            'require("../server',
            'fs.writeFile',
            'fs.writeFileSync',
        ];

        for (const filePath of jsFiles) {
            const content = fs.readFileSync(filePath, 'utf-8');
            for (const api of forbiddenApis) {
                assert.equal(
                    content.includes(api),
                    false,
                    `Forbidden direct DB/write API "${api}" found in ${path.relative(rootDir, filePath)}`
                );
            }
        }
    });

    test('W-3: ルート package.json の scripts に mcp と test:mcp が正しく定義されていること', () => {
        const pkgPath = path.resolve(rootDir, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

        assert.equal(pkg.scripts?.mcp, 'node mcp/index.js');
        assert.ok(
            pkg.scripts?.test && pkg.scripts.test.includes('test:mcp'),
            'npm test script must include test:mcp'
        );
        assert.equal(pkg.scripts?.['test:mcp'], 'node --test mcp/test/*.test.js');
    });

    test('W-4: MCP 依存パッケージがルート dependencies にのみ存在し server に混入していないこと', () => {
        const rootPkg = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8'));
        const serverPkg = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'server/package.json'), 'utf-8'));

        assert.ok(rootPkg.dependencies?.['@modelcontextprotocol/sdk'], 'Root must depend on @modelcontextprotocol/sdk');
        assert.ok(rootPkg.dependencies?.['zod'], 'Root must depend on zod');

        assert.equal(serverPkg.dependencies?.['@modelcontextprotocol/sdk'], undefined, 'Server must not depend on MCP SDK');
        assert.equal(serverPkg.dependencies?.['zod'], undefined, 'Server must not depend on zod');
        assert.equal(serverPkg.devDependencies?.['@modelcontextprotocol/sdk'], undefined);
        assert.equal(serverPkg.devDependencies?.['zod'], undefined);
    });

    test('W-5: docs/MCP.md が存在し、必須環境変数と npm run mcp の注意書きを含んでいること', () => {
        const mcpDocPath = path.resolve(rootDir, 'docs/MCP.md');
        assert.ok(fs.existsSync(mcpDocPath), 'docs/MCP.md must exist');

        const docContent = fs.readFileSync(mcpDocPath, 'utf-8');
        assert.ok(docContent.includes('EPM_API_URL'), 'docs/MCP.md must document EPM_API_URL');
        assert.ok(docContent.includes('EPM_BASIC_AUTH'), 'docs/MCP.md must document EPM_BASIC_AUTH');
        assert.ok(docContent.includes('EPM_AUTH_TOKEN'), 'docs/MCP.md must document EPM_AUTH_TOKEN');
        assert.ok(docContent.includes('npm run mcp'), 'docs/MCP.md must warn against using npm run mcp in client config');
    });
});
