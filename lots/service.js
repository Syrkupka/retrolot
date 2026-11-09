const { db, tx } = require('../db');
const { fail } = require('../lib/errors');
const { check, luhn } = require('../lib/validate');
const { saveImages } = require('./images');
const bids = require('../bids/service');

// Статуси, у яких лот бачать усі. Інші (на модерації, відхилені, зняті) бачать лише продавець і адмін.
const PUBLIC_STATUSES = ['active', 'ended', 'cancelled'];

// Колонки для картки лота в списку + перше фото лота.
const CARD_COLUMNS = `
  l.id, l.title, l.start_price, l.current_price, l.bid_count, l.starts_at, l.ends_at, l.status, l.category_id,
  (SELECT path FROM lot_images i WHERE i.lot_id = l.id ORDER BY position LIMIT 1) AS image`;

// Варіанти сортування: назва з адреси -> частина SQL.
const SORTS = {
  ends: 'l.ends_at ASC',
  starts: 'l.starts_at ASC',
  new: 'l.created_at DESC',
  price_asc: 'l.current_price ASC',
  price_desc: 'l.current_price DESC',
};

const PAGE_FIELDS = {
  page: { type: 'int', min: 1, max: 10000, optional: true },
  size: { type: 'int', min: 1, max: 60, optional: true },
};

// Текст для пошуку LIKE. Символи % і _ мають в SQL особливе значення, тому їх екрануємо.
function likePattern(text) {
  const escaped = text.replace(/[\\%_]/g, (symbol) => '\\' + symbol);
  return '%' + escaped + '%';
}

// Пагінація зі зміщенням (OFFSET): рахуємо загальну кількість і беремо одну сторінку.
function paged(sql, params, page = 1, size = 20) {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n;
  const items = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size);
  return { items, total, page, pages: Math.ceil(total / size) };
}

// Публічний каталог: схвалені лоти, де торги йдуть або скоро почнуться.
// Фільтри, сортування і сторінки рахуються в SQL, а не в браузері.
function list(query, now = Date.now()) {
  const filters = check(query, {
    q: { type: 'string', max: 100, optional: true },
    category: { type: 'int', min: 1, optional: true },
    tag: { type: 'string', max: 40, optional: true },
    min: { type: 'int', min: 0, optional: true },
    max: { type: 'int', min: 0, optional: true },
    state: { type: 'string', enum: ['all', 'live', 'upcoming'], optional: true },
    sort: { type: 'string', enum: Object.keys(SORTS), optional: true },
    ...PAGE_FIELDS,
  });

  // збираємо умови WHERE і значення для них
  const conditions = ["l.status = 'active'", 'l.ends_at > ?'];
  const params = [now];

  if (filters.q) {
    conditions.push("(l.title LIKE ? ESCAPE '\\' OR l.description LIKE ? ESCAPE '\\')");
    params.push(likePattern(filters.q), likePattern(filters.q));
  }
  if (filters.category) {
    conditions.push('l.category_id = ?');
    params.push(filters.category);
  }
  if (filters.tag) {
    conditions.push('l.id IN (SELECT lt.lot_id FROM lot_tags lt JOIN tags t ON t.id = lt.tag_id WHERE t.name = ?)');
    params.push(filters.tag);
  }
  if (filters.min !== undefined) {
    conditions.push('l.current_price >= ?');
    params.push(filters.min);
  }
  if (filters.max !== undefined) {
    conditions.push('l.current_price <= ?');
    params.push(filters.max);
  }
  if (filters.state === 'live') {
    conditions.push('l.starts_at <= ?');
    params.push(now);
  }
  if (filters.state === 'upcoming') {
    conditions.push('l.starts_at > ?');
    params.push(now);
  }

  const orderBy = SORTS[filters.sort || 'ends'];
  const sql = `SELECT ${CARD_COLUMNS} FROM lots l WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy}, l.id`;
  const result = paged(sql, params, filters.page, filters.size);
  result.now = now; // час сервера, щоб таймери в браузері не збивались
  return result;
}

