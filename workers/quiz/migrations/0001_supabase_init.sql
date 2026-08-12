-- ============================================================================
-- dashboard-quiz — Supabase migration 0001 (init)
-- ============================================================================
-- Cole este arquivo INTEIRO no SQL Editor do Supabase (projeto demo-dashboard-demo)
-- e clique "Run". Tudo está dentro de uma transação — se algo falhar, nada é
-- aplicado. Idempotente: usa IF NOT EXISTS em índices e CREATE OR REPLACE
-- onde possível. As tabelas usam "CREATE TABLE" simples — se já existirem,
-- a transação aborta e nada é commitado.
--
-- Pré-requisito: extensão pg_cron habilitada no projeto Supabase. Verificar em:
-- Database → Extensions → pg_cron (ativar se vermelho).
--
-- ROLLBACK manual (se precisar desfazer):
--   SELECT cron.unschedule('quiz-funnel-refresh');
--   DROP MATERIALIZED VIEW IF EXISTS public.quiz_funnel_daily;
--   DROP TABLE IF EXISTS public.quiz_events;
--   DROP TABLE IF EXISTS public.quiz_sessions;
--   DROP TABLE IF EXISTS public.quiz_quizzes;
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. quiz_quizzes — config canônica de cada quiz (espelho do KV)
-- ----------------------------------------------------------------------------
CREATE TABLE public.quiz_quizzes (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  config       JSONB NOT NULL,
  webhook_url  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.quiz_quizzes IS
  'Config canônica de cada quiz. Espelhada no Cloudflare KV (chave quiz:{slug}). Editada via dashboard /quizzes.';

-- Trigger pra updated_at
CREATE OR REPLACE FUNCTION public.quiz_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quiz_quizzes_set_updated_at
  BEFORE UPDATE ON public.quiz_quizzes
  FOR EACH ROW EXECUTE FUNCTION public.quiz_set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. quiz_sessions — uma row por user/quiz/dia (session_id determinístico)
-- ----------------------------------------------------------------------------
CREATE TABLE public.quiz_sessions (
  session_id     TEXT PRIMARY KEY,
  uid            TEXT NOT NULL,
  quiz_slug      TEXT NOT NULL REFERENCES public.quiz_quizzes(slug) ON DELETE CASCADE,
  utms           JSONB,
  ua             TEXT,
  ua_simple      TEXT,
  ip_country     TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  lead_data      JSONB,
  bot_filtered   BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_slug_started
  ON public.quiz_sessions(quiz_slug, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_uid
  ON public.quiz_sessions(uid);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_completed
  ON public.quiz_sessions(quiz_slug, completed_at DESC)
  WHERE completed_at IS NOT NULL;

COMMENT ON TABLE public.quiz_sessions IS
  'Sessões de quiz. session_id = murmurhash3(uid:slug:dia_UTC) — sobrevive reload, reseta meia-noite UTC.';

-- ----------------------------------------------------------------------------
-- 3. quiz_events — append-only, granular (step_view, step_answer, dropout, etc)
-- ----------------------------------------------------------------------------
CREATE TABLE public.quiz_events (
  id           BIGSERIAL PRIMARY KEY,
  session_id   TEXT NOT NULL,
  quiz_slug    TEXT NOT NULL,
  attempt_id   TEXT,
  event_type   TEXT NOT NULL
                 CHECK (event_type IN ('step_view', 'step_answer', 'step_back', 'dropout', 'complete')),
  step_index   INTEGER,
  step_id      TEXT,
  answer       JSONB,
  metadata     JSONB,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_events_slug_ts
  ON public.quiz_events(quiz_slug, ts DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_events_session
  ON public.quiz_events(session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_events_type_slug
  ON public.quiz_events(event_type, quiz_slug);

COMMENT ON TABLE public.quiz_events IS
  'Eventos granulares de quiz. Append-only. Dashboard NÃO lê direto — usa quiz_funnel_daily (materialized view).';

-- ----------------------------------------------------------------------------
-- 4. quiz_funnel_daily — materialized view agregada (lida pelo dashboard)
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW public.quiz_funnel_daily AS
SELECT
  quiz_slug,
  (ts AT TIME ZONE 'America/Sao_Paulo')::DATE AS day,
  step_index,
  step_id,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'step_view')   AS views,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'step_answer') AS answers,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'dropout')     AS dropouts,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'complete')    AS completions
FROM public.quiz_events
GROUP BY 1, 2, 3, 4;

-- Índice unique necessário para REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_funnel_daily_pk
  ON public.quiz_funnel_daily(quiz_slug, day, step_index, step_id);

COMMENT ON MATERIALIZED VIEW public.quiz_funnel_daily IS
  'Funil agregado por dia/step. Atualizada a cada 15min via pg_cron. Dashboard lê APENAS daqui.';

-- ----------------------------------------------------------------------------
-- 5. pg_cron job — refresh a cada 15min
-- ----------------------------------------------------------------------------
-- Remove se já existe (idempotência)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quiz-funnel-refresh') THEN
    PERFORM cron.unschedule('quiz-funnel-refresh');
  END IF;
END $$;

SELECT cron.schedule(
  'quiz-funnel-refresh',
  '*/15 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.quiz_funnel_daily$$
);

-- ----------------------------------------------------------------------------
-- 6. Seed do quiz piloto (opcional — comentado; descomentar se quiser)
-- ----------------------------------------------------------------------------
-- INSERT INTO public.quiz_quizzes (slug, title, status, config) VALUES (
--   'diagnostico-piloto',
--   'Diagnóstico Piloto',
--   'draft',
--   '{
--     "steps": [
--       {"id": "intro", "type": "text", "title": "Vamos começar?"},
--       {"id": "q1", "type": "single_choice", "title": "Pergunta 1", "options": [{"id": "a", "label": "Opção A"}, {"id": "b", "label": "Opção B"}]},
--       {"id": "lead", "type": "form", "fields": ["name", "whatsapp", "email"]}
--     ]
--   }'::jsonb
-- );

COMMIT;

-- ============================================================================
-- Validação pós-aplicação (rode separadamente, deve retornar tudo zerado):
-- ============================================================================
-- SELECT count(*) AS quizzes  FROM public.quiz_quizzes;     -- 0
-- SELECT count(*) AS sessions FROM public.quiz_sessions;    -- 0
-- SELECT count(*) AS events   FROM public.quiz_events;      -- 0
-- SELECT count(*) AS funnel   FROM public.quiz_funnel_daily; -- 0
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'quiz-funnel-refresh';
-- -- esperado: 1 row, schedule '*/15 * * * *', active true
