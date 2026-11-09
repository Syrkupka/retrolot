const { db, tx } = require('../db');
const { fail } = require('../lib/errors');
const { check } = require('../lib/validate');
const { notify } = require('../notifications/service');

const PAGE = { page: { type: 'int', min: 1, optional: true }, size: { type: 'int', min: 1, max: 60, optional: true } };

function pendingLots(query) {
  const d = check(query, PAGE);
  const page = d.page || 1, size = d.size || 20;
  const total = db.prepare("SELECT COUNT(*) n FROM lots WHERE status = 'pending'").get().n;
  const items = db.prepare(`SELECT l.id, l.title, l.start_price, l.starts_at, l.ends_at, l.created_at, u.email AS seller_email,
    (SELECT path FROM lot_images i WHERE i.lot_id = l.id ORDER BY position LIMIT 1) AS image
    FROM lots l JOIN users u ON u.id = l.seller_id WHERE l.status = 'pending' ORDER BY l.created_at LIMIT ? OFFSET ?`)
    .all(size, (page - 1) * size);
  return { items, total, page, pages: Math.ceil(total / size) };
}

function moderate(lotId, input) {
  const d = check(input, { decision: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string', max: 500, optional: true } });
  return tx(() => {
    const status = d.decision === 'approve' ? 'active' : 'rejected';
    const r = db.prepare("UPDATE lots SET status = ?, admin_note = ? WHERE id = ? AND status = 'pending'").run(status, d.note ?? null, lotId);
    if (r.changes === 0) fail('conflict', 'Lot is not waiting for moderation');
    const lot = db.prepare('SELECT seller_id, title FROM lots WHERE id = ?').get(lotId);
    notify(lot.seller_id, lotId, d.decision === 'approve' ? 'approved' : 'rejected', { title: lot.title, note: d.note });
    return { id: lotId, status };
  });
}

// Скасування торгів не видаляє ставки (історія незмінна); сповіщення отримують усі учасники й продавець.
function cancel(lotId, input) {
  const d = check(input, { note: { type: 'string', min: 3, max: 500 } });
  return tx(() => {
    const r = db.prepare("UPDATE lots SET status = 'cancelled', admin_note = ? WHERE id = ? AND status IN ('active', 'ended')").run(d.note, lotId);
    if (r.changes === 0) fail('conflict', 'Only active or ended lots can be cancelled');
    db.prepare("UPDATE payments SET status = 'expired' WHERE lot_id = ? AND status = 'pending'").run(lotId);
    const lot = db.prepare('SELECT seller_id, title FROM lots WHERE id = ?').get(lotId);
    const users = new Set([lot.seller_id, ...db.prepare('SELECT DISTINCT user_id FROM bids WHERE lot_id = ?').all(lotId).map((r) => r.user_id)]);
    for (const u of users) notify(u, lotId, 'cancelled', { title: lot.title, note: d.note });
    return { id: lotId, status: 'cancelled' };
  });
}

function users(query) {
  const d = check(query, { q: { type: 'string', max: 100, optional: true }, blocked: { type: 'string', enum: ['1', '0'], optional: true }, ...PAGE });
  const where = ['1 = 1'];
  const p = [];
  if (d.q) { where.push('(email LIKE ? OR name LIKE ?)'); p.push(`%${d.q}%`, `%${d.q}%`); }
  if (d.blocked) { where.push('blocked = ?'); p.push(Number(d.blocked)); }
  const page = d.page || 1, size = d.size || 20;
  const total = db.prepare(`SELECT COUNT(*) n FROM users WHERE ${where.join(' AND ')}`).get(...p).n;
  const items = db.prepare(`SELECT id, email, name, role, blocked, block_reason, created_at FROM users
    WHERE ${where.join(' AND ')} ORDER BY blocked DESC, id LIMIT ? OFFSET ?`).all(...p, size, (page - 1) * size);
  return { items, total, page, pages: Math.ceil(total / size) };
}

function setBlocked(adminId, userId, input) {
  const d = check(input, { blocked: { type: 'bool' }, reason: { type: 'string', max: 200, optional: true } });
  if (adminId === userId) fail('conflict', 'You cannot block yourself');
  const r = db.prepare("UPDATE users SET blocked = ?, block_reason = ? WHERE id = ? AND role <> 'admin'")
    .run(d.blocked ? 1 : 0, d.blocked ? d.reason || 'admin' : null, userId);
  if (r.changes === 0) fail('not_found', 'User not found');
  if (!d.blocked) notify(userId, null, 'unblocked');
  return { id: userId, blocked: d.blocked };
}

module.exports = { pendingLots, moderate, cancel, users, setBlocked };
