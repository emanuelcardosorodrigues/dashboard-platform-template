-- 0015_criativo_acoes_log_mark_done.sql
-- Amplia CHECK de tipo em criativo_acoes_log pra incluir 'mark_done':
-- fechamento manual de sugestões 'novo_brief' / 'lateralizar' /
-- 'congruencia_fix' onde o humano implementou fora do sistema
-- (criou o ad no gerenciador, ajustou copy etc) e marca como feito.
--
-- Diferença pros outros tipos: NÃO chama API externa. Só registra
-- no audit log + atualiza criativo_sugestoes.status='executed'.

ALTER TABLE criativo_acoes_log
  DROP CONSTRAINT IF EXISTS criativo_acoes_log_tipo_check;

ALTER TABLE criativo_acoes_log
  ADD CONSTRAINT criativo_acoes_log_tipo_check
  CHECK (tipo IN ('escalar', 'pausar', 'vault_save', 'mark_done'));
