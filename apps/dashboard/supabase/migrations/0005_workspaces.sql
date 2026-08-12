-- 0005_workspaces.sql
-- Multi-tenant foundation para /criativos v2.
-- Cada workspace tem avatar + One Belief + vocabulário taxonômico próprios.
-- DEMO + 4 clientes Empresa Exemplo (cli-saude, cli-moda, cli-emag, cli-fert).
-- RLS é adicionada em PR 16; aqui só a estrutura.

CREATE TABLE IF NOT EXISTS workspaces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  nome          text NOT NULL,
  one_belief    text,
  avatar_brief  text,
  vocabulario   jsonb DEFAULT '{}'::jsonb,
  thresholds    jsonb DEFAULT '{}'::jsonb,
  vault_domains jsonb DEFAULT '[]'::jsonb,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_email   text NOT NULL,
  role         text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (workspace_id, user_email)
);

CREATE INDEX IF NOT EXISTS workspace_members_email_idx ON workspace_members (user_email);
