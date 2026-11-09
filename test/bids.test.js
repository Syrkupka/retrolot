const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { useTempDb, fixtures } = require('./helpers');

useTempDb();
const { db, user, lot, now } = fixtures();
const bids = require('../bids/service');

const seller = user('seller@t.test', 'seller');
const [a, b, c] = ['a@t.test', 'b@t.test', 'c@t.test'].map((e) => user(e));

test('first bid must reach the start price, next ones the minimum step', () => {
  const id = lot(seller, { start: 100, step: 10 });
  assert.throws(() => bids.placeBid(a, id, { amount: 99 }), { code: 'bid_too_low' });
  assert.equal(bids.placeBid(a, id, { amount: 100 }).leading, true);
  assert.throws(() => bids.placeBid(b, id, { amount: 109 }), { code: 'bid_too_low' });
  assert.equal(bids.placeBid(b, id, { amount: 110 }).leading, true);
});

test('equal bids: the second one is rejected', () => {
  const id = lot(seller);
  bids.placeBid(a, id, { amount: 150 });
  assert.throws(() => bids.placeBid(b, id, { amount: 150 }), { code: 'bid_too_low' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bids WHERE lot_id = ?').get(id).n, 1);
});

test('seller cannot bid, closed and upcoming lots refuse bids', () => {
  assert.throws(() => bids.placeBid(seller, lot(seller), { amount: 100 }), { code: 'forbidden' });
  assert.throws(() => bids.placeBid(a, lot(seller, { ends_at: now - 1000, starts_at: now - 5000 }), { amount: 100 }), { code: 'lot_closed' });
  assert.throws(() => bids.placeBid(a, lot(seller, { starts_at: now + 60000 }), { amount: 100 }), { code: 'lot_closed' });
  assert.throws(() => bids.placeBid(a, lot(seller, { status: 'pending' }), { amount: 100 }), { code: 'not_found' });
});

test('same Idempotency-Key does not create a second bid', () => {
  const id = lot(seller);
  const first = bids.placeBid(a, id, { amount: 100 }, 'key-12345678');
  const again = bids.placeBid(a, id, { amount: 100 }, 'key-12345678');
  assert.equal(first.replay, false);
  assert.equal(again.replay, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bids WHERE lot_id = ?').get(id).n, 1);
});

test('auto-bid defends the leader up to its limit', () => {
  const id = lot(seller, { start: 100, step: 10 });
  bids.placeBid(a, id, { amount: 100, auto_max: 300 });
  const r = bids.placeBid(b, id, { amount: 200 });
  assert.equal(r.leading, false);
  assert.equal(r.current_price, 210);
  const l = db.prepare('SELECT leader_id FROM lots WHERE id = ?').get(id);
  assert.equal(l.leader_id, a);
  // чи отримав b сповіщення про перебиття? Ні: b дізнався з відповіді. a лишився лідером, тож сповіщень немає.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE lot_id = ? AND type = 'outbid'").get(id).n, 0);
});

test('two auto-bids: higher limit wins one step above the other', () => {
  const id = lot(seller, { start: 100, step: 10 });
  bids.placeBid(a, id, { amount: 100, auto_max: 300 });
  const r = bids.placeBid(b, id, { amount: 110, auto_max: 500 });
  assert.equal(r.leading, true);
  assert.equal(r.current_price, 310);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE lot_id = ? AND type = 'outbid' AND user_id = ?").get(id, a).n, 1);
});

test('three auto-bids settle without looping forever', () => {
  const id = lot(seller, { start: 100, step: 10 });
  bids.placeBid(a, id, { amount: 100, auto_max: 200 });
  bids.placeBid(b, id, { amount: 110, auto_max: 400 });
  const r = bids.placeBid(c, id, { amount: 220, auto_max: 300 });
  assert.equal(r.leading, false);
  assert.equal(r.leader_id, b);
  assert.equal(r.current_price, 310);
});

test('bid history is immutable', () => {
  assert.throws(() => db.prepare('UPDATE bids SET amount = 1').run(), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM bids').run(), /immutable/);
});

test('concurrent equal bids from separate processes: exactly one wins', async () => {
  const id = lot(seller, { start: 100, step: 10 });
  const users = Array.from({ length: 8 }, (_, i) => user(`race${i}@t.test`));
  const startAt = Date.now() + 1500;
  const run = (u) => new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(__dirname, 'bid-worker.js'), u, id, 500, startAt], { env: process.env },
      (err, out) => (err ? reject(err) : resolve(JSON.parse(out))));
  });
  const results = await Promise.all(users.map(run));
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'bid_too_low'));
  const row = db.prepare('SELECT current_price, bid_count FROM lots WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { current_price: 500, bid_count: 1 });
});

test('one bid cannot jump more than 10x the next minimum', () => {
  const id = lot(seller, { start: 100, step: 10 });
  assert.throws(() => bids.placeBid(a, id, { amount: 1001 }), (e) => e.code === 'validation' && e.extra.max_bid === 1000);
  assert.equal(bids.placeBid(a, id, { amount: 1000 }).leading, true);
  assert.throws(() => bids.placeBid(b, id, { amount: 1e9 }), { code: 'validation' });
});
