-- D1 schema (Cloudflare edge SQLite) — quiz-db
-- Tabelas: dlq (dead-letter queue para falhas Supabase) + bot_fingerprints (pós-hoc)
-- Aplicar: npx wrangler d1 execute quiz-db --remote --file=./migrations/d1/0001_init.sql

CREATE TABLE IF NOT EXISTS dlq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  err TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  permanent_failure INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_attempt_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_dlq_pending
  ON dlq(permanent_failure, created_at)
  WHERE permanent_failure = 0;

CREATE TABLE IF NOT EXISTS bot_fingerprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ua TEXT,
  headers_json TEXT,
  ip_country TEXT,
  reason TEXT,
  quiz_slug TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bot_fingerprints_ua
  ON bot_fingerprints(ua);
