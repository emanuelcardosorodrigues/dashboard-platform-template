CREATE TABLE IF NOT EXISTS orders (
  order_key TEXT PRIMARY KEY,
  fired INTEGER NOT NULL DEFAULT 0,
  fired_at INTEGER,
  created_at INTEGER NOT NULL,
  original_headers TEXT,
  stape_status INTEGER,
  stape_attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_pending ON orders(fired, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  txn TEXT PRIMARY KEY,
  order_key TEXT NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  product_type TEXT,
  value REAL,
  producer_commission REAL,
  currency TEXT,
  approved_at INTEGER,
  raw_payload TEXT,
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_key ON order_items(order_key);
