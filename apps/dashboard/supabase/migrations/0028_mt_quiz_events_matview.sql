-- 0028_mt_quiz_events_matview.sql — Multi-tenant Onda 1 (parte 2):
-- (a) workspace_id na tabela base quiz_events (alimenta o matview);
-- (b) recria o matview quiz_funnel_daily carregando workspace_id;
-- (c) SET DEFAULT DEMO em TODAS as colunas workspace_id já criadas — os writers
--     atuais (cron sync-meta */30, webhooks Hotmart/ficha, worker de quiz)
--     ainda NÃO mandam workspace_id; o default garante que continuem gravando
--     (como DEMO) até o código dos writers passar a mandar explícito (Onda 5/8,
--     quando dropamos o default). Sem isto, o NOT NULL quebraria as escritas.

-- ── (c) DEFAULT DEMO nas colunas já criadas (writers legados) ───────────────
DO $$
DECLARE
  demo uuid := 'faafca5a-fb53-404f-8469-499d8869944c';
  t text;
  tabelas text[] := ARRAY[
    'meta_ads','transacoes','qualificacao','clarity_daily','vturb_creative_daily',
    'ai_insights','impressions','experiments','quiz_quizzes','quiz_sessions',
    'lead_score_config','vsl_player_map','acoes_vendas','column_presets','bot_uids'];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN workspace_id SET DEFAULT %L', t, demo);
  END LOOP;
END $$;

-- ── (a) quiz_events ───────────────────────────────────────────────────────
ALTER TABLE quiz_events ADD COLUMN IF NOT EXISTS workspace_id uuid
  DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE quiz_events SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE quiz_events ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS quiz_events_ws_slug_idx ON quiz_events (workspace_id, quiz_slug);

-- ── (b) recria matview quiz_funnel_daily carregando workspace_id ───────────
-- Mesma lógica da definição original + workspace_id no SELECT e no GROUP BY.
DROP MATERIALIZED VIEW IF EXISTS quiz_funnel_daily;
CREATE MATERIALIZED VIEW quiz_funnel_daily AS
SELECT
  workspace_id,
  quiz_slug,
  ((ts AT TIME ZONE 'America/Sao_Paulo'::text))::date AS day,
  step_index,
  step_id,
  count(DISTINCT session_id) FILTER (WHERE event_type = 'step_view'::text)      AS views,
  count(DISTINCT session_id) FILTER (WHERE event_type = 'step_answer'::text)    AS answers,
  count(DISTINCT session_id) FILTER (WHERE event_type = 'dropout'::text)        AS dropouts,
  count(DISTINCT session_id) FILTER (WHERE event_type = 'complete'::text)       AS completions,
  count(DISTINCT session_id) FILTER (WHERE event_type = 'checkout_click'::text) AS checkout_clicks
FROM quiz_events
GROUP BY workspace_id, quiz_slug, (((ts AT TIME ZONE 'America/Sao_Paulo'::text))::date), step_index, step_id;

-- índice único no grain (inclui workspace_id) — habilita REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS quiz_funnel_daily_grain_idx
  ON quiz_funnel_daily (workspace_id, quiz_slug, day, step_index, step_id);
