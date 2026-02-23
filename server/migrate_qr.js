#!/usr/bin/env node
/**
 * QRコード入出庫管理 DBマイグレーションツール
 * 
 * 既存の稼働中DBに以下を追加します:
 * - locations テーブルに qr_code カラム追加
 * - storage_logs テーブル（入庫ログ）
 * - parts テーブルに qr_code カラム追加
 * 
 * 使い方:
 *   node migrate_qr.js
 *   node migrate_qr.js --db /path/to/database.sqlite
 */

const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

// コマンドライン引数からDBパスを取得（デフォルト: ./database.sqlite）
const args = process.argv.slice(2);
let dbPath = path.resolve(__dirname, 'database.sqlite');
const dbArgIndex = args.indexOf('--db');
if (dbArgIndex !== -1 && args[dbArgIndex + 1]) {
    dbPath = path.resolve(args[dbArgIndex + 1]);
}

async function migrate() {
    console.log('=== QRコード入出庫管理 DBマイグレーション ===');
    console.log(`対象DB: ${dbPath}`);
    console.log('');

    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.run('PRAGMA foreign_keys = ON');

    const results = [];

    // 1. storage_logs テーブル: 旧box_id→location_idへの移行
    try {
        const cols = await db.all('PRAGMA table_info(storage_logs)');
        if (cols.length > 0 && cols.some(c => c.name === 'box_id')) {
            // 旧テーブル（box_id）を削除して再作成
            await db.exec('DROP TABLE storage_logs');
            results.push({ item: 'storage_logs テーブル (旧)', status: '✅ 削除', detail: 'box_id版を削除' });
        }
    } catch (e) {
        results.push({ item: 'storage_logs テーブル (旧)', status: '⚠️ スキップ', detail: e.message });
    }

    try {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS storage_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                part_id INTEGER NOT NULL,
                location_id INTEGER NOT NULL,
                memo TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(part_id) REFERENCES parts(id),
                FOREIGN KEY(location_id) REFERENCES locations(id)
            );
        `);
        const logCount = await db.get('SELECT COUNT(*) as count FROM storage_logs');
        results.push({ item: 'storage_logs テーブル', status: '✅ OK', detail: `${logCount.count} 件のレコード` });
    } catch (e) {
        results.push({ item: 'storage_logs テーブル', status: '❌ エラー', detail: e.message });
    }

    // 2. boxesテーブルが存在すれば削除（統合済み）
    try {
        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='boxes'");
        if (tables.length > 0) {
            await db.exec('DROP TABLE boxes');
            results.push({ item: 'boxes テーブル', status: '✅ 削除', detail: 'locationsに統合済み' });
        } else {
            results.push({ item: 'boxes テーブル', status: '✅ OK', detail: '存在しない（正常）' });
        }
    } catch (e) {
        results.push({ item: 'boxes テーブル', status: '❌ エラー', detail: e.message });
    }

    // 2. locations テーブルに qr_code カラム追加
    try {
        const columns = await db.all('PRAGMA table_info(locations)');
        const hasQrCode = columns.some(c => c.name === 'qr_code');

        if (!hasQrCode) {
            await db.run('ALTER TABLE locations ADD COLUMN qr_code TEXT');
            results.push({ item: 'locations.qr_code カラム', status: '✅ 追加', detail: '新規追加' });
        } else {
            results.push({ item: 'locations.qr_code カラム', status: '✅ OK', detail: '既に存在' });
        }
    } catch (e) {
        results.push({ item: 'locations.qr_code カラム', status: '❌ エラー', detail: e.message });
    }

    // 3. locations qr_code のユニークインデックス
    try {
        await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_qr_code ON locations(qr_code) WHERE qr_code IS NOT NULL');
        results.push({ item: 'locations.qr_code インデックス', status: '✅ OK', detail: 'UNIQUE INDEX' });
    } catch (e) {
        results.push({ item: 'locations.qr_code インデックス', status: '❌ エラー', detail: e.message });
    }

    // 4. parts テーブルに qr_code カラム追加
    try {
        const columns = await db.all('PRAGMA table_info(parts)');
        const hasQrCode = columns.some(c => c.name === 'qr_code');

        if (!hasQrCode) {
            await db.run('ALTER TABLE parts ADD COLUMN qr_code TEXT');
            results.push({ item: 'parts.qr_code カラム', status: '✅ 追加', detail: '新規追加' });
        } else {
            results.push({ item: 'parts.qr_code カラム', status: '✅ OK', detail: '既に存在' });
        }
    } catch (e) {
        results.push({ item: 'parts.qr_code カラム', status: '❌ エラー', detail: e.message });
    }

    // 5. parts qr_code のユニークインデックス
    try {
        await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_qr_code ON parts(qr_code) WHERE qr_code IS NOT NULL');
        results.push({ item: 'parts.qr_code インデックス', status: '✅ OK', detail: 'UNIQUE INDEX' });
    } catch (e) {
        results.push({ item: 'parts.qr_code インデックス', status: '❌ エラー', detail: e.message });
    }

    // 結果表示
    console.log('--- マイグレーション結果 ---');
    console.log('');
    for (const r of results) {
        console.log(`  ${r.status} ${r.item} (${r.detail})`);
    }
    console.log('');

    const hasError = results.some(r => r.status.includes('❌'));
    if (hasError) {
        console.log('⚠️  一部エラーが発生しました。上記を確認してください。');
    } else {
        console.log('🎉 マイグレーション完了！');
    }

    await db.close();
}

migrate().catch(err => {
    console.error('マイグレーション失敗:', err);
    process.exit(1);
});
