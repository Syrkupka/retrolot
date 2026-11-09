// Заповнює базу демо-даними: 8 категорій, 50 користувачів, 200 лотів, 1500 ставок.
// Запуск: npm run seed  (не чіпає непорожню базу без параметра --reset)
const fs = require('node:fs');
const path = require('node:path');

const file = process.env.DB_FILE || path.join(__dirname, 'data', 'auction.db');
if (process.argv.includes('--reset')) for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });

const { db, tx } = require('./db');
const { hashPassword } = require('./auth/service');
const { describe } = require('./seed-texts');

if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
  console.error('Database is not empty. Run with --reset to recreate it.');
  process.exit(1);
}

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// [назва українською, англійською, [[річ, скільки в неї фото], ...]]
const CATS = [
  ['Фотоапарати', 'Cameras', [['Плівкова камера Зеніт-E', 3], ['Фотоапарат ФЕД-5', 3], ['Kodak Brownie Hawkeye', 3], ['Polaroid SX-70', 3], ['Київ-88', 3], ['Смена-8М', 3], ['Agfa Isolette', 3]]],
  ['Годинники', 'Watches', [['Наручний годинник Полет', 3], ['Годинник Слава', 2], ['Кишеньковий годинник Молния', 3], ['Seiko 5', 3], ['Годинник Ракета', 3], ['Будильник Слава', 3]]],
  ['Платівки', 'Vinyl records', [['Платівка The Beatles', 2], ['Вініл Pink Floyd', 3], ['Платівка Мелодія', 3], ['Вініл ABBA', 3], ['Платівка Queen', 3], ['Збірка естради 70-х', 2]]],
  ['Освітлення', 'Lighting', [['Настільна лампа з зеленим абажуром', 3], ['Торшер', 2], ['Настільна лампа 1970-х', 2], ['Гасова лампа', 4], ['Лампа з абажуром з бахромою', 1]]],
  ['Меблі', 'Furniture', [['Крісло-куля', 3], ['Крісло-яйце', 3], ['Журнальний столик', 3], ['Стілець Thonet', 4], ['Комод з горіха', 3], ['Пуф', 3]]],
  ['Одяг', 'Clothing', [['Шкіряна куртка', 4], ['Сукня в горошок', 2], ["Джинсова куртка Levi's", 3], ['Капелюх федора', 2], ['Вишиванка ручної роботи', 4]]],
  ['Іграшки', 'Toys', [['Металева машинка', 3], ["Олов'яні солдатики", 4], ['Лялька в народному вбранні', 3], ['Залізниця ГДР', 4], ['Конструктор металевий', 3]]],
  ['Книги', 'Books', [['Кобзар, старе видання', 4], ['Енциклопедія в 10 томах', 4], ['Атлас світу', 3], ['Дитяча книжка з ілюстраціями', 3], ['Кулінарна книга', 3]]],
];
const TAGS = ['срср', 'рідкісне', 'робочий стан', 'колекційне', 'оригінал', 'реставроване', 'ретро', '1960-ті', '1970-ті', '1980-ті', 'латунь', 'дерево', 'шкіра'];

// Фото демо-лотів лежать у public/img/seed/<категорія>-<річ>-<номер>.jpg: у кожної речі свої фото (Wikimedia Commons, автори в public/img/seed/CREDITS.md).

const now = Date.now();
const H = 3600000, D = 24 * H;

