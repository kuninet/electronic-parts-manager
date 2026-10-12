const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

test('マイグレーションテスト (parts.part_number)', async (t) => {
  const tempDbPath = path.join(__dirname, 'temp_migration_test.sqlite');

  // 事前クリーンアップ
  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }

  // 旧スキーマ（part_number カラムなし）のDBを作成
  const oldDb = await open({
    filename: tempDbPath,
    driver: sqlite3.Database
  });

  await oldDb.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_order INTEGER DEFAULT 0
    );
    CREATE TABLE locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      image_path TEXT,
      qr_code TEXT,
      display_order INTEGER DEFAULT 0
    );
    CREATE TABLE parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category_id INTEGER,
      location_id INTEGER,
      quantity INTEGER DEFAULT 0,
      used_at DATETIME DEFAULT NULL,
      used_for TEXT,
      used_note TEXT,
      image_path TEXT,
      datasheet_url TEXT,
      datasheet_path TEXT,
      qr_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    );
  `);

  // 部品 2 件（名前・数量・QR あり）を挿入
  await oldDb.run("INSERT INTO parts (name, quantity, qr_code) VALUES ('Resistor 10k', 50, 'QR-PART-001')");
  await oldDb.run("INSERT INTO parts (name, quantity, qr_code) VALUES ('Capacitor 100uF', 20, 'QR-PART-002')");
  await oldDb.close();

  // 環境変数 DB_PATH に一時DBのパスを指定
  process.env.DB_PATH = tempDbPath;

  t.after(() => {
    delete process.env.DB_PATH;
    if (fs.existsSync(tempDbPath)) {
      try {
        fs.unlinkSync(tempDbPath);
      } catch (e) { }
    }
  });

  let databaseModule;

  await t.test('M-1: 旧スキーマDBに対してinitDbを実行するとpart_numberカラムが追加され既存データが保持されること', async () => {
    delete require.cache[require.resolve('../database')];
    databaseModule = require('../database');
    const db = await databaseModule.initDb();

    // PRAGMA table_info(parts) でカラム確認
    const columns = await db.all('PRAGMA table_info(parts)');
    const partNumberCol = columns.find(c => c.name === 'part_number');
    assert.ok(partNumberCol, 'part_number カラムが存在すること');
    assert.strictEqual(partNumberCol.type.toUpperCase(), 'TEXT');

    // 既存2件のデータ確認
    const parts = await db.all('SELECT * FROM parts ORDER BY id ASC');
    assert.strictEqual(parts.length, 2);
    assert.strictEqual(parts[0].name, 'Resistor 10k');
    assert.strictEqual(parts[0].quantity, 50);
    assert.strictEqual(parts[0].qr_code, 'QR-PART-001');
    assert.strictEqual(parts[0].part_number, null);

    assert.strictEqual(parts[1].name, 'Capacitor 100uF');
    assert.strictEqual(parts[1].quantity, 20);
    assert.strictEqual(parts[1].qr_code, 'QR-PART-002');
    assert.strictEqual(parts[1].part_number, null);
  });

  await t.test('M-2: idx_parts_part_number インデックスが作成されること', async () => {
    const db = databaseModule.getDb();
    const indexes = await db.all('PRAGMA index_list(parts)');
    const partNumberIndex = indexes.find(idx => idx.name === 'idx_parts_part_number');
    assert.ok(partNumberIndex, 'idx_parts_part_number インデックスが存在すること');
  });

  await t.test('M-3: マイグレーション済みDBに対してモジュール再読み込みでinitDbを再実行しても例外が出ず冪等であること', async () => {
    // 既存接続を閉じる
    const currentDb = databaseModule.getDb();
    await currentDb.close();

    // モジュールキャッシュを消して再初期化
    delete require.cache[require.resolve('../database')];
    const reloadedDatabaseModule = require('../database');
    const db = await reloadedDatabaseModule.initDb();

    const parts = await db.all('SELECT * FROM parts ORDER BY id ASC');
    assert.strictEqual(parts.length, 2);

    await db.close();
  });
});

test('マイグレーションテスト (storage_logs.previous_location_id)', async (t) => {
  const tempDbPath = path.join(__dirname, 'temp_migration_storage_logs_test.sqlite');

  // 事前クリーンアップ
  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }

  // 旧スキーマ（previous_location_id カラムなし）のDBを作成
  const oldDb = await open({
    filename: tempDbPath,
    driver: sqlite3.Database
  });

  await oldDb.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_order INTEGER DEFAULT 0
    );
    CREATE TABLE locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      image_path TEXT,
      qr_code TEXT,
      display_order INTEGER DEFAULT 0
    );
    CREATE TABLE parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category_id INTEGER,
      location_id INTEGER,
      quantity INTEGER DEFAULT 0,
      part_number TEXT,
      used_at DATETIME DEFAULT NULL,
      used_for TEXT,
      used_note TEXT,
      image_path TEXT,
      datasheet_url TEXT,
      datasheet_path TEXT,
      qr_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    );
    CREATE TABLE storage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      memo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(part_id) REFERENCES parts(id),
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );
  `);

  // 部品・保管場所・入庫ログを挿入
  await oldDb.run("INSERT INTO locations (id, name) VALUES (1, 'Box A'), (2, 'Box B')");
  await oldDb.run("INSERT INTO parts (id, name, location_id) VALUES (1, 'Part 1', 1), (2, 'Part 2', 2)");
  await oldDb.run("INSERT INTO storage_logs (id, part_id, location_id, memo) VALUES (1, 1, 1, 'Initial store 1')");
  await oldDb.run("INSERT INTO storage_logs (id, part_id, location_id, memo) VALUES (2, 2, 2, 'Initial store 2')");
  await oldDb.close();

  // 環境変数 DB_PATH に一時DBのパスを指定
  process.env.DB_PATH = tempDbPath;

  t.after(() => {
    delete process.env.DB_PATH;
    if (fs.existsSync(tempDbPath)) {
      try {
        fs.unlinkSync(tempDbPath);
      } catch (e) { }
    }
  });

  let databaseModule;

  await t.test('M-4: 旧スキーマDBに対してinitDbを実行するとprevious_location_idカラムが追加され既存ログが保持されること', async () => {
    delete require.cache[require.resolve('../database')];
    databaseModule = require('../database');
    const db = await databaseModule.initDb();

    // PRAGMA table_info(storage_logs) でカラム確認
    const columns = await db.all('PRAGMA table_info(storage_logs)');
    const prevLocCol = columns.find(c => c.name === 'previous_location_id');
    assert.ok(prevLocCol, 'previous_location_id カラムが存在すること');
    assert.strictEqual(prevLocCol.type.toUpperCase(), 'INTEGER');

    // 既存2件のログデータ確認
    const logs = await db.all('SELECT * FROM storage_logs ORDER BY id ASC');
    assert.strictEqual(logs.length, 2);
    assert.strictEqual(logs[0].id, 1);
    assert.strictEqual(logs[0].part_id, 1);
    assert.strictEqual(logs[0].location_id, 1);
    assert.strictEqual(logs[0].memo, 'Initial store 1');
    assert.strictEqual(logs[0].previous_location_id, null);

    assert.strictEqual(logs[1].id, 2);
    assert.strictEqual(logs[1].part_id, 2);
    assert.strictEqual(logs[1].location_id, 2);
    assert.strictEqual(logs[1].memo, 'Initial store 2');
    assert.strictEqual(logs[1].previous_location_id, null);
  });

  await t.test('M-5: マイグレーション済みDBに対してモジュール再読み込みでinitDbを再実行しても例外が出ず冪等であること', async () => {
    // 既存接続を閉じる
    const currentDb = databaseModule.getDb();
    await currentDb.close();

    // モジュールキャッシュを消して再初期化
    delete require.cache[require.resolve('../database')];
    const reloadedDatabaseModule = require('../database');
    const db = await reloadedDatabaseModule.initDb();

    const logs = await db.all('SELECT * FROM storage_logs ORDER BY id ASC');
    assert.strictEqual(logs.length, 2);

    await db.close();
  });
});

