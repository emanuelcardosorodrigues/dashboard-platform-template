-- Tabela de logs usada pelo worker (logging de cada passo + índice de orders
-- pendentes consultado pelo cron). Esta é a ÚNICA tabela que o worker.js atual
-- realmente usa no D1. Schema espelhado 1:1 do D1 de produção (VSL).
CREATE TABLE IF NOT EXISTS logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT    NOT NULL,
  step         INTEGER NOT NULL,
  step_name    TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  type         TEXT    NOT NULL CHECK(type IN ('success', 'error', 'info')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
