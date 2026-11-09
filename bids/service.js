const { db, tx } = require('../db');
const { fail } = require('../lib/errors');
const { check } = require('../lib/validate');
const { notify } = require('../notifications/service');

// Одна ставка не може бути більшою за мінімальну наступну більш ніж у 10 разів.
const MAX_JUMP = 10;

// Головний запит усього проєкту: перевірка ціни і запис ставки в ОДНІЙ команді UPDATE.
// Якщо дві однакові ставки прийшли одночасно, рядок змінить лише перша.
// Для другої умова вже не виконається (потрібно current_price + min_step), тож changes = 0.
const updateLotPrice = db.prepare(`
  UPDATE lots
  SET current_price = :amount, leader_id = :user, bid_count = bid_count + 1
  WHERE id = :lot
    AND status = 'active'
    AND starts_at <= :now
    AND ends_at > :now
    AND seller_id <> :user
    AND (
      (bid_count = 0 AND :amount >= start_price)
      OR (bid_count > 0 AND :amount >= current_price + min_step)
    )`);

const insertBid = db.prepare(
  'INSERT INTO bids (lot_id, user_id, amount, is_auto, idem_key, created_at) VALUES (?, ?, ?, ?, ?, ?)');

const selectLot = db.prepare('SELECT * FROM lots WHERE id = ?');

// Пробує записати ставку. Повертає true, якщо ставку прийнято.
function tryBid(lotId, userId, amount, now, isAuto = 0, idemKey = null) {
  const result = updateLotPrice.run({ lot: lotId, user: userId, amount: amount, now: now });
  const accepted = result.changes === 1;
  if (accepted) {
    insertBid.run(lotId, userId, amount, isAuto, idemKey, now);
  }
  return accepted;
}

// Мінімальна сума наступної ставки.
function minNext(lot) {
  if (lot.bid_count === 0) {
    return lot.start_price;
  }
  return lot.current_price + lot.min_step;
}

// Межа автоставки користувача на лоті (0, якщо автоставки немає).
function getAutoLimit(lotId, userId) {
  const row = db.prepare('SELECT max_amount FROM auto_bids WHERE lot_id = ? AND user_id = ?').get(lotId, userId);
  return row ? row.max_amount : 0;
}

// Додає або оновлює автоставку.
function saveAutoBid(userId, lotId, maxAmount, now) {
  db.prepare(`
    INSERT INTO auto_bids (user_id, lot_id, max_amount, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, lot_id) DO UPDATE SET max_amount = excluded.max_amount`)
    .run(userId, lotId, maxAmount, now);
}

// Автоставки. На кожному кроці поточний лідер (leader) змагається
// з найсильнішою автоставкою іншого учасника (rival).
// Кожен крок «вичерпує» одну зі сторін, тому цикл завжди закінчується.
// Якщо межі майже рівні (різниця менша за крок), перемагає той, хто вже лідирує.
function runAutoBids(lotId, now) {
  for (let round = 0; round < 1000; round++) {
    const lot = selectLot.get(lotId);
    const need = minNext(lot);
    const step = lot.min_step;
    const leader = lot.leader_id;

    // найсильніша автоставка серед інших учасників, яка ще може перебити ціну
    const rival = db.prepare(`
      SELECT a.user_id, a.max_amount
      FROM auto_bids a JOIN users u ON u.id = a.user_id
      WHERE a.lot_id = ? AND a.user_id <> ? AND u.blocked = 0 AND a.max_amount >= ?
      ORDER BY a.max_amount DESC, a.created_at ASC
      LIMIT 1`).get(lotId, leader || 0, need);

    if (!rival) {
      return; // більше ніхто не може відповісти
    }

    const leaderLimit = leader ? getAutoLimit(lotId, leader) : 0;
    const rivalLimit = rival.max_amount;

    if (leader && leaderLimit >= rivalLimit + step) {
      // лідер сильніший: суперник ставить свою межу, лідер відповідає на крок вище
      tryBid(lotId, rival.user_id, rivalLimit, now, 1);
      tryBid(lotId, leader, rivalLimit + step, now, 1);
    } else if (leader && rivalLimit >= leaderLimit + step) {
      // суперник сильніший
      if (leaderLimit >= need) {
        tryBid(lotId, leader, leaderLimit, now, 1);
        tryBid(lotId, rival.user_id, leaderLimit + step, now, 1);
      } else {
        tryBid(lotId, rival.user_id, need, now, 1);
      }
    } else if (leader && leaderLimit >= need) {
      // межі майже рівні: лишається той, хто був першим
      tryBid(lotId, leader, leaderLimit, now, 1);
    } else {
      // лідер не має автоставки або вона вичерпана
      tryBid(lotId, rival.user_id, need, now, 1);
    }
  }
}

// Що повертаємо клієнту після ставки.
function bidResult(lot, userId, amount, replay) {
  return {
    amount: amount,
    leading: lot.leader_id === userId,
    current_price: lot.current_price,
    leader_id: lot.leader_id,
    bid_count: lot.bid_count,
    replay: replay,
  };
}

/**
 * Розміщує ставку.
 * idemKey це Idempotency-Key від клієнта: повторний запит повертає перший результат, а не нову ставку.
 */
