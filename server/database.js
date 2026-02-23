const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');

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
