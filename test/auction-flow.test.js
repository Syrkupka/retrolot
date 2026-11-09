const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb, fixtures } = require('./helpers');

useTempDb();
process.env.PAY_WINDOW_HOURS = '1';
const { db, user, lot, now } = fixtures();
const bids = require('../bids/service');
const payments = require('../payments/service');
const lots = require('../lots/service');

const seller = user('seller@t.test', 'seller');
const a = user('a@t.test');
const b = user('b@t.test');
const CARD = { first_name: 'Іван', last_name: 'Петренко', phone: '+380671112233', email: 'a@t.test', address: 'Одеса', card_number: '4242 4242 4242 4242', card_exp: '12/39', card_cvv: '123' };

test('lot ends by timer, winner pays once, seller sees contacts', () => {
  const id = lot(seller, { ends_at: now + 1000 });
  bids.placeBid(a, id, { amount: 100 }, null, now);
  assert.equal(payments.closeEnded(now + 2000), 1);
  assert.equal(payments.closeEnded(now + 3000), 0); // уже закрито
  const l = lots.get(id, { id: a, role: 'bidder' });
  assert.equal(l.status, 'ended');
  assert.equal(l.my_payment.status, 'pending');
  assert.throws(() => payments.pay(a, l.my_payment.id, { ...CARD, card_number: '4242 4242 4242 4241' }), { code: 'validation' });
  const paid = payments.pay(a, l.my_payment.id, CARD);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.card_last4, '4242');
  assert.equal(payments.pay(a, l.my_payment.id, CARD).status, 'paid'); // повторне надсилання нічого не ламає
  assert.equal(lots.get(id, { id: seller, role: 'seller' }).winner.phone, '+380671112233');
  assert.equal(lots.get(id, { id: b, role: 'bidder' }).winner, undefined);
});

test('unpaid lot goes to the next bidder and the non-payer is blocked', () => {
  const id = lot(seller, { ends_at: now + 1000 });
  bids.placeBid(b, id, { amount: 100 }, null, now);
  bids.placeBid(a, id, { amount: 150 }, null, now);
  payments.closeEnded(now + 2000);
  assert.equal(payments.expireUnpaid(now + 2 * 3600000), 1);
  assert.equal(db.prepare('SELECT blocked FROM users WHERE id = ?').get(a).blocked, 1);
  const p = db.prepare("SELECT user_id, amount FROM payments WHERE lot_id = ? AND status = 'pending'").get(id);
  assert.deepEqual({ ...p }, { user_id: b, amount: 100 });
  assert.throws(() => bids.placeBid(a, lot(seller), { amount: 100 }), { code: 'blocked' });
});

test('edit and withdraw only before the first bid; hidden lots look missing', () => {
  const id = lot(seller);
  assert.throws(() => lots.withdraw(a, id), { code: 'not_found' });
  db.prepare("UPDATE users SET blocked = 0 WHERE id = ?").run(a);
  bids.placeBid(a, id, { amount: 100 });
  assert.throws(() => lots.withdraw(seller, id), { code: 'edit_locked' });
  const quiet = lot(seller);
  assert.equal(lots.withdraw(seller, quiet).status, 'withdrawn');
  assert.throws(() => lots.get(quiet, { id: b, role: 'bidder' }), { code: 'not_found' });
  assert.equal(lots.get(quiet, { id: seller, role: 'seller' }).status, 'withdrawn');
});

test('catalogue filters and pages on the server', () => {
  for (let i = 0; i < 25; i++) lot(seller, { title: `Платівка ${i}`, start: 1000 + i });
  const page1 = lots.list({ q: 'Платівка', size: 10, sort: 'price_desc' }, now);
  assert.equal(page1.total, 25);
  assert.equal(page1.pages, 3);
  assert.equal(page1.items[0].current_price, 1024);
  assert.equal(lots.list({ q: 'Платівка', min: 1020 }, now).total, 5);
  assert.throws(() => lots.list({ sort: 'drop table' }), { code: 'validation' });
});

test('a leader blocked before the end is skipped right away', () => {
  const x = user('x@t.test');
  const y = user('y@t.test');
  const id = lot(seller, { ends_at: now + 1000 });
  bids.placeBid(y, id, { amount: 100 }, null, now);
  bids.placeBid(x, id, { amount: 900 }, null, now);
  db.prepare("UPDATE users SET blocked = 1, block_reason = 'unpaid' WHERE id = ?").run(x);
  payments.closeEnded(now + 2000);
  const p = db.prepare('SELECT user_id, amount FROM payments WHERE lot_id = ?').all(id);
  assert.deepEqual(p.map((r) => ({ ...r })), [{ user_id: y, amount: 100 }]);
  assert.equal(db.prepare('SELECT winner_id FROM lots WHERE id = ?').get(id).winner_id, y);
});