function placeBid(userId, lotId, input, idemKey = null, now = Date.now()) {
  const data = check(input, {
    amount: { type: 'int', min: 1, max: 1e9 },
    auto_max: { type: 'int', min: 1, max: 1e9, optional: true },
  });
  if (data.auto_max !== undefined && data.auto_max < data.amount) {
    fail('validation', 'auto_max must be >= amount', { errors: [{ field: 'auto_max', rule: 'min' }] });
  }

  return tx(() => {
    // 1. заблокований користувач не ставить
    const user = db.prepare('SELECT blocked FROM users WHERE id = ?').get(userId);
    if (user.blocked) {
      fail('blocked', 'Your account is blocked');
    }

    // 2. повтор того самого запиту: віддаємо перший результат
    if (idemKey) {
      const previous = db.prepare('SELECT lot_id, amount FROM bids WHERE user_id = ? AND idem_key = ?').get(userId, idemKey);
      if (previous) {
        if (previous.lot_id !== lotId) {
          fail('conflict', 'Idempotency-Key reused for another lot');
        }
        return bidResult(selectLot.get(lotId), userId, previous.amount, true);
      }
    }

    // 3. лот існує і він не свій
    const before = selectLot.get(lotId);
    if (!before || !['active', 'ended', 'cancelled'].includes(before.status)) {
      fail('not_found', 'Lot not found');
    }
    if (before.seller_id === userId) {
      fail('forbidden', 'You cannot bid on your own lot');
    }

    // 4. занадто велика ставка (захист від фейкової ставки на мільярд)
    const maxBid = minNext(before) * MAX_JUMP;
    if (data.amount > maxBid) {
      fail('validation', 'Bid is too high for one step', {
        errors: [{ field: 'amount', rule: 'max_bid', max: maxBid }],
        max_bid: maxBid,
      });
    }

    // запам'ятовуємо останню ставку, щоб потім знайти всіх, кого перебили
    const lastBidId = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM bids WHERE lot_id = ?').get(lotId).id;

    // 5. сама ставка
    if (!tryBid(lotId, userId, data.amount, now, 0, idemKey)) {
      // змінено 0 рядків: з'ясовуємо причину, щоб пояснити користувачу
      const lot = selectLot.get(lotId);
      const isOpen = lot.status === 'active' && lot.starts_at <= now && lot.ends_at > now;
      if (!isOpen) {
        fail('lot_closed', 'Bidding is not open for this lot');
      }
      fail('bid_too_low', 'Someone bid first or the amount is below the minimum', {
        min_bid: minNext(lot),
        current_price: lot.current_price,
      });
    }

    // 6. автоставки
    if (data.auto_max !== undefined) {
      saveAutoBid(userId, lotId, data.auto_max, now);
    }
    runAutoBids(lotId, now);

    // 7. сповіщення всім, хто втратив лідерство (крім автора ставки, він бачить відповідь)
    const lot = selectLot.get(lotId);
    const newBidders = db.prepare('SELECT DISTINCT user_id FROM bids WHERE lot_id = ? AND id > ?').all(lotId, lastBidId);
    const outbid = new Set([before.leader_id]);
    for (const row of newBidders) {
      outbid.add(row.user_id);
    }
    for (const outbidUser of outbid) {
      if (outbidUser && outbidUser !== lot.leader_id && outbidUser !== userId) {
        notify(outbidUser, lotId, 'outbid', { title: lot.title, amount: lot.current_price });
      }
    }

    return bidResult(lot, userId, data.amount, false);
  });
}

// Увімкнути, змінити або вимкнути (max_amount = 0) автоставку.
function setAuto(userId, lotId, input) {
  const data = check(input, { max_amount: { type: 'int', min: 0, max: 1e9 } });
  return tx(() => {
    const lot = selectLot.get(lotId);
    if (!lot || lot.status !== 'active') {
      fail('lot_closed', 'Bidding is not open for this lot');
    }
    if (data.max_amount === 0) {
      db.prepare('DELETE FROM auto_bids WHERE user_id = ? AND lot_id = ?').run(userId, lotId);
      return { max_amount: null };
    }
    if (data.max_amount < minNext(lot)) {
      fail('bid_too_low', 'Limit is below the next minimum bid', { min_bid: minNext(lot) });
    }
    saveAutoBid(userId, lotId, data.max_amount, Date.now());
    return { max_amount: data.max_amount };
  });
}

// Історія ставок лота. Імена приховані: "Учасник 1", "Учасник 2"... Свої ставки позначені як mine.
function lotHistory(lotId, viewerId) {
  const bids = db.prepare(
    'SELECT id, user_id, amount, is_auto, created_at FROM bids WHERE lot_id = ? ORDER BY id DESC LIMIT 200').all(lotId);
  // порядок, у якому учасники вперше поставили: від нього залежить номер "Учасник N"
  const bidderOrder = db.prepare(
    'SELECT user_id FROM bids WHERE lot_id = ? GROUP BY user_id ORDER BY MIN(id)').all(lotId).map((row) => row.user_id);

  return bids.map((bid) => ({
    id: bid.id,
    amount: bid.amount,
    is_auto: bid.is_auto,
    created_at: bid.created_at,
    bidder: bidderOrder.indexOf(bid.user_id) + 1,
    mine: bid.user_id === viewerId,
  }));
}

// Ставки користувача сторінками.
function myBids(userId, { page = 1, size = 20 } = {}) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM bids WHERE user_id = ?').get(userId).n;
  const items = db.prepare(`
    SELECT b.id, b.lot_id, b.amount, b.is_auto, b.created_at,
           l.title, l.status, l.current_price, l.leader_id = b.user_id AS leading
    FROM bids b JOIN lots l ON l.id = b.lot_id
    WHERE b.user_id = ?
    ORDER BY b.id DESC
    LIMIT ? OFFSET ?`).all(userId, size, (page - 1) * size);
  return { items, total, page, pages: Math.ceil(total / size) };
}

module.exports = { placeBid, setAuto, lotHistory, myBids, minNext, runAutoBids };
