const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseEnvFile, readEnvFile, buildMcpEnv } = require('../envFile.js');

describe('MCP envFile Unit Tests (E-1 ~ E-16)', () => {
    test('E-1: コメント行と空行を無視する', () => {
        const result = parseEnvFile('# comment\n\n  # indented comment\nA=1\n');
        assert.deepEqual(result, { A: '1' });
    });

    test('E-2: 値の両端が同じ引用符なら 1 組だけ外す', () => {
        const result = parseEnvFile('A="x y"\nB=\'z\'\nC="\'q\'"\nD="a\'\nE=""\n');
        assert.deepEqual(result, { A: 'x y', B: 'z', C: "'q'", D: '"a\'', E: '' });
    });

    test('E-3: = の前後の空白を許容し、値の前後を trim する', () => {
        const result = parseEnvFile('  A  =  hello  \nB=a = b\n');
        assert.deepEqual(result, { A: 'hello', B: 'a = b' });
    });

    test('E-4: 不正なキーの行は無視する', () => {
        const result = parseEnvFile('1A=x\nA-B=y\n=z\nno equal sign\nOK_1=v\n');
        assert.deepEqual(result, { OK_1: 'v' });
    });

    test('E-5: 同じキーが複数ある場合は最初の値を採用する', () => {
        const result = parseEnvFile('A=first\nA=second\n');
        assert.equal(result.A, 'first');
    });

    test('E-6: 先頭の BOM を除去する', () => {
        const result = parseEnvFile('﻿A=1\nB=2\n');
        assert.deepEqual(result, { A: '1', B: '2' });
    });

    test('E-7: CRLF 改行を扱える', () => {
        const result = parseEnvFile('A=1\r\nB="2"\r\n\r\nC=3\r\n');
        assert.deepEqual(result, { A: '1', B: '2', C: '3' });
    });

    test('E-8: ファイルが存在しない場合は空オブジェクトを返す', () => {
        const missing = path.join(os.tmpdir(), `epm-no-such-env-${process.pid}-${Date.now()}`);
        assert.deepEqual(readEnvFile(missing), {});
    });

    test('E-9: ファイルが存在する場合は内容を解析して返す', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epm-envfile-'));
        const file = path.join(dir, '.env');
        try {
            fs.writeFileSync(file, '﻿EPM_MCP_HTTP_PORT=3999\r\n# x\r\n', 'utf8');
            assert.deepEqual(readEnvFile(file), { EPM_MCP_HTTP_PORT: '3999' });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('E-10: 読み取りに失敗しても例外を投げず空オブジェクトを返す（パスがディレクトリの場合）', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epm-envfile-dir-'));
        const originalError = console.error;
        const logged = [];
        console.error = (...args) => { logged.push(args.join(' ')); };
        try {
            assert.deepEqual(readEnvFile(dir), {});
        } finally {
            console.error = originalError;
            fs.rmSync(dir, { recursive: true, force: true });
        }
        assert.equal(logged.length, 1);
        assert.match(logged[0], /failed to read env file/);
    });

    test('E-11: buildMcpEnv は mcp/.env に EPM_API_URL があればそれを優先する', () => {
        const env = buildMcpEnv({ EPM_API_URL: 'http://192.168.1.10:3001' }, { PORT: '4000' });
        assert.equal(env.EPM_API_URL, 'http://192.168.1.10:3001');
    });

    test('E-12: buildMcpEnv は EPM_API_URL が無い（または空）なら server/.env の PORT に追従し、無ければ 3001', () => {
        assert.equal(buildMcpEnv({}, { PORT: '4000' }).EPM_API_URL, 'http://127.0.0.1:4000');
        assert.equal(buildMcpEnv({ EPM_API_URL: '' }, { PORT: '4000' }).EPM_API_URL, 'http://127.0.0.1:4000');
        assert.equal(buildMcpEnv({}, {}).EPM_API_URL, 'http://127.0.0.1:3001');
        assert.equal(buildMcpEnv({}, { PORT: 'abc' }).EPM_API_URL, 'http://127.0.0.1:3001');
    });

    test('E-13: buildMcpEnv は EPM_AUTH_TOKEN が未設定または空なら server/.env の EPM_API_TOKEN を引き継ぐ', () => {
        assert.equal(buildMcpEnv({}, { EPM_API_TOKEN: 'tok' }).EPM_AUTH_TOKEN, 'tok');
        assert.equal(buildMcpEnv({ EPM_AUTH_TOKEN: '' }, { EPM_API_TOKEN: 'tok' }).EPM_AUTH_TOKEN, 'tok');
    });

    test('E-14: buildMcpEnv は mcp/.env に EPM_AUTH_TOKEN があればそれを優先する', () => {
        assert.equal(buildMcpEnv({ EPM_AUTH_TOKEN: 'mine' }, { EPM_API_TOKEN: 'tok' }).EPM_AUTH_TOKEN, 'mine');
    });

    test('E-15: buildMcpEnv は EPM_BASIC_AUTH があればトークンを引き継がない', () => {
        const env = buildMcpEnv({ EPM_BASIC_AUTH: 'u:p' }, { EPM_API_TOKEN: 'tok' });
        assert.equal(env.EPM_BASIC_AUTH, 'u:p');
        assert.equal(env.EPM_AUTH_TOKEN, undefined);
    });

    test('E-16: buildMcpEnv は server 側にトークンが無ければ何も足さず、入力を破壊しない', () => {
        const mcpEnv = { EPM_MCP_HTTP_PORT: '3999' };
        const env = buildMcpEnv(mcpEnv, {});
        assert.equal(env.EPM_AUTH_TOKEN, undefined);
        assert.equal(env.EPM_MCP_HTTP_PORT, '3999');
        assert.deepEqual(mcpEnv, { EPM_MCP_HTTP_PORT: '3999' });
    });
});
