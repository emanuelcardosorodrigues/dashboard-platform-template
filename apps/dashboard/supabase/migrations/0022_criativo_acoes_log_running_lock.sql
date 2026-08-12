-- 0022_criativo_acoes_log_running_lock.sql
-- Lock ATÔMICO contra duplo-clique / ações concorrentes no mesmo anúncio.
--
-- O soft-lock em criativo-acoes.ts (SELECT count → INSERT) tem janela TOCTOU:
-- dois POSTs simultâneos podem passar no count e os dois executar no Meta.
-- 'escalar' é coberto pelo compare-and-set (2º write → 409), mas 'pausar'/'ativar'
-- não têm compare-and-set. Este índice único parcial garante no banco que só
-- existe UMA ação 'running' por (workspace_id, ad_id) — o 2º INSERT falha com
-- 23505, que o executor traduz em CriativoAcaoLockError (409).
--
-- Preâmbulo: mata 'running' zumbis (>5min, mesmo cutoff do watchdog) antes de
-- criar o índice, senão a criação falha se houver duplicatas pendentes.

UPDATE criativo_acoes_log
  SET status = 'failed',
      error_message = 'cleanup pré-índice único (0022)',
      concluido_em = now()
  WHERE status = 'running'
    AND iniciado_em < now() - interval '5 minutes';

CREATE UNIQUE INDEX IF NOT EXISTS criativo_acoes_log_running_uniq
  ON criativo_acoes_log (workspace_id, ad_id)
  WHERE status = 'running';
