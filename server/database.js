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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT
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
      FOREIGN KEY(category_id) REFERENCES categories(id),
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS part_tags (
      part_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (part_id, tag_id),
      FOREIGN KEY(part_id) REFERENCES parts(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

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