tx(() => {
  CATS.forEach(([uk, en]) => db.prepare('INSERT INTO categories (name_uk, name_en) VALUES (?, ?)').run(uk, en));
  TAGS.forEach((t) => db.prepare('INSERT INTO tags (name) VALUES (?)').run(t));

  const pw = hashPassword('password123');
  const FIRST = ['Олена', 'Андрій', 'Марія', 'Тарас', 'Ірина', 'Олег', 'Наталія', 'Дмитро', 'Софія', 'Богдан'];
  const LAST = ['Коваленко', 'Шевченко', 'Бондар', 'Ткачук', 'Мельник', 'Кравець', 'Олійник', 'Лисенко'];
  db.prepare("INSERT INTO users (email, password_hash, name, role, created_at) VALUES ('admin@retrolot.test', ?, 'Адміністратор', 'admin', ?)")
    .run(hashPassword(process.env.ADMIN_PASSWORD || 'admin12345'), now - 90 * D);
  for (let i = 1; i < 49; i++) {
    const f = pick(FIRST), l = pick(LAST);
    const seller = i <= 15;
    db.prepare(`INSERT INTO users (email, password_hash, name, role, first_name, last_name, phone, address, payout_card_last4, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(`user${i}@retrolot.test`, pw, `${f} ${l[0]}.`, seller ? 'seller' : 'bidder',
      f, l, `+380 67 ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`, `м. ${pick(['Одеса', 'Київ', 'Львів', 'Харків'])}, вул. Центральна, ${int(1, 120)}`,
      seller ? String(int(1000, 9999)) : null, now - int(10, 80) * D);
  }
  db.prepare('INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)').run('blocked@retrolot.test', pw, 'Порушник', now - 5 * D);
  db.prepare("UPDATE users SET blocked = 1, block_reason = 'unpaid' WHERE email = 'blocked@retrolot.test'").run();
  const bidders = db.prepare("SELECT id FROM users WHERE role <> 'admin' AND blocked = 0").all().map((r) => r.id);

  // розподіл статусів для 200 лотів
  const plan = [
    ...Array(125).fill('live'), ...Array(25).fill('upcoming'), ...Array(35).fill('ended'),
    ...Array(8).fill('pending'), ...Array(4).fill('rejected'), ...Array(3).fill('withdrawn'),
  ];
  const lotIds = { live: [], ended: [] };
  plan.forEach((kind, i) => {
    const c = int(0, CATS.length - 1);
    const sellerId = int(2, 16);
    const price = int(2, 80) * 50;
    const step = Math.max(10, Math.round(price / 20 / 10) * 10);
    let starts, ends;
    if (kind === 'live') { starts = now - int(1, 72) * H; ends = now + int(1, 240) * H + int(0, 59) * 60000; }
    else if (kind === 'upcoming') { starts = now + int(2, 96) * H; ends = starts + int(24, 168) * H; }
    else if (kind === 'ended') { ends = now - int(1, 400) * H; starts = ends - int(24, 168) * H; }
    else { starts = now + int(24, 96) * H; ends = starts + 72 * H; }
    const status = { live: 'active', upcoming: 'active', ended: 'ended' }[kind] || kind;
    const item = int(0, CATS[c][2].length - 1);
    const [name, photos] = CATS[c][2][item];
    const title = `${name}, ${int(1955, 1989)}`;
    const desc = describe(c, pick, rnd);
    const r = db.prepare(`INSERT INTO lots (seller_id, category_id, title, description, start_price, min_step, current_price, starts_at, ends_at, status, admin_note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sellerId, c + 1, title, desc, price, step, price, starts, ends, status,
      kind === 'rejected' ? 'Фото не відповідають опису' : null, Math.min(starts, now) - int(1, 48) * H);
    const id = Number(r.lastInsertRowid);
    for (let pos = 0; pos < photos; pos++) {
      const k = (pos + i) % photos + 1; // різні лоти однієї речі починаються з різного фото
      db.prepare('INSERT INTO lot_images (lot_id, path, position) VALUES (?, ?, ?)').run(id, `/img/seed/${c + 1}-${item + 1}-${k}.jpg`, pos);
    }
    new Set([int(1, TAGS.length), int(1, TAGS.length)]).forEach((t) => db.prepare('INSERT INTO lot_tags (lot_id, tag_id) VALUES (?, ?)').run(id, t));
    if (kind === 'live' || kind === 'ended') lotIds[kind].push({ id, sellerId, price, step, starts, ends });
  });

  // 1500 ставок: розкидані по активних і завершених лотах, у кожному лоті суми лише зростають
  const targets = [...lotIds.live, ...lotIds.ended];
  const counts = new Map(targets.map((l) => [l.id, 0]));
  // чверть лотів лишається без ставок, решта ділять ставки нерівномірно
  const busy = targets.filter(() => rnd() > 0.25);
  for (let i = 0; i < 1500; i++) {
    const l = busy[Math.floor(rnd() ** 1.6 * busy.length)];
    counts.set(l.id, counts.get(l.id) + 1);
  }
  let total = 0;
  for (const l of targets) {
    const n = counts.get(l.id);
    let amount = l.price, leader = null, t = l.starts;
    const last = Math.min(l.ends, now) - 60000;
    for (let k = 0; k < n; k++) {
      if (k > 0) amount += l.step * int(1, 3);
      let u;
      do { u = pick(bidders); } while (u === l.sellerId || u === leader);
      t = Math.min(last, t + Math.floor((last - t) / (n - k + 1)) + int(0, 60000));
      db.prepare('INSERT INTO bids (lot_id, user_id, amount, is_auto, created_at) VALUES (?, ?, ?, ?, ?)').run(l.id, u, amount, rnd() < 0.1 ? 1 : 0, t);
      leader = u;
      total++;
    }
    db.prepare('UPDATE lots SET current_price = ?, leader_id = ?, bid_count = ? WHERE id = ?').run(amount, leader, n, l.id);
  }

  // завершені лоти з лідером: переможець + платіж (здебільшого оплачений, частина ще очікує)
  for (const l of lotIds.ended) {
    const lot = db.prepare('SELECT leader_id, current_price FROM lots WHERE id = ?').get(l.id);
    if (!lot.leader_id) continue;
    const paid = rnd() < 0.7;
    const u = db.prepare('SELECT first_name, last_name, phone, address, email FROM users WHERE id = ?').get(lot.leader_id);
    db.prepare('UPDATE lots SET winner_id = ? WHERE id = ?').run(lot.leader_id, l.id);
    db.prepare(`INSERT INTO payments (lot_id, user_id, amount, status, due_at, paid_at, card_last4, first_name, last_name, phone, email, address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(l.id, lot.leader_id, lot.current_price, paid ? 'paid' : 'pending',
      Math.max(l.ends, now - 24 * H) + 48 * H, paid ? l.ends + 3 * H : null, paid ? String(int(1000, 9999)) : null,
      paid ? u.first_name || 'Ім\'я' : null, paid ? u.last_name || 'Прізвище' : null, paid ? u.phone || '+380000000000' : null,
      paid ? u.email : null, paid ? u.address || 'Одеса' : null, l.ends);
  }
  // при першому запуску не треба розсилати сотні старих листів
  db.prepare('UPDATE notifications SET emailed = 1').run();
  console.log(`Seeded: ${db.prepare('SELECT COUNT(*) n FROM users').get().n} users, ${db.prepare('SELECT COUNT(*) n FROM lots').get().n} lots, ${total} bids`);
});
