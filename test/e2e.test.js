// Наскрізний тест через HTTP: реєстрація, продавець створює лот, адмін схвалює, учасник ставить, таймер закриває, переможець платить.
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb } = require('./helpers');

useTempDb();
const { db } = require('../db');
const { createApp } = require('../server');
const auth = require('../auth/service');
const payments = require('../payments/service');

// PNG розміром 1x1
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function client(base) {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, type: res.headers.get('content-type'), id: res.headers.get('x-request-id'), body: text ? JSON.parse(text) : null };
  };
}

test('full auction scenario', async (t) => {
  db.prepare("INSERT INTO categories (name_uk, name_en) VALUES ('Книги', 'Books')").run();
  db.prepare("INSERT INTO users (email, password_hash, name, role, created_at) VALUES ('admin@t.test', ?, 'Admin', 'admin', 0)").run(auth.hashPassword('admin12345'));
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const seller = client(base), bidder = client(base), admin = client(base), guest = client(base);

  const health = await guest('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.ok(health.id);

  assert.equal((await seller('POST', '/api/auth/register', { email: 's@t.test', password: 'password1', name: 'Seller' })).status, 201);
  assert.equal((await bidder('POST', '/api/auth/register', { email: 'b@t.test', password: 'password1', name: 'Bidder' })).status, 201);
  assert.equal((await admin('POST', '/api/auth/login', { email: 'admin@t.test', password: 'admin12345' })).status, 200);
  const dup = await guest('POST', '/api/auth/register', { email: 's@t.test', password: 'password1', name: 'XX' });
  assert.equal(dup.status, 409);
  assert.match(dup.type, /application\/problem\+json/);
  assert.equal(dup.body.type, '/problems/email_taken');

  const now = Date.now();
  const bad = await seller('POST', '/api/lots', { title: 'x' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.length > 0);

  const created = await seller('POST', '/api/lots', {
    title: 'Кобзар 1960', description: 'Гарний стан, тверда обкладинка', category_id: 1, start_price: 200, min_step: 20,
    starts_at: now, ends_at: now + 15 * 60000, tags: ['книги'], images: [PNG, PNG, PNG],
    seller: { first_name: 'Ольга', last_name: 'Коваль', phone: '+380501234567', address: 'Київ', card_number: '4242424242424242' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;

  assert.equal((await guest('GET', `/api/lots/${id}`)).status, 404); // лоти на модерації не видно
  assert.equal((await bidder('GET', '/api/admin/lots')).status, 404); // адмінське API приховане від не-адмінів
  assert.equal((await admin('POST', `/api/admin/lots/${id}/moderate`, { decision: 'approve' })).status, 200);

  const list = await guest('GET', '/api/lots?q=Кобзар');
  assert.equal(list.body.total, 1);

  assert.equal((await guest('POST', `/api/lots/${id}/bids`, { amount: 200 })).status, 401);
  const key = { 'Idempotency-Key': 'e2e-key-0001' };
  assert.equal((await bidder('POST', `/api/lots/${id}/bids`, { amount: 200 }, key)).status, 201);
  assert.equal((await bidder('POST', `/api/lots/${id}/bids`, { amount: 200 }, key)).status, 200); // повтор того самого запиту
  const low = await seller('POST', `/api/lots/${id}/bids`, { amount: 500 });
  assert.equal(low.status, 403); // свій лот

  const editLocked = await seller('PUT', `/api/lots/${id}`, { title: 'Новий', description: 'Новий опис лота', category_id: 1, start_price: 1, min_step: 1, starts_at: now, ends_at: now + 3600000 });
  assert.equal(editLocked.status, 409);

  payments.closeEnded(now + 16 * 60000);
  const lot = await bidder('GET', `/api/lots/${id}`);
  assert.equal(lot.body.status, 'ended');
  const pay = await bidder('POST', `/api/payments/${lot.body.my_payment.id}/pay`, {
    first_name: 'Борис', last_name: 'Бідер', phone: '+380671234567', email: 'b@t.test', address: 'Львів',
    card_number: '4242424242424242', card_exp: '12/39', card_cvv: '123',
  });
  assert.equal(pay.status, 200);
  assert.equal((await seller('GET', `/api/lots/${id}`)).body.winner.address, 'Львів');
  assert.equal((await seller('GET', `/api/payments/${lot.body.my_payment.id}`)).status, 404); // чужий платіж

  const notes = await bidder('GET', '/api/notifications');
  assert.ok(notes.body.items.some((n) => n.type === 'won'));
});