// Історія: лоти, які користувач купив, продав або на які ставив.
function history(userId, query) {
  const filters = check(query, {
    filter: { type: 'string', enum: ['all', 'bought', 'sold', 'bid'], optional: true },
    q: { type: 'string', max: 100, optional: true },
    sort: { type: 'string', enum: Object.keys(SORTS), optional: true },
    ...PAGE_FIELDS,
  });

  const bought = "(l.winner_id = :user AND l.status = 'ended')";
  const sold = "(l.seller_id = :user AND l.status = 'ended' AND l.winner_id IS NOT NULL)";
  const bidOn = '(l.id IN (SELECT lot_id FROM bids WHERE user_id = :user))';

  let condition = `(${bought} OR ${sold} OR ${bidOn})`;
  if (filters.filter === 'bought') condition = bought;
  if (filters.filter === 'sold') condition = sold;
  if (filters.filter === 'bid') condition = bidOn;

  const params = { user: userId };
  if (filters.q) {
    condition += " AND l.title LIKE :q ESCAPE '\\'";
    params.q = likePattern(filters.q);
  }

  const orderBy = filters.sort ? SORTS[filters.sort] : 'l.ends_at DESC';
  const sql = `
    SELECT ${CARD_COLUMNS},
      CASE WHEN l.winner_id = :user AND l.status = 'ended' THEN 'bought'
           WHEN l.seller_id = :user THEN 'sold'
           ELSE 'bid' END AS relation,
      (SELECT status FROM payments p WHERE p.lot_id = l.id ORDER BY p.id DESC LIMIT 1) AS payment_status
    FROM lots l
    WHERE ${condition}
    ORDER BY ${orderBy}, l.id`;

  const page = filters.page || 1;
  const size = filters.size || 20;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(params).n;
  const items = db.prepare(`${sql} LIMIT :limit OFFSET :offset`).all({ ...params, limit: size, offset: (page - 1) * size });
  return { items, total, page, pages: Math.ceil(total / size) };
}

