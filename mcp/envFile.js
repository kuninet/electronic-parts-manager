/**
 * .env ファイルパーサーモジュール
 * ecosystem.config.js が mcp/.env と server/.env を読み込むために使う、依存なしの純関数を提供します。
 * 仕様は scripts/lib/epm-common.ps1 の Read-DotEnvValue に揃えています。
 */

const fs = require('node:fs');

/**
 * .env 形式のテキストを解析してキーと値のオブジェクトを返します。
 *
 * - 空行と # で始まる行は無視
 * - KEY=VALUE 形式（= の前後の空白は許容）。KEY は英数字とアンダースコアのみ
 * - VALUE の両端が同じ引用符（" または '）なら 1 組だけ外す
 * - 同じキーが複数あれば最初の値を採用
 *
 * @param {string} text .env ファイルの内容
 * @returns {Record<string, string>}
 */
function parseEnvFile(text) {
    const result = {};
    const source = String(text).replace(/^﻿/, '');

    for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
        if (!match) {
            continue;
        }

        const key = match[1];
        if (Object.prototype.hasOwnProperty.call(result, key)) {
            continue;
        }

        let value = match[2].trim();
        if (value.length >= 2) {
            const first = value[0];
            if ((first === '"' || first === "'") && value[value.length - 1] === first) {
                value = value.slice(1, -1);
            }
        }
        result[key] = value;
    }

    return result;
}

/**
 * .env ファイルを読み込んで解析します。ファイルが存在しなければ空オブジェクトを返します。
 * 読み取りに失敗した場合（ディレクトリである、権限が無い等）は例外を投げず、stderr に出力して空オブジェクトを返します。
 * ecosystem.config.js から呼ばれるため、ここで例外を出すと PM2 の起動自体が失敗するのを避けるためです。
 *
 * @param {string} filePath .env ファイルのパス
 * @returns {Record<string, string>}
 */
function readEnvFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return {};
        }
        return parseEnvFile(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.error(`[epm-mcp] failed to read env file '${filePath}': ${err.message}`);
        return {};
    }
}

/**
 * PM2 の epm-mcp に渡す環境変数を組み立てます。
 *
 * - EPM_API_URL: mcp/.env の値（空でないもの）が最優先。無ければ server/.env の PORT（数字のみ有効）に追従し、
 *   それも無ければ http://127.0.0.1:3001
 * - 認証: mcp/.env に EPM_AUTH_TOKEN も EPM_BASIC_AUTH も無い（空を含む）場合に限り、
 *   server/.env の EPM_API_TOKEN を EPM_AUTH_TOKEN として引き継ぐ
 *
 * @param {Record<string, string>} mcpEnv mcp/.env の内容
 * @param {Record<string, string>} serverEnv server/.env の内容
 * @returns {Record<string, string>}
 */
function buildMcpEnv(mcpEnv, serverEnv) {
    const apiPort = /^\d+$/.test(serverEnv.PORT || '') ? serverEnv.PORT : '3001';
    const env = { ...mcpEnv };
    if (!env.EPM_API_URL) {
        env.EPM_API_URL = `http://127.0.0.1:${apiPort}`;
    }
    if (!env.EPM_AUTH_TOKEN && !env.EPM_BASIC_AUTH && serverEnv.EPM_API_TOKEN) {
        env.EPM_AUTH_TOKEN = serverEnv.EPM_API_TOKEN;
    }
    return env;
}

module.exports = {
    parseEnvFile,
    readEnvFile,
    buildMcpEnv,
};
