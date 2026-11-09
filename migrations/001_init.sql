CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  google_id TEXT UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'bidder' CHECK (role IN ('bidder','seller','admin')),
  blocked INTEGER NOT NULL DEFAULT 0,
  block_reason TEXT,
  first_name TEXT, last_name TEXT, phone TEXT, address TEXT,
  -- зберігаються лише останні 4 цифри; повні номери карток у базу не потрапляють
  payout_card_last4 TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name_uk TEXT NOT NULL,
  name_en TEXT NOT NULL
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE lots (
  id INTEGER PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  start_price INTEGER NOT NULL CHECK (start_price > 0),
  min_step INTEGER NOT NULL CHECK (min_step > 0),
  current_price INTEGER NOT NULL,
  leader_id INTEGER REFERENCES users(id),
  winner_id INTEGER REFERENCES users(id),
  bid_count INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK (ends_at > starts_at),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','rejected','active','ended','cancelled','withdrawn')),
  admin_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX lots_seller ON lots(seller_id);
CREATE INDEX lots_category ON lots(category_id);
CREATE INDEX lots_winner ON lots(winner_id);

CREATE TABLE lot_images (
  id INTEGER PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  path TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX lot_images_lot ON lot_images(lot_id, position);

-- зв'язок багато-до-багатьох: лот <-> тег
CREATE TABLE lot_tags (
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (lot_id, tag_id)
);

-- зв'язок багато-до-багатьох: користувач <-> лот (список спостереження)
CREATE TABLE watchlist (
  user_id INTEGER NOT NULL REFERENCES users(id),
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lot_id)
);

CREATE TABLE bids (
  id INTEGER PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  is_auto INTEGER NOT NULL DEFAULT 0,
  idem_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX bids_lot ON bids(lot_id, amount DESC);
CREATE INDEX bids_user ON bids(user_id, created_at DESC);
-- повторний запит з тим самим Idempotency-Key не повинен створити другу ставку
CREATE UNIQUE INDEX bids_idem ON bids(user_id, idem_key) WHERE idem_key IS NOT NULL;
-- історія ставок незмінна
CREATE TRIGGER bids_no_update BEFORE UPDATE ON bids
  BEGIN SELECT RAISE(ABORT, 'bids are immutable'); END;
CREATE TRIGGER bids_no_delete BEFORE DELETE ON bids
  BEGIN SELECT RAISE(ABORT, 'bids are immutable'); END;

CREATE TABLE auto_bids (
  user_id INTEGER NOT NULL REFERENCES users(id),
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  max_amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lot_id)
);
CREATE INDEX auto_bids_lot ON auto_bids(lot_id, max_amount DESC);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired')),
  due_at INTEGER NOT NULL,
  paid_at INTEGER,
  card_last4 TEXT,
  first_name TEXT, last_name TEXT, phone TEXT, email TEXT, address TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX payments_due ON payments(status, due_at);
CREATE INDEX payments_lot ON payments(lot_id);
CREATE INDEX payments_user ON payments(user_id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  lot_id INTEGER REFERENCES lots(id),
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  is_read INTEGER NOT NULL DEFAULT 0,
  emailed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_unsent ON notifications(emailed) WHERE emailed = 0;
