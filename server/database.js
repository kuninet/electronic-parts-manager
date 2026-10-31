const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'database.sqlite');

let db;

async function initDb() {
  if (db) return db;

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.run('PRAGMA foreign_keys = ON');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      image_path TEXT,
      display_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS parts (
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      FOREIGN KEY(category_id) REFERENCES categories(id),
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS part_tags (
      part_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (part_id, tag_id),
      FOREIGN KEY(part_id) REFERENCES parts(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

  // 入庫ログテーブル（保管場所にしまった記録）
  // 旧テーブルにbox_idがある場合はDROP+再作成（データは少量なので問題なし）
  try {
    const cols = await db.all('PRAGMA table_info(storage_logs)');
    if (cols.length > 0 && cols.some(c => c.name === 'box_id')) {
      await db.exec('DROP TABLE storage_logs');
    }
  } catch (e) { }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS storage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      previous_location_id INTEGER DEFAULT NULL,
      memo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(part_id) REFERENCES parts(id),
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );
  `);

  // Migration: Add deleted_at column if not exists
  try {
    await db.run('ALTER TABLE parts ADD COLUMN deleted_at DATETIME DEFAULT NULL');
  } catch (e) { }

  // Migration: Add image_path to locations if not exists
  try {
    await db.run('ALTER TABLE locations ADD COLUMN image_path TEXT');
  } catch (e) { }

  // Migration: Add display_order to categories, locations, tags
  try {
    await db.run('ALTER TABLE categories ADD COLUMN display_order INTEGER DEFAULT 0');
  } catch (e) { }
  try {
    await db.run('ALTER TABLE locations ADD COLUMN display_order INTEGER DEFAULT 0');
  } catch (e) { }
  try {
    await db.run('ALTER TABLE tags ADD COLUMN display_order INTEGER DEFAULT 0');
  } catch (e) { }

  // Migration: locationsテーブルにQRコードカラム追加
  try {
    await db.run('ALTER TABLE locations ADD COLUMN qr_code TEXT');
  } catch (e) { }
  try {
    await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_qr_code ON locations(qr_code) WHERE qr_code IS NOT NULL');
  } catch (e) { }

  // Migration: partsテーブルにQRコードカラム追加
  try {
    await db.run('ALTER TABLE parts ADD COLUMN qr_code TEXT');
  } catch (e) { }
  try {
    await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_qr_code ON parts(qr_code) WHERE qr_code IS NOT NULL');
  } catch (e) { }

  // Migration: partsテーブルに使用済み管理カラム追加
  try {
    await db.run('ALTER TABLE parts ADD COLUMN used_at DATETIME DEFAULT NULL');
  } catch (e) { }
  try {
    await db.run('ALTER TABLE parts ADD COLUMN used_for TEXT');
  } catch (e) { }
  try {
    await db.run('ALTER TABLE parts ADD COLUMN used_note TEXT');
  } catch (e) { }

  // Migration: partsテーブルに型番カラム追加
  try {
    await db.run('ALTER TABLE parts ADD COLUMN part_number TEXT');
  } catch (e) { }
  try {
    await db.run('CREATE INDEX IF NOT EXISTS idx_parts_part_number ON parts(part_number)');
  } catch (e) { }

  // Migration: partsテーブルに購入情報カラム追加 (#97)
  try { await db.run('ALTER TABLE parts ADD COLUMN shop TEXT'); } catch (e) { }
  try { await db.run('ALTER TABLE parts ADD COLUMN purchased_at TEXT'); } catch (e) { }   // 'YYYY-MM-DD'
  try { await db.run('ALTER TABLE parts ADD COLUMN unit_price REAL'); } catch (e) { }

  // Migration: storage_logs.previous_location_id（「戻す」で元の保管場所に戻すため。外部キーは付けない）
  try {
    await db.run('ALTER TABLE storage_logs ADD COLUMN previous_location_id INTEGER DEFAULT NULL');
  } catch (e) { }

  // Migration: AI部品名判定候補テーブル作成
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_name_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL,
      model TEXT,
      image_path TEXT,
      suggested_name TEXT,
      part_number TEXT,
      manufacturer TEXT,
      package TEXT,
      category_hint TEXT,
      markings TEXT,
      description TEXT,
      confidence REAL,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(part_id) REFERENCES parts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_name_suggestions_part_id ON ai_name_suggestions(part_id);
    CREATE INDEX IF NOT EXISTS idx_ai_name_suggestions_status ON ai_name_suggestions(status);
  `);

  // Migration: 購入履歴テーブル作成 (#99)
  // part_id には外部キーを付けない（部品の完全削除時に permanentlyDeleteParts が明示的に NULL へ戻す）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop TEXT NOT NULL,
      order_id TEXT,
      line_no INTEGER,
      purchased_at TEXT,
      code TEXT,
      name TEXT NOT NULL,
      unit_price REAL,
      currency TEXT NOT NULL DEFAULT 'JPY',
      quantity INTEGER,
      part_id INTEGER,
      source_msg_id TEXT,
      note TEXT,
      dedupe_key TEXT NOT NULL,
      import_batch_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_records_dedupe ON purchase_records(shop, dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_purchase_records_part_id ON purchase_records(part_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_records_order ON purchase_records(shop, order_id);
    CREATE TABLE IF NOT EXISTS purchase_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      note TEXT,
      on_duplicate TEXT NOT NULL,
      total INTEGER NOT NULL,
      created_count INTEGER NOT NULL,
      updated_count INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL,
      error_count INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      undone_at DATETIME DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS purchase_import_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      record_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_import_changes_batch ON purchase_import_changes(batch_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_import_changes_record ON purchase_import_changes(record_id);
  `);
  // 先に作られた purchase_records には import_batch_id がないため追加する
  try { await db.run('ALTER TABLE purchase_records ADD COLUMN import_batch_id INTEGER'); } catch (e) { }

  // Seed some initial data if empty
  const categories = await db.all('SELECT * FROM categories');
  if (categories.length === 0) {
    await db.run(`INSERT INTO categories (name) VALUES ('Resistors'), ('Capacitors'), ('ICs'), ('Connectors')`);
  }

  const locations = await db.all('SELECT * FROM locations');
  if (locations.length === 0) {
    await db.run(`INSERT INTO locations (name, description) VALUES ('Box A', 'Red huge box'), ('Box B', 'Blue small box')`);
  }

  console.log('Database initialized');
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

module.exports = {
  initDb,
  getDb
};
