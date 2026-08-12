ALTER TABLE notas ADD COLUMN email_tomador TEXT;

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT OR IGNORE INTO config (chave, valor) VALUES ('email_cliente_ativo', 'false');
