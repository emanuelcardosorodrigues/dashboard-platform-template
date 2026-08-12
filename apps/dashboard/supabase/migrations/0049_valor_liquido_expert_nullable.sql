-- 0049_valor_liquido_expert_nullable.sql
-- #20 — valor_liquido_expert deve aceitar NULL quando commissions não vem no
-- payload Hotmart (dado DESCONHECIDO, não zero). A tabela 'transacoes' foi
-- criada antes do controle de migrations; o DDL original não está versionado,
-- então a coluna pode ser NOT NULL. Esta migration torna-a nullable para que
-- o webhook possa gravar NULL em vez do valor enganoso 0.
--
-- NÃO APLICAR sem primeiro verificar se a coluna já é nullable:
--   SELECT is_nullable FROM information_schema.columns
--   WHERE table_name = 'transacoes' AND column_name = 'valor_liquido_expert';
-- Se já for 'YES', esta migration pode ser pulada (é idempotente via ALTER).

ALTER TABLE transacoes
  ALTER COLUMN valor_liquido_expert DROP NOT NULL;
