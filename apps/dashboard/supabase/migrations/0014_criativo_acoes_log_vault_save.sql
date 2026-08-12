-- 0014_criativo_acoes_log_vault_save.sql
-- Estende o CHECK de tipo em criativo_acoes_log pra incluir 'vault_save'
-- (executor passou a salvar nota no mind-vault diretamente após aprovação).
--
-- ad_id continua NOT NULL: pra vault_save sem ad de origem, caller usa
-- a string literal 'vault' como placeholder.

ALTER TABLE criativo_acoes_log
  DROP CONSTRAINT IF EXISTS criativo_acoes_log_tipo_check;

ALTER TABLE criativo_acoes_log
  ADD CONSTRAINT criativo_acoes_log_tipo_check
  CHECK (tipo IN ('escalar', 'pausar', 'vault_save'));
