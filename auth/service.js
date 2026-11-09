const crypto = require('node:crypto');
const { db } = require('../db');
const { fail } = require('../lib/errors');
const { check } = require('../lib/validate');

const SESSION_MS = 30 * 24 * 3600 * 1000;
const ARGON = { parallelism: 1, tagLength: 32, memory: 19456, passes: 2 }; // мінімальні параметри argon2id за рекомендацією OWASP

function hashPassword(password) {
  const nonce = crypto.randomBytes(16);
  const hash = crypto.argon2Sync('argon2id', { message: password, nonce, ...ARGON });
  return `argon2id$${nonce.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [, nonce, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.argon2Sync('argon2id', { message: password, nonce: Buffer.from(nonce, 'base64'), ...ARGON });
  return crypto.timingSafeEqual(expected, got);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha(token), userId, Date.now() + SESSION_MS);
  return token;
}

function userBySession(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.blocked FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha(token), Date.now()) || null;
}

function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

function register(input) {
  const d = check(input, {
    email: { type: 'email', max: 200 },
    password: { type: 'string', min: 8, max: 200 },
    name: { type: 'string', min: 2, max: 80 },
  });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(d.email)) fail('email_taken', 'Email already registered');
  const r = db.prepare('INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)')
    .run(d.email, hashPassword(d.password), d.name, Date.now());
  return Number(r.lastInsertRowid);
}

function login(input) {
  const d = check(input, { email: { type: 'email' }, password: { type: 'string', max: 200 } });
  const u = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(d.email);
  if (!u || !verifyPassword(d.password, u.password_hash)) fail('unauthorized', 'Wrong email or password');
  return u.id;
}

// Акаунт Google: шукаємо за google id, потім прив'язуємо за підтвердженим email, інакше створюємо новий.
function loginGoogle({ sub, email, name }) {
  const byGoogle = db.prepare('SELECT id FROM users WHERE google_id = ?').get(sub);
  if (byGoogle) return byGoogle.id;
  const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (byEmail) {
    db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(sub, byEmail.id);
    return byEmail.id;
  }
  const r = db.prepare('INSERT INTO users (email, google_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(email, sub, name || email.split('@')[0], Date.now());
  return Number(r.lastInsertRowid);
}

function profile(userId) {
  return db.prepare(`SELECT id, email, name, role, blocked, block_reason, first_name, last_name, phone, address,
    payout_card_last4, google_id IS NOT NULL AS google, created_at FROM users WHERE id = ?`).get(userId);
}

const PROFILE_FIELDS = {
  name: { type: 'string', min: 2, max: 80, optional: true },
  first_name: { type: 'string', max: 80, optional: true },
  last_name: { type: 'string', max: 80, optional: true },
  phone: { type: 'string', max: 30, pattern: /^\+?[\d\s()-]{7,20}$/, optional: true },
  address: { type: 'string', max: 300, optional: true },
};

function updateProfile(userId, input) {
  const d = check(input, PROFILE_FIELDS);
  const keys = Object.keys(d);
  if (keys.length) {
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => d[k]), userId);
  }
  return profile(userId);
}

module.exports = {
  SESSION_MS, hashPassword, verifyPassword, createSession, userBySession, logout,
  register, login, loginGoogle, profile, updateProfile,
};
