const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('MCP Static Wiring and Safety Verification (W-1 ~ W-12)', () => {
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

    test('W-6: mcp/tools/ の書き込み系 3 ファイルに readOnlyHint: false があること', () => {
        const writeToolFiles = ['createPart.js', 'updatePartQuantity.js', 'storePartLocation.js'];
        for (const file of writeToolFiles) {
            const filePath = path.resolve(mcpDir, 'tools', file);
            assert.ok(fs.existsSync(filePath), `${file} must exist`);
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.match(content, /readOnlyHint:\s*false/, `${file} must have readOnlyHint: false`);
        }
    });

    test('W-7: mcp/apiClient.js に POST の自動再送（ループの中での fetch）が無いこと', () => {
        const apiClientPath = path.resolve(mcpDir, 'apiClient.js');
        const content = fs.readFileSync(apiClientPath, 'utf-8');

        // while や for ループの中で fetchImpl / fetch を呼ぶパターンが存在しないこと
        assert.doesNotMatch(content, /while\s*\([^)]*\)\s*\{[^{}]*fetchImpl/, 'No retry loop around fetchImpl');
        assert.doesNotMatch(content, /for\s*\([^)]*\)\s*\{[^{}]*fetchImpl/, 'No for loop around fetchImpl');
    });

    test('W-8: docs/MCP.md に EPM_API_TOKEN、EPM_MCP_READONLY、create_part、update_part_quantity、store_part_location があること', () => {
        const mcpDocPath = path.resolve(rootDir, 'docs/MCP.md');
        const docContent = fs.readFileSync(mcpDocPath, 'utf-8');

        assert.ok(docContent.includes('EPM_API_TOKEN'), 'docs/MCP.md must include EPM_API_TOKEN');
        assert.ok(docContent.includes('EPM_MCP_READONLY'), 'docs/MCP.md must include EPM_MCP_READONLY');
        assert.ok(docContent.includes('create_part'), 'docs/MCP.md must include create_part');
        assert.ok(docContent.includes('update_part_quantity'), 'docs/MCP.md must include update_part_quantity');
        assert.ok(docContent.includes('store_part_location'), 'docs/MCP.md must include store_part_location');
    });

    test('W-9: docs/API.md に EPM_API_TOKEN と API_TOKEN_REQUIRED があること', () => {
        const apiDocPath = path.resolve(rootDir, 'docs/API.md');
        const docContent = fs.readFileSync(apiDocPath, 'utf-8');

        assert.ok(docContent.includes('EPM_API_TOKEN'), 'docs/API.md must include EPM_API_TOKEN');
        assert.ok(docContent.includes('API_TOKEN_REQUIRED'), 'docs/API.md must include API_TOKEN_REQUIRED');
    });

    test('W-10: mcp/tools/getPartImage.js に readOnlyHint: true があり、console. を使っていないこと', () => {
        const filePath = path.resolve(mcpDir, 'tools/getPartImage.js');
        assert.ok(fs.existsSync(filePath), 'getPartImage.js must exist');
        const content = fs.readFileSync(filePath, 'utf-8');
        assert.match(content, /readOnlyHint:\s*true/, 'must have readOnlyHint: true');
        assert.doesNotMatch(content, /console\./, 'must not use console.');
    });

    test('W-11: mcp/server.js で registerGetPartImageTool の呼び出しが if (!readOnly) より前にあること', () => {
        const serverPath = path.resolve(mcpDir, 'server.js');
        const content = fs.readFileSync(serverPath, 'utf-8');
        const callIndex = content.indexOf('registerGetPartImageTool(');
        const ifIndex = content.indexOf('if (!readOnly)');
        assert.ok(callIndex !== -1, 'registerGetPartImageTool must be called');
        assert.ok(ifIndex !== -1, 'if (!readOnly) must exist');
        assert.ok(callIndex < ifIndex, 'registerGetPartImageTool must be called before if (!readOnly)');
    });

    test('W-12: docs/MCP.md に get_part_image と EPM_IMAGE_MAX_BYTES が含まれていること', () => {
        const mcpDocPath = path.resolve(rootDir, 'docs/MCP.md');
        const docContent = fs.readFileSync(mcpDocPath, 'utf-8');
        assert.ok(docContent.includes('get_part_image'), 'docs/MCP.md must include get_part_image');
        assert.ok(docContent.includes('EPM_IMAGE_MAX_BYTES'), 'docs/MCP.md must include EPM_IMAGE_MAX_BYTES');
    });
});
