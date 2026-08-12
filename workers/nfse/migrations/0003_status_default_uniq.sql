-- Patch para DBs existentes (prod criado antes do baseline).
-- Cada ALTER pode falhar se a coluna já existe — executar individualmente e ignorar erros.

-- Adiciona doc_tomador se não existir (prod tem cpf_tomador; código usa doc_tomador)
ALTER TABLE notas ADD COLUMN doc_tomador TEXT;

-- Adiciona email_tomador se não existir (já existe se 0002 rodou)
ALTER TABLE notas ADD COLUMN email_tomador TEXT;

-- Adiciona status se não existir (já existe se criado após 0001)
ALTER TABLE notas ADD COLUMN status TEXT;

-- Garante que status não fique NULL em registros antigos
UPDATE notas SET status = 'emitida' WHERE status IS NULL;

-- Copia cpf_tomador → doc_tomador em registros que ainda não têm doc_tomador
UPDATE notas SET doc_tomador = cpf_tomador WHERE doc_tomador IS NULL AND cpf_tomador IS NOT NULL;

-- Remove duplicatas de hotmart_id antes de criar índice UNIQUE
DELETE FROM notas
WHERE id NOT IN (
  SELECT MIN(id) FROM notas
  WHERE hotmart_id IS NOT NULL
  GROUP BY hotmart_id
);

-- Índice UNIQUE para idempotência de webhook
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notas_hotmart_id
  ON notas(hotmart_id) WHERE hotmart_id IS NOT NULL;
