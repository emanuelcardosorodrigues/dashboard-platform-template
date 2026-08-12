CREATE TABLE IF NOT EXISTS webhook_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  evento         TEXT,
  product_id     TEXT,
  transaction_id TEXT,
  payload_json   TEXT,
  resultado      TEXT,
  mensagem       TEXT,
  criado_em      DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_criado_em ON webhook_log(criado_em);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  acao          TEXT NOT NULL,
  ator          TEXT,
  nota_id       INTEGER,
  detalhes_json TEXT,
  criado_em     DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_criado_em ON audit_log(criado_em);
