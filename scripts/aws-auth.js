#!/usr/bin/env node

/**
 * CloudFront Basic認証（KeyValueStore）用 パスワードハッシュ化スクリプト
 * 
 * 使い方:
 * node aws-auth.js <username> <password>
 */

const crypto = require('crypto');

const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('エラー: ユーザー名とパスワードを指定してください。');
    console.error('使用方法: node scripts/aws-auth.js <username> <password>');
    process.exit(1);
}

const username = args[0];
const password = args[1];

// SHA256でハッシュ化 (ユーザー名をソルトとして追加: Issue #26)
const hash = crypto.createHash('sha256').update(username + ':' + password).digest('hex');

console.log('----------------------------------------------------');
console.log(`👤 ユーザー名: ${username}`);
console.log(`🔑 ハッシュ結果: ${hash}`);
console.log('----------------------------------------------------');
console.log('AWS CloudFront KeyValueStore に以下の「キー」と「値」を登録してください:');
console.log(` キー (Key) : ${username}`);
console.log(` 値 (Value) : ${hash}`);
console.log('----------------------------------------------------');
