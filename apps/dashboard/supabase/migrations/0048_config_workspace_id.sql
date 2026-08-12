-- 0048_config_workspace_id.sql
-- P0 vazamento cross-tenant (Fase 2 #2/#3): a tabela `config` não tinha
-- workspace_id, então os 3 tenants (demo/lrm/thm) compartilhavam a MESMA linha
-- (preco_mentoria etc.). Migration 0027 particionou lead_score_config,
-- vsl_player_map, acoes_vendas, column_presets, bot_uids — mas ESQUECEU config.
-- Aqui completamos: coluna workspace_id + PK composta. Backfill p/ DEMO (dono
-- da única linha existente). Aditiva; a PK antiga (chave) vira (workspace_id, chave).

ALTER TABLE config ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

-- As linhas existentes são do DEMO (tenant original single-tenant)
UPDATE config SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'demo')
WHERE workspace_id IS NULL;

ALTER TABLE config ALTER COLUMN workspace_id SET NOT NULL;

-- PK passa a ser composta (workspace_id, chave) — permite mesma chave por tenant
ALTER TABLE config DROP CONSTRAINT config_pkey;
ALTER TABLE config ADD PRIMARY KEY (workspace_id, chave);
