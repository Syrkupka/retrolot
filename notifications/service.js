const { db } = require('../db');

// Сповіщення записуються в тій самій транзакції, що й дія; листи надсилає пізніше фоновий процес (server.js, startJobs),
// тож збій пошти ніколи не скасує ставку чи оплату.
function notify(userId, lotId, type, data = {}) {
  db.prepare('INSERT INTO notifications (user_id, lot_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, lotId, type, JSON.stringify(data), Date.now());
}

function list(userId, { page = 1, size = 20 } = {}) {
  const total = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ?').get(userId).n;
  const items = db.prepare(`
    SELECT n.id, n.lot_id, n.type, n.data, n.is_read, n.created_at, l.title AS lot_title
    FROM notifications n LEFT JOIN lots l ON l.id = n.lot_id
    WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`)
    .all(userId, size, (page - 1) * size)
    .map((n) => ({ ...n, data: JSON.parse(n.data) }));
  const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).n;
  return { items, total, page, pages: Math.ceil(total / size), unread };
}

function markRead(userId) {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
}

module.exports = { notify, list, markRead };
