const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function createTestDb() {
  const db = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  await db.run('PRAGMA foreign_keys = ON');

  await db.exec(`
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
      part_number TEXT,
      shop TEXT,
      purchased_at TEXT,
      unit_price REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      FOREIGN KEY(category_id) REFERENCES categories(id),
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );

    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0
    );

    CREATE TABLE part_tags (
      part_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (part_id, tag_id),
      FOREIGN KEY(part_id) REFERENCES parts(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE storage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      previous_location_id INTEGER DEFAULT NULL,
      memo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(part_id) REFERENCES parts(id),
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );

    CREATE TABLE ai_name_suggestions (
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

    CREATE TABLE purchase_records (
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX idx_purchase_records_dedupe ON purchase_records(shop, dedupe_key);
    CREATE INDEX idx_purchase_records_part_id ON purchase_records(part_id);
    CREATE INDEX idx_purchase_records_order ON purchase_records(shop, order_id);

    CREATE INDEX idx_ai_name_suggestions_part_id ON ai_name_suggestions(part_id);
    CREATE INDEX idx_ai_name_suggestions_status ON ai_name_suggestions(status);
  `);

  return db;
}

/**
 * テスト用ダミーJPEG画像を生成して保存
 */
async function createDummyImage(filename = 'dummy-test-part.jpg') {
  const uploadsDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const filePath = path.join(uploadsDir, filename);
  // 100x100 赤色JPEG画像を生成
  const buffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 0, b: 0 }
    }
  }).jpeg().toBuffer();

  await fs.promises.writeFile(filePath, buffer);
  return {
    filePath,
    imagePath: `/uploads/${filename}`
  };
}

module.exports = {
  createTestDb,
  createDummyImage
};
