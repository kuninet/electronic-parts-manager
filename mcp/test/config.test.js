const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config.js');

describe('MCP Config Unit Tests (C-1 ~ C-9)', () => {
    test('C-1: env が空の場合、デフォルト設定を返す', () => {
        const config = loadConfig({});
        assert.equal(config.apiUrl, 'http://localhost:3001');
        assert.equal(config.authHeader, null);
        assert.equal(config.timeoutMs, 10000);
        assert.equal(config.warnings.length, 0);

        // 引数省略時のテスト
        const defaultConfig = loadConfig();
        assert.equal(defaultConfig.apiUrl, 'http://localhost:3001');
    });

    test('C-2: EPM_API_URL の末尾スラッシュを除外する', () => {
        const config = loadConfig({ EPM_API_URL: 'http://host:5173/' });
        assert.equal(config.apiUrl, 'http://host:5173');
    });

    test('C-3: EPM_API_URL の末尾 /api を除外する', () => {
        const config1 = loadConfig({ EPM_API_URL: 'https://x.cloudfront.net/api/' });
        assert.equal(config1.apiUrl, 'https://x.cloudfront.net');

        const config2 = loadConfig({ EPM_API_URL: 'https://x.cloudfront.net/api' });
        assert.equal(config2.apiUrl, 'https://x.cloudfront.net');
    });

    test('C-4: 不正な EPM_API_URL は例外を投げ、エラーメッセージに EPM_API_URL を含む', () => {
        assert.throws(() => {
            loadConfig({ EPM_API_URL: 'ftp://example.com' });
        }, (err) => {
            assert.match(err.message, /EPM_API_URL/);
            return true;
        });

        assert.throws(() => {
            loadConfig({ EPM_API_URL: 'not a url' });
        }, (err) => {
            assert.match(err.message, /EPM_API_URL/);
            return true;
        });
    });

    test('C-5: EPM_BASIC_AUTH は最初のコロンで分割し、Basic 認証ヘッダーを生成する', () => {
        const config = loadConfig({ EPM_BASIC_AUTH: 'admin:p:ss' });
        const expected = 'Basic ' + Buffer.from('admin:p:ss').toString('base64');
        assert.equal(config.authHeader, expected);
    });

    test('C-6: コロンがない、またはユーザー名が空の EPM_BASIC_AUTH は例外を投げ、値を含まない', () => {
        const secret1 = 'nocolon_secret';
        assert.throws(() => {
            loadConfig({ EPM_BASIC_AUTH: secret1 });
        }, (err) => {
            assert.doesNotMatch(err.message, new RegExp(secret1));
            return true;
        });

        const secret2 = 'mysecretpass';
        assert.throws(() => {
            loadConfig({ EPM_BASIC_AUTH: `:${secret2}` });
        }, (err) => {
            assert.doesNotMatch(err.message, new RegExp(secret2));
            return true;
        });
    });

    test('C-7: EPM_AUTH_TOKEN は Bearer 認証ヘッダーを生成する', () => {
        const config = loadConfig({ EPM_AUTH_TOKEN: 'abc' });
        assert.equal(config.authHeader, 'Bearer abc');
    });

    test('C-8: EPM_BASIC_AUTH と EPM_AUTH_TOKEN の両方が設定された場合は例外を投げる', () => {
        assert.throws(() => {
            loadConfig({
                EPM_BASIC_AUTH: 'admin:pass',
                EPM_AUTH_TOKEN: 'token123',
            });
        }, (err) => {
            assert.match(err.message, /Cannot specify both EPM_BASIC_AUTH and EPM_AUTH_TOKEN/);
            assert.doesNotMatch(err.message, /admin/);
            assert.doesNotMatch(err.message, /token123/);
            return true;
        });
    });

    test('C-9: 平文リモートホストの警告と EPM_API_TIMEOUT_MS の検証', () => {
        // リモートホスト + HTTP + Basic認証で警告発生
        const remoteConfig = loadConfig({
            EPM_API_URL: 'http://192.168.1.5:3001',
            EPM_BASIC_AUTH: 'admin:pass',
        });
        assert.equal(remoteConfig.warnings.length, 1);

        // localhost + HTTP + Basic認証では警告なし
        const localConfig = loadConfig({
            EPM_API_URL: 'http://localhost:3001',
            EPM_BASIC_AUTH: 'admin:pass',
        });
        assert.equal(localConfig.warnings.length, 0);

        // HTTPS + Basic認証では警告なし
        const httpsConfig = loadConfig({
            EPM_API_URL: 'https://192.168.1.5:3001',
            EPM_BASIC_AUTH: 'admin:pass',
        });
        assert.equal(httpsConfig.warnings.length, 0);

        // timeoutMs の正常値
        const validTimeout = loadConfig({ EPM_API_TIMEOUT_MS: '5000' });
        assert.equal(validTimeout.timeoutMs, 5000);

        // timeoutMs の異常値 (0, 負数, 数値以外, 小数)
        assert.throws(() => {
            loadConfig({ EPM_API_TIMEOUT_MS: '0' });
        }, /EPM_API_TIMEOUT_MS/);

        assert.throws(() => {
            loadConfig({ EPM_API_TIMEOUT_MS: '-10' });
        }, /EPM_API_TIMEOUT_MS/);

        assert.throws(() => {
            loadConfig({ EPM_API_TIMEOUT_MS: 'abc' });
        }, /EPM_API_TIMEOUT_MS/);

        assert.throws(() => {
            loadConfig({ EPM_API_TIMEOUT_MS: '10.5' });
        }, /EPM_API_TIMEOUT_MS/);
    });

    test('C-10: 認証設定に応じた authType の判定 (none / basic / bearer)', () => {
        const noAuth = loadConfig({});
        assert.equal(noAuth.authType, 'none');

        const basicAuth = loadConfig({ EPM_BASIC_AUTH: 'user:pass' });
        assert.equal(basicAuth.authType, 'basic');

        const bearerAuth = loadConfig({ EPM_AUTH_TOKEN: 'token123' });
        assert.equal(bearerAuth.authType, 'bearer');
    });

    test('C-11: EPM_MCP_READONLY による readOnly フラグの判定', () => {
        // 未設定時は false
        assert.equal(loadConfig({}).readOnly, false);

        // '1' または 'true'（大文字小文字無視・トリム）は true
        assert.equal(loadConfig({ EPM_MCP_READONLY: '1' }).readOnly, true);
        assert.equal(loadConfig({ EPM_MCP_READONLY: 'true' }).readOnly, true);
        assert.equal(loadConfig({ EPM_MCP_READONLY: ' TRUE ' }).readOnly, true);

        // '0', 'false', その他文字列は false
        assert.equal(loadConfig({ EPM_MCP_READONLY: '0' }).readOnly, false);
        assert.equal(loadConfig({ EPM_MCP_READONLY: 'false' }).readOnly, false);
        assert.equal(loadConfig({ EPM_MCP_READONLY: 'anything' }).readOnly, false);
    });
});
