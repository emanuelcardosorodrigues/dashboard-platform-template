CREATE TABLE IF NOT EXISTS notas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_rps    TEXT,
  numero_nfse   TEXT,
  doc_tomador   TEXT,
  nome_tomador  TEXT,
  valor         REAL,
  origem        TEXT,
  hotmart_id    TEXT,
  xml_completo  TEXT,
  drive_file_id TEXT,
  drive_link    TEXT,
  product_id    TEXT,
  nome_produto  TEXT,
  status        TEXT NOT NULL DEFAULT 'emitida',
  email_tomador TEXT,
  criado_em     DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produtos (
  product_id  TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  percentual  REAL NOT NULL DEFAULT 25
);

CREATE TABLE IF NOT EXISTS drive_folders (
  path       TEXT PRIMARY KEY,
  folder_id  TEXT NOT NULL,
  criado_em  DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT OR IGNORE INTO config (chave, valor) VALUES ('email_cliente_ativo', 'false');

CREATE INDEX IF NOT EXISTS idx_notas_criado_em ON notas(criado_em);
CREATE INDEX IF NOT EXISTS idx_notas_status    ON notas(status);
