-- 0027_mt_config.sql — Multi-tenant Onda 1 (config/menores): lead_score_config,
-- vsl_player_map, acoes_vendas, column_presets, bot_uids. Aditivo + backfill.
-- lead_score_config / vsl_player_map / acoes_vendas estão VAZIAS hoje (o UPDATE
-- não afeta nada; SET NOT NULL é seguro). Ver 0024.

-- ── lead_score_config (vazia) ─────────────────────────────────────────────
ALTER TABLE lead_score_config ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE lead_score_config SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE lead_score_config ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS lead_score_config_ws_idx ON lead_score_config (workspace_id);

-- ── vsl_player_map (vazia) ────────────────────────────────────────────────
ALTER TABLE vsl_player_map ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE vsl_player_map SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE vsl_player_map ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS vsl_player_map_ws_idx ON vsl_player_map (workspace_id);

-- ── acoes_vendas (vazia) ──────────────────────────────────────────────────
ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE acoes_vendas SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE acoes_vendas ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS acoes_vendas_ws_idx ON acoes_vendas (workspace_id);

-- ── column_presets ────────────────────────────────────────────────────────
ALTER TABLE column_presets ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE column_presets SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE column_presets ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS column_presets_ws_scope_idx ON column_presets (workspace_id, scope);

-- ── bot_uids ──────────────────────────────────────────────────────────────
ALTER TABLE bot_uids ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE bot_uids SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE bot_uids ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS bot_uids_ws_idx ON bot_uids (workspace_id);
