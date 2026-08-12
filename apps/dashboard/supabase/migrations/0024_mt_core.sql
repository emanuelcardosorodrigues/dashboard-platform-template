-- 0024_mt_core.sql — Multi-tenant Onda 1 (núcleo): meta_ads, transacoes, qualificacao
--
-- Adiciona workspace_id (FK → workspaces) nas 3 tabelas de maior volume e
-- backfilla TODAS as linhas existentes para o workspace DEMO. 100% ADITIVO:
-- não dropa nem altera nenhuma constraint/PK existente, então não pode quebrar
-- o que já roda. As constraints únicas compostas (ex: qualificacao por
-- workspace_id+email) só entram na onda que liga a escrita de um 2º tenant
-- (roteamento Hotmart) — até lá o ad_id/hotmart_id já são globalmente únicos.
--
-- DEMO workspace id = faafca5a-fb53-404f-8469-499d8869944c (slug 'demo').
-- Idempotente: pode rodar de novo sem efeito (IF NOT EXISTS + WHERE IS NULL).

-- ── meta_ads ──────────────────────────────────────────────────────────────
ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE meta_ads SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE meta_ads ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS meta_ads_ws_data_idx ON meta_ads (workspace_id, data);

-- ── transacoes ────────────────────────────────────────────────────────────
ALTER TABLE transacoes ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE transacoes SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE transacoes ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS transacoes_ws_data_idx ON transacoes (workspace_id, data);

-- ── qualificacao ──────────────────────────────────────────────────────────
ALTER TABLE qualificacao ADD COLUMN IF NOT EXISTS workspace_id uuid DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id);
UPDATE qualificacao SET workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' WHERE workspace_id IS NULL;
ALTER TABLE qualificacao ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS qualificacao_ws_email_idx ON qualificacao (workspace_id, email);
