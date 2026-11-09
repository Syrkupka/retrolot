const { db, tx } = require('../db');
const { fail } = require('../lib/errors');
const { check, luhn } = require('../lib/validate');
const { notify } = require('../notifications/service');

const PAY_WINDOW_MS = Number(process.env.PAY_WINDOW_HOURS || 48) * 3600000;

function get(userId, paymentId) {
  const p = db.prepare(`SELECT p.id, p.lot_id, p.amount, p.status, p.due_at, p.paid_at, p.card_last4, l.title,
    (SELECT path FROM lot_images i WHERE i.lot_id = l.id ORDER BY position LIMIT 1) AS image
    FROM payments p JOIN lots l ON l.id = p.lot_id WHERE p.id = ? AND p.user_id = ?`).get(paymentId, userId);
  if (!p) fail('not_found', 'Payment not found');
  return p;
}

/**
 * Демо-оплата: дані картки перевіряються (Луна, термін, CVV) і відкидаються; зберігаються лише останні 4 цифри.
 * UPDATE спрацьовує лише поки платіж очікує і не прострочений, тож подвійне натискання не оплатить двічі.
 */
function pay(userId, paymentId, input, now = Date.now()) {
  const d = check(input, {
    first_name: { type: 'string', min: 1, max: 80 },
    last_name: { type: 'string', min: 1, max: 80 },
    phone: { type: 'string', pattern: /^\+?[\d\s()-]{7,20}$/ },
    email: { type: 'email', max: 200 },
    address: { type: 'string', min: 3, max: 300 },
    card_number: { type: 'string', pattern: /^[\d ]{12,23}$/ },
    card_exp: { type: 'string', pattern: /^(0[1-9]|1[0-2])\/\d{2}$/ },
    card_cvv: { type: 'string', pattern: /^\d{3,4}$/ },
  });
  const card = d.card_number.replace(/\s/g, '');
  const [mm, yy] = d.card_exp.split('/').map(Number);
  const errors = [];
  if (card.length < 12 || card.length > 19 || !luhn(card)) errors.push({ field: 'card_number', rule: 'luhn' });
  if (new Date(2000 + yy, mm, 1).getTime() <= now) errors.push({ field: 'card_exp', rule: 'expired' });
  if (errors.length) fail('validation', 'Invalid input', { errors });

  return tx(() => {
    const p = db.prepare('SELECT p.*, l.title, l.seller_id FROM payments p JOIN lots l ON l.id = p.lot_id WHERE p.id = ? AND p.user_id = ?').get(paymentId, userId);
    if (!p) fail('not_found', 'Payment not found');
    if (p.status === 'paid') return get(userId, paymentId); // повторне надсилання: той самий результат, без другого списання
    const r = db.prepare(`UPDATE payments SET status = 'paid', paid_at = ?, card_last4 = ?, first_name = ?, last_name = ?,
      phone = ?, email = ?, address = ? WHERE id = ? AND status = 'pending' AND due_at > ?`)
      .run(now, card.slice(-4), d.first_name, d.last_name, d.phone, d.email, d.address, paymentId, now);
    if (r.changes === 0) fail('payment_closed', 'The payment deadline has passed');
    notify(userId, p.lot_id, 'receipt', { title: p.title, amount: p.amount, last4: card.slice(-4) });
    notify(p.seller_id, p.lot_id, 'paid', { title: p.title, amount: p.amount });
    return get(userId, paymentId);
  });
}

function openPayment(lot, userId, amount, now) {
  const due = now + PAY_WINDOW_MS;
  db.prepare('INSERT INTO payments (lot_id, user_id, amount, due_at, created_at) VALUES (?, ?, ?, ?, ?)').run(lot.id, userId, amount, due, now);
  db.prepare('UPDATE lots SET winner_id = ? WHERE id = ?').run(userId, lot.id);
  notify(userId, lot.id, 'won', { title: lot.title, amount, due });
}

// Пропонує лот учаснику з найвищою ставкою, який не заблокований і ще не мав платежу за цей лот,
// за його власною найкращою ставкою. Повертає false, якщо нікого не лишилось.
function offerToNext(lot, now) {
  const next = db.prepare(`
    SELECT b.user_id, MAX(b.amount) amount FROM bids b JOIN users u ON u.id = b.user_id
    WHERE b.lot_id = ? AND u.blocked = 0
      AND b.user_id NOT IN (SELECT user_id FROM payments WHERE lot_id = ?)
    GROUP BY b.user_id ORDER BY amount DESC, MIN(b.id) ASC LIMIT 1`).get(lot.id, lot.id);
  if (!next) {
    db.prepare('UPDATE lots SET winner_id = NULL WHERE id = ?').run(lot.id);
    notify(lot.seller_id, lot.id, 'no_bids', { title: lot.title });
    return false;
  }
  openPayment(lot, next.user_id, next.amount, now);
  notify(lot.seller_id, lot.id, 'sold', { title: lot.title, amount: next.amount });
  return true;
}

// Закриває всі лоти, час яких вийшов. Запускається таймером, тож лот завершується, навіть якщо сторінку ніхто не відкрив.
// Лідера, якого тим часом заблокували, пропускаємо одразу, а не чекаємо на нього весь термін оплати.
function closeEnded(now = Date.now()) {
  const due = db.prepare("SELECT id FROM lots WHERE status = 'active' AND ends_at <= ?").all(now);
  for (const { id } of due) {
    tx(() => {
      const r = db.prepare("UPDATE lots SET status = 'ended' WHERE id = ? AND status = 'active' AND ends_at <= ?").run(id, now);
      if (r.changes === 0) return; // інший процес уже закрив цей лот
      offerToNext(db.prepare('SELECT * FROM lots WHERE id = ?').get(id), now);
    });
  }
  return due.length;
}

// Не оплатив вчасно: блокуємо покупця і пропонуємо лот наступному учаснику за його власною найвищою ставкою.
function expireUnpaid(now = Date.now()) {
  const due = db.prepare("SELECT id FROM payments WHERE status = 'pending' AND due_at <= ?").all(now);
  for (const { id } of due) {
    tx(() => {
      const r = db.prepare("UPDATE payments SET status = 'expired' WHERE id = ? AND status = 'pending'").run(id);
      if (r.changes === 0) return;
      const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
      const lot = db.prepare('SELECT * FROM lots WHERE id = ?').get(p.lot_id);
      db.prepare("UPDATE users SET blocked = 1, block_reason = 'unpaid' WHERE id = ? AND role <> 'admin'").run(p.user_id);
      notify(p.user_id, lot.id, 'payment_expired', { title: lot.title });
      offerToNext(lot, now);
    });
  }
  return due.length;
}

module.exports = { get, pay, closeEnded, expireUnpaid, PAY_WINDOW_MS };
