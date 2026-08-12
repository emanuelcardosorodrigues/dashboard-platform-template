-- 0026_mt_funnel.sql — Multi-tenant Onda 1 (funil A/B + quiz): impressions,
-- experiments, quiz_quizzes, quiz_sessions, quiz_funnel_daily. Aditivo + backfill
-- p/ DEMO. Ver 0024. Slugs de quiz e ids de experiment podem colidir entre
-- clientes; a unique composta entra quando o 2º tenant começa a escrever.

-- ── impressions (append-only A/B; ~900 linhas hoje) ───────────────────────
ALTER TABLE impressions ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE impressions SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE impressions ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS impressions_ws_exp_idx ON impressions (workspace_id, experiment_id);

-- ── experiments ───────────────────────────────────────────────────────────
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE experiments SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE experiments ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS experiments_ws_idx ON experiments (workspace_id);

-- ── quiz_quizzes ──────────────────────────────────────────────────────────
ALTER TABLE quiz_quizzes ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE quiz_quizzes SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE quiz_quizzes ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS quiz_quizzes_ws_idx ON quiz_quizzes (workspace_id);

-- ── quiz_sessions ─────────────────────────────────────────────────────────
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE quiz_sessions SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE quiz_sessions ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS quiz_sessions_ws_slug_idx ON quiz_sessions (workspace_id, quiz_slug);

-- ── quiz_funnel_daily ─────────────────────────────────────────────────────
-- ATENÇÃO: quiz_funnel_daily é uma MATERIALIZED VIEW (não tabela) — não aceita
-- ADD COLUMN. Ela herda workspace_id quando recriarmos a definição p/ selecionar
-- + agrupar por workspace_id da(s) tabela(s) base (quiz_sessions). Feito em
-- migration separada (0028_mt_quiz_funnel_matview.sql), após obter a definição
-- atual via: SELECT definition FROM pg_matviews WHERE matviewname='quiz_funnel_daily';
