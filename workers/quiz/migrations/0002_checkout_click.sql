-- 0002_checkout_click.sql — libera checkout_click + adiciona contagem na view de funil
-- Rodar no Supabase SQL Editor (projeto SEU_PROJECT_REF). Idempotente.
-- O front-end (quiz-engine-v1.js) já dispara checkout_click; o banco rejeitava pelo CHECK.
-- A partir daqui os cliques passam a ser gravados (histórico fica zerado — forward-only).

-- 1. Libera o evento checkout_click no CHECK constraint de quiz_events
ALTER TABLE public.quiz_events DROP CONSTRAINT IF EXISTS quiz_events_event_type_check;
ALTER TABLE public.quiz_events ADD CONSTRAINT quiz_events_event_type_check
  CHECK (event_type IN ('step_view','step_answer','step_back','dropout','complete','checkout_click'));

-- 2. Recria a materialized view com a coluna checkout_clicks.
--    Mat view não tem ADD COLUMN — precisa DROP + CREATE. O pg_cron 'quiz-funnel-refresh'
--    referencia por NOME, então recriar com o mesmo nome mantém o cron intacto.
DROP MATERIALIZED VIEW IF EXISTS public.quiz_funnel_daily;
CREATE MATERIALIZED VIEW public.quiz_funnel_daily AS
SELECT
  quiz_slug,
  (ts AT TIME ZONE 'America/Sao_Paulo')::DATE AS day,
  step_index,
  step_id,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'step_view')      AS views,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'step_answer')    AS answers,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'dropout')        AS dropouts,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'complete')       AS completions,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'checkout_click') AS checkout_clicks
FROM public.quiz_events
GROUP BY 1, 2, 3, 4;

-- Índice unique necessário para REFRESH CONCURRENTLY (usado pelo pg_cron a cada 15min)
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_funnel_daily_pk
  ON public.quiz_funnel_daily(quiz_slug, day, step_index, step_id);

COMMENT ON MATERIALIZED VIEW public.quiz_funnel_daily IS
  'Funil agregado por dia/step (+ checkout_clicks). Atualizada a cada 15min via pg_cron. Dashboard lê APENAS daqui.';

-- 3. Primeira carga (não-concurrent, view recém-criada)
REFRESH MATERIALIZED VIEW public.quiz_funnel_daily;
