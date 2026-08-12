-- 0025_mt_analytics.sql — Multi-tenant Onda 1 (analytics): clarity_daily,
-- vturb_creative_daily, ai_insights. Aditivo + backfill p/ DEMO. Ver 0024.
-- clarity_daily e ai_insights têm chave natural que PODE colidir entre clientes
-- (mesma URL/dia); a troca da unique composta entra na onda de escrita do 2º
-- tenant. Aqui só adicionamos a coluna (DEMO não colide consigo mesmo).

-- ── clarity_daily ─────────────────────────────────────────────────────────
ALTER TABLE clarity_daily ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE clarity_daily SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE clarity_daily ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS clarity_daily_ws_data_idx ON clarity_daily (workspace_id, data);

-- ── vturb_creative_daily ──────────────────────────────────────────────────
ALTER TABLE vturb_creative_daily ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE vturb_creative_daily SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE vturb_creative_daily ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS vturb_creative_daily_ws_day_idx ON vturb_creative_daily (workspace_id, day);

-- ── ai_insights ───────────────────────────────────────────────────────────
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE ai_insights SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE ai_insights ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS ai_insights_ws_data_idx ON ai_insights (workspace_id, data);
