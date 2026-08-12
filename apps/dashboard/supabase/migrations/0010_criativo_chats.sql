-- 0010_criativo_chats.sql
-- Histórico de chats IA. Scope = 'creative' (ad específico) ou 'portfolio' (global).

CREATE TABLE IF NOT EXISTS criativo_chats (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope        text NOT NULL CHECK (scope IN ('creative','portfolio')),
  ad_id        text,
  user_email   text,
  mensagens    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS criativo_chats_scope_idx
  ON criativo_chats (workspace_id, scope, updated_at DESC);

CREATE INDEX IF NOT EXISTS criativo_chats_ad_idx
  ON criativo_chats (workspace_id, ad_id) WHERE ad_id IS NOT NULL;
