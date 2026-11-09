// Спільні тестові дані. Кожен файл тестів працює у своєму процесі (node --test), тож має свою базу.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

function useTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retrolot-'));
  process.env.DB_FILE = path.join(dir, 'test.db');
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  return process.env.DB_FILE;
}

function fixtures() {
  const { db } = require('../db');
  const now = Date.now();
  db.prepare("INSERT INTO categories (name_uk, name_en) VALUES ('Годинники', 'Watches')").run();
  const user = (email, role = 'bidder') => Number(db.prepare(
    'INSERT INTO users (email, password_hash, name, role, created_at) VALUES (?, NULL, ?, ?, ?)',
  ).run(email, email.split('@')[0], role, now).lastInsertRowid);
  const lot = (sellerId, o = {}) => Number(db.prepare(`
    INSERT INTO lots (seller_id, category_id, title, description, start_price, min_step, current_price, starts_at, ends_at, status, created_at)
    VALUES (?, 1, ?, 'Опис лота для тесту', ?, ?, ?, ?, ?, ?, ?)`).run(
    sellerId, o.title || 'Годинник', o.start ?? 100, o.step ?? 10, o.start ?? 100,
    o.starts_at ?? now - 60000, o.ends_at ?? now + 3600000, o.status || 'active', now,
  ).lastInsertRowid);
  return { db, user, lot, now };
}

module.exports = { useTempDb, fixtures };