// Дані для сторінки лота. viewer це користувач, який дивиться (або null для гостя).
function get(lotId, viewer, now = Date.now()) {
  const lot = db.prepare(`
    SELECT l.*, c.name_uk AS category_uk, c.name_en AS category_en
    FROM lots l JOIN categories c ON c.id = l.category_id
    WHERE l.id = ?`).get(lotId);

  const isOwner = Boolean(lot && viewer && lot.seller_id === viewer.id);
  const isAdmin = Boolean(viewer && viewer.role === 'admin');

  // прихований лот відповідає так само, як неіснуючий, щоб не підтверджувати, що він є
  if (!lot) fail('not_found', 'Lot not found');
  if (!PUBLIC_STATUSES.includes(lot.status) && !isOwner && !isAdmin) fail('not_found', 'Lot not found');

  const images = db.prepare('SELECT path FROM lot_images WHERE lot_id = ? ORDER BY position').all(lotId);
  const tags = db.prepare(
    'SELECT t.name FROM lot_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lot_id = ? ORDER BY t.name').all(lotId);
  const canEdit = isOwner && lot.bid_count === 0 && ['pending', 'rejected', 'active'].includes(lot.status);

  const result = {
    id: lot.id,
    title: lot.title,
    description: lot.description,
    status: lot.status,
    category_id: lot.category_id,
    category_uk: lot.category_uk,
    category_en: lot.category_en,
    start_price: lot.start_price,
    min_step: lot.min_step,
    current_price: lot.current_price,
    bid_count: lot.bid_count,
    starts_at: lot.starts_at,
    ends_at: lot.ends_at,
    created_at: lot.created_at,
    admin_note: isOwner || isAdmin ? lot.admin_note : undefined,
    images: images.map((row) => row.path),
    tags: tags.map((row) => row.name),
    bids: bids.lotHistory(lotId, viewer ? viewer.id : null),
    min_bid: bids.minNext(lot),
    is_owner: isOwner,
    can_edit: canEdit,
    leading: Boolean(viewer && lot.leader_id === viewer.id),
    now: now,
  };

  if (viewer) {
    const watching = db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND lot_id = ?').get(viewer.id, lotId);
    result.watching = Boolean(watching);

    const auto = db.prepare('SELECT max_amount FROM auto_bids WHERE user_id = ? AND lot_id = ?').get(viewer.id, lotId);
    result.my_auto = auto ? auto.max_amount : null;

    // останній платіж за лот (якщо торги завершились)
    const payment = db.prepare(
      'SELECT id, user_id, amount, status, due_at FROM payments WHERE lot_id = ? ORDER BY id DESC LIMIT 1').get(lotId);

    if (payment && payment.user_id === viewer.id) {
      result.my_payment = { id: payment.id, amount: payment.amount, status: payment.status, due_at: payment.due_at };
    }

    if (payment && (isOwner || isAdmin)) {
      const winner = db.prepare(`
        SELECT u.name, p.first_name, p.last_name, p.phone, p.email, p.address, p.status, p.amount, p.due_at
        FROM payments p JOIN users u ON u.id = p.user_id
        WHERE p.id = ?`).get(payment.id);
      // контакти покупця продавець бачить лише після оплати
      if (winner.status === 'paid') {
        result.winner = winner;
      } else {
        result.winner = { name: winner.name, status: winner.status, amount: winner.amount, due_at: winner.due_at };
      }
    }
  }

  if (isAdmin) {
    result.seller = db.prepare(`
      SELECT id, email, name, first_name, last_name, phone, address, payout_card_last4, blocked
      FROM users WHERE id = ?`).get(lot.seller_id);
  }
  return result;
}

const LOT_FIELDS = {
  title: { type: 'string', min: 3, max: 120 },
  description: { type: 'string', min: 10, max: 5000 },
  category_id: { type: 'int', min: 1 },
  start_price: { type: 'int', min: 1, max: 1e8 },
  min_step: { type: 'int', min: 1, max: 1e7 },
  starts_at: { type: 'int', min: 0 },
  ends_at: { type: 'int', min: 0 },
  tags: { type: 'array', max: 10, of: 'string', optional: true },
};

const SELLER_FIELDS = {
  first_name: { type: 'string', min: 1, max: 80 },
  last_name: { type: 'string', min: 1, max: 80 },
  phone: { type: 'string', pattern: /^\+?[\d\s()-]{7,20}$/ },
  address: { type: 'string', min: 3, max: 300 },
  card_number: { type: 'string', pattern: /^[\d ]{12,23}$/ },
};

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Перевірка часу торгів і кроку.
function checkTimes(data, now) {
  const errors = [];
  const duration = data.ends_at - data.starts_at;
  if (data.starts_at < now - 5 * MINUTE) errors.push({ field: 'starts_at', rule: 'past' });
  if (duration < 10 * MINUTE) errors.push({ field: 'ends_at', rule: 'too_short' });
  if (duration > 30 * DAY) errors.push({ field: 'ends_at', rule: 'too_long' });
  if (data.min_step > data.start_price) errors.push({ field: 'min_step', rule: 'max' });
  if (errors.length > 0) fail('validation', 'Invalid input', { errors });
}

function checkCategory(categoryId) {
  const exists = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId);
  if (!exists) fail('validation', 'Invalid input', { errors: [{ field: 'category_id', rule: 'exists' }] });
}

