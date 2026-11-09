const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const file = process.env.DB_FILE || path.join(__dirname, 'data', 'auction.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new DatabaseSync(file);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`);

// BEGIN IMMEDIATE одразу бере блокування на запис, тож два записи (навіть з різних процесів) йдуть по черзі.
function tx(fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Застосовує migrations/NNN_*.sql по порядку; PRAGMA user_version пам'ятає номер останньої застосованої міграції.
function migrate() {
  const dir = path.join(__dirname, 'migrations');
  const done = db.prepare('PRAGMA user_version').get().user_version;
  fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().forEach((f, i) => {
    if (i < done) return;
    tx(() => {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  });
}
migrate();

module.exports = { db, tx };
