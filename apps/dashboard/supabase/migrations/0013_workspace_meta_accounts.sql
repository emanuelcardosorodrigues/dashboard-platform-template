-- 0013_workspace_meta_accounts.sql
-- Mapa N:1 entre contas Meta (act_XXXX) e workspaces. Cada account_id
-- pode pertencer a UM workspace. Workspace pode ter várias contas Meta
-- (ex: holding com múltiplos perfis publicitários).
--
-- Necessário pra resolver workspace dado um ad_id de um endpoint que
-- só tem account_id no contexto (ex: webhook Meta, leitura ad-hoc).

CREATE TABLE IF NOT EXISTS workspace_meta_accounts (
  account_id    text PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rotulo        text,
  criado_em     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_meta_accounts_ws_idx
  ON workspace_meta_accounts (workspace_id);

-- Seed inicial: liga as contas atuais ao workspace 'demo' (ajustar se outro
-- slug for o default). Execute APÓS a tabela 'workspaces' já ter a linha 'demo'.
-- IDs vêm de META_ACCOUNT_IDS do .env (CSV).
--
-- Exemplo manual:
--   INSERT INTO workspace_meta_accounts (account_id, workspace_id, rotulo)
--   SELECT '111111111111111', id, 'DEMO principal' FROM workspaces WHERE slug = 'demo'
--   ON CONFLICT (account_id) DO NOTHING;