// Зберігає теги лота (зв'язок багато-до-багатьох lot_tags). Нові теги створюються автоматично.
function setTags(lotId, tags = []) {
  db.prepare('DELETE FROM lot_tags WHERE lot_id = ?').run(lotId);

  const names = new Set();
  for (const tag of tags) {
    const name = tag.trim().toLowerCase().slice(0, 30);
    if (name) names.add(name);
  }

  for (const name of names) {
    db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT (name) DO NOTHING').run(name);
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    db.prepare('INSERT OR IGNORE INTO lot_tags (lot_id, tag_id) VALUES (?, ?)').run(lotId, tag.id);
  }
}

// Зберігає список фото лота в потрібному порядку.
function setImages(lotId, paths) {
  db.prepare('DELETE FROM lot_images WHERE lot_id = ?').run(lotId);
  paths.forEach((path, position) => {
    db.prepare('INSERT INTO lot_images (lot_id, path, position) VALUES (?, ?, ?)').run(lotId, path, position);
  });
}

// Створення лота. Новий лот одразу йде на модерацію (status = 'pending').
function create(userId, input, now = Date.now()) {
  const data = check(input, { ...LOT_FIELDS, images: { type: 'array', min: 3, max: 10, of: 'string' } });
  const seller = check(input ? input.seller : null, SELLER_FIELDS);

  const card = seller.card_number.replace(/\s/g, '');
  if (card.length < 12 || card.length > 19 || !luhn(card)) {
    fail('validation', 'Invalid input', { errors: [{ field: 'card_number', rule: 'luhn' }] });
  }
  checkTimes(data, now);
  checkCategory(data.category_id);

  const user = db.prepare('SELECT blocked FROM users WHERE id = ?').get(userId);
  if (user.blocked) fail('blocked', 'Your account is blocked');

  const imagePaths = saveImages(data.images);

  return tx(() => {
    // shortcut: зберігаються лише останні 4 цифри картки для виплати; справжні виплати потребують платіжного сервісу з PCI DSS
    db.prepare(`
      UPDATE users
      SET first_name = ?, last_name = ?, phone = ?, address = ?, payout_card_last4 = ?,
          role = CASE role WHEN 'bidder' THEN 'seller' ELSE role END
      WHERE id = ?`).run(seller.first_name, seller.last_name, seller.phone, seller.address, card.slice(-4), userId);

    const inserted = db.prepare(`
      INSERT INTO lots (seller_id, category_id, title, description, start_price, min_step, current_price,
                        starts_at, ends_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
      userId, data.category_id, data.title, data.description, data.start_price, data.min_step,
      data.start_price, data.starts_at, data.ends_at, now);

    const lotId = Number(inserted.lastInsertRowid);
    setImages(lotId, imagePaths);
    setTags(lotId, data.tags);
    return { id: lotId, status: 'pending' };
  });
}

// Редагування. Дозволене лише до першої ставки, і ця умова (bid_count = 0) записана прямо в UPDATE:
// якщо ставка прийде в ту саму мить, виграє ставка, а редагування буде відхилено.
function update(userId, lotId, input, now = Date.now()) {
  const data = check(input, { ...LOT_FIELDS, images: { type: 'array', min: 3, max: 10, of: 'string', optional: true } });
  checkTimes(data, now);
  checkCategory(data.category_id);

  // нові фото приходять як data:..., старі як шлях /uploads/...
  let newImages = [];
  let keptImages = [];
  if (data.images) {
    newImages = data.images.filter((image) => image.startsWith('data:'));
    keptImages = data.images.filter((image) => !image.startsWith('data:'));
  }

  return tx(() => {
    const lot = db.prepare('SELECT seller_id FROM lots WHERE id = ?').get(lotId);
    if (!lot || lot.seller_id !== userId) fail('not_found', 'Lot not found');

    if (data.images) {
      // залишити можна лише ті фото, які вже належать цьому лоту
      const existing = db.prepare('SELECT path FROM lot_images WHERE lot_id = ?').all(lotId).map((row) => row.path);
      const unknown = keptImages.some((path) => !existing.includes(path));
      if (unknown) fail('validation', 'Invalid input', { errors: [{ field: 'images', rule: 'unknown' }] });
    }

    const updated = db.prepare(`
      UPDATE lots
      SET title = ?, description = ?, category_id = ?, start_price = ?, min_step = ?,
          current_price = ?, starts_at = ?, ends_at = ?, status = 'pending', admin_note = NULL
      WHERE id = ? AND seller_id = ? AND bid_count = 0 AND status IN ('pending', 'rejected', 'active')`).run(
      data.title, data.description, data.category_id, data.start_price, data.min_step,
      data.start_price, data.starts_at, data.ends_at, lotId, userId);

    if (updated.changes === 0) fail('edit_locked', 'Lot can no longer be edited (it has bids or is closed)');

    if (data.images) {
      // порядок: спершу фото, які користувач залишив, потім нові
      setImages(lotId, keptImages.concat(saveImages(newImages)));
    }
    if (data.tags) setTags(lotId, data.tags);
    return { id: lotId, status: 'pending' };
  });
}

// Зняти лот з торгів (лише без ставок).
function withdraw(userId, lotId) {
  return tx(() => {
    const lot = db.prepare('SELECT seller_id FROM lots WHERE id = ?').get(lotId);
    if (!lot || lot.seller_id !== userId) fail('not_found', 'Lot not found');

    const updated = db.prepare(`
      UPDATE lots SET status = 'withdrawn'
      WHERE id = ? AND seller_id = ? AND bid_count = 0 AND status IN ('pending', 'rejected', 'active')`).run(lotId, userId);

    if (updated.changes === 0) fail('edit_locked', 'Only lots without bids can be withdrawn');
    return { id: lotId, status: 'withdrawn' };
  });
}

// "Мої лоти" продавця.
function mine(userId, query) {
  const filters = check(query, {
    status: { type: 'string', enum: ['pending', 'rejected', 'active', 'ended', 'cancelled', 'withdrawn'], optional: true },
    ...PAGE_FIELDS,
  });
  let where = 'l.seller_id = ?';
  const params = [userId];
  if (filters.status) {
    where += ' AND l.status = ?';
    params.push(filters.status);
  }
  const sql = `
    SELECT ${CARD_COLUMNS}, l.admin_note, l.winner_id IS NOT NULL AS has_winner
    FROM lots l WHERE ${where}
    ORDER BY l.created_at DESC, l.id DESC`;
  return paged(sql, params, filters.page, filters.size);
}

// Додати лот у список спостереження (on = true) або прибрати (on = false).
function watch(userId, lotId, on) {
  const lot = db.prepare('SELECT status FROM lots WHERE id = ?').get(lotId);
  if (!lot || !PUBLIC_STATUSES.includes(lot.status)) fail('not_found', 'Lot not found');

  if (on) {
    db.prepare('INSERT OR IGNORE INTO watchlist (user_id, lot_id, created_at) VALUES (?, ?, ?)').run(userId, lotId, Date.now());
  } else {
    db.prepare('DELETE FROM watchlist WHERE user_id = ? AND lot_id = ?').run(userId, lotId);
  }
  return { watching: on };
}

function watchlist(userId, query) {
  const filters = check(query, PAGE_FIELDS);
  const sql = `
    SELECT ${CARD_COLUMNS}
    FROM watchlist w JOIN lots l ON l.id = w.lot_id
    WHERE w.user_id = ?
    ORDER BY w.created_at DESC`;
  return paged(sql, [userId], filters.page, filters.size);
}

function categories() {
  return db.prepare('SELECT id, name_uk, name_en FROM categories ORDER BY id').all();
}

function tags() {
  return db.prepare(`
    SELECT t.name, COUNT(*) AS n
    FROM tags t JOIN lot_tags lt ON lt.tag_id = t.id
    GROUP BY t.id ORDER BY n DESC LIMIT 40`).all();
}

module.exports = { list, history, get, create, update, withdraw, mine, watch, watchlist, categories, tags };
