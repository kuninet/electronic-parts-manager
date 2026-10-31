const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config.js');

describe('MCP Config Unit Tests (C-1 ~ C-24)', () => {
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

    test('C-13: EPM_IMAGE_MAX_BYTES が未設定の場合、既定値 10485760 (10MB) を返す', () => {
        const config = loadConfig({});
        assert.equal(config.imageMaxBytes, 10485760);
    });

    test('C-14: EPM_IMAGE_MAX_BYTES=2000000 で設定した場合、数値 2000000 を返す', () => {
        const config = loadConfig({ EPM_IMAGE_MAX_BYTES: '2000000' });
        assert.equal(config.imageMaxBytes, 2000000);
    });

    test('C-15: EPM_IMAGE_MAX_BYTES の異常値 (0, -1, abc, 1.5, 52428801) は例外を投げ EPM_IMAGE_MAX_BYTES を含む', () => {
        const badValues = ['0', '-1', 'abc', '1.5', '52428801'];
        for (const val of badValues) {
            assert.throws(() => {
                loadConfig({ EPM_IMAGE_MAX_BYTES: val });
            }, (err) => {
                assert.match(err.message, /EPM_IMAGE_MAX_BYTES/);
                return true;
            });
        }
    });

    test('C-16: リモート MCP 設定の既定値は port=3002, host=0.0.0.0, allowedHosts=[]', () => {
        const config = loadConfig({});
        assert.equal(config.httpPort, 3002);
        assert.equal(config.httpHost, '0.0.0.0');
        assert.deepEqual(config.allowedHosts, []);
    });

    test('C-17: EPM_MCP_HTTP_PORT は 0〜65535 の整数を受け付ける', () => {
        assert.equal(loadConfig({ EPM_MCP_HTTP_PORT: '8080' }).httpPort, 8080);
        assert.equal(loadConfig({ EPM_MCP_HTTP_PORT: '0' }).httpPort, 0);
        assert.equal(loadConfig({ EPM_MCP_HTTP_PORT: '' }).httpPort, 3002);
    });

    test('C-18: EPM_MCP_HTTP_PORT の異常値 (abc, -1, 65536, 1.5) は例外を投げる', () => {
        for (const val of ['abc', '-1', '65536', '1.5']) {
            assert.throws(() => {
                loadConfig({ EPM_MCP_HTTP_PORT: val });
            }, /EPM_MCP_HTTP_PORT must be an integer between 0 and 65535/);
        }
    });

    test('C-19: EPM_MCP_HTTP_HOST は trim され、空なら既定値になる', () => {
        assert.equal(loadConfig({ EPM_MCP_HTTP_HOST: ' 127.0.0.1 ' }).httpHost, '127.0.0.1');
        assert.equal(loadConfig({ EPM_MCP_HTTP_HOST: '' }).httpHost, '0.0.0.0');
        assert.equal(loadConfig({ EPM_MCP_HTTP_HOST: '   ' }).httpHost, '0.0.0.0');
    });

    test('C-20: EPM_MCP_ALLOWED_HOSTS は trim・小文字化・重複除去され、ポート付きは例外を投げる', () => {
        assert.deepEqual(
            loadConfig({ EPM_MCP_ALLOWED_HOSTS: ' A.local, 192.168.1.10 ,,a.local' }).allowedHosts,
            ['a.local', '192.168.1.10']
        );
        assert.deepEqual(loadConfig({ EPM_MCP_ALLOWED_HOSTS: '[::1]' }).allowedHosts, ['[::1]']);

        for (const val of ['host:3002', '[::1]:3002']) {
            assert.throws(() => {
                loadConfig({ EPM_MCP_ALLOWED_HOSTS: val });
            }, /EPM_MCP_ALLOWED_HOSTS must contain hostnames without ports/);
        }
    });

    test('C-21: EPM_MCP_ALLOWED_HOSTS は new URL と同じ正規化を行い、不正な形式は例外を投げる', () => {
        // 先頭ゼロ付きの IPv4 は WHATWG URL 仕様では 8 進数として解釈される。Host ヘッダー側も同じ正規化をかけるため、
        // 設定値と実際の Host が同じ表記なら一致し、別の IP と誤認されることもない
        assert.deepEqual(
            loadConfig({ EPM_MCP_ALLOWED_HOSTS: '192.168.001.010' }).allowedHosts,
            ['192.168.1.8']
        );
        assert.deepEqual(
            loadConfig({ EPM_MCP_ALLOWED_HOSTS: '0xC0.168.1.10' }).allowedHosts,
            ['192.168.1.10']
        );
        for (const val of ['evil@epm.local', 'epm.local/foo', 'a b', 'ho$t']) {
            assert.throws(() => {
                loadConfig({ EPM_MCP_ALLOWED_HOSTS: val });
            }, /EPM_MCP_ALLOWED_HOSTS/);
        }
    });

    test('C-22: EPM_MCP_ALLOWED_ORIGINS の既定値は空配列', () => {
        assert.deepEqual(loadConfig({}).allowedOrigins, []);
        assert.deepEqual(loadConfig({ EPM_MCP_ALLOWED_ORIGINS: '' }).allowedOrigins, []);
    });

    test('C-23: EPM_MCP_ALLOWED_ORIGINS は new URL(v).origin で正規化・重複除去される', () => {
        const config = loadConfig({
            EPM_MCP_ALLOWED_ORIGINS: ' http://192.168.1.10:5173/path , HTTP://EPM.local:80 ,,http://192.168.1.10:5173',
        });
        assert.deepEqual(config.allowedOrigins, ['http://192.168.1.10:5173', 'http://epm.local']);
    });

    test('C-24: EPM_MCP_ALLOWED_ORIGINS に URL として不正な値があれば例外を投げる', () => {
        for (const val of ['not a url', '192.168.1.10:5173', 'null']) {
            assert.throws(() => {
                loadConfig({ EPM_MCP_ALLOWED_ORIGINS: val });
            }, /EPM_MCP_ALLOWED_ORIGINS/);
        }
    });
});
