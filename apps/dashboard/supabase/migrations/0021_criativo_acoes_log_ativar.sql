-- 0021_criativo_acoes_log_ativar.sql
-- Estende o CHECK de tipo em criativo_acoes_log pra incluir 'ativar' (controle
-- Meta na tabela ganhou o botão Ativar, par do Pausar).
--
-- IMPORTANTE: recria o CHECK com a UNIÃO COMPLETA dos tipos que o código insere
-- hoje — escalar, pausar, ativar, vault_save, mark_done. (Auditoria mostrou que
-- o CHECK vivo estava em ['escalar','pausar','vault_save'] — a 0015 que adiciona
-- 'mark_done' não chegou a ser aplicada, então a rota mark-done estava falhando
-- em prod. Esta migration conserta isso de quebra.)
--
-- Aditivo e idempotente: dropa o CHECK antigo (qualquer nome via DROP IF EXISTS
-- do nome canônico) e recria com o conjunto completo. Não toca em dados.

ALTER TABLE criativo_acoes_log
  DROP CONSTRAINT IF EXISTS criativo_acoes_log_tipo_check;

ALTER TABLE criativo_acoes_log
  ADD CONSTRAINT criativo_acoes_log_tipo_check
  CHECK (tipo IN ('escalar', 'pausar', 'ativar', 'vault_save', 'mark_done'));
