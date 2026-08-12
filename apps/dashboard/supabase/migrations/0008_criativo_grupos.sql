-- 0008_criativo_grupos.sql
-- Grupos persistentes de criativos (presets/custom/derivados).
-- Substitui o localStorage atual; user_email=null = compartilhado com workspace.

CREATE TABLE IF NOT EXISTS criativo_grupos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_email   text,
  nome         text NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('preset','custom','derivado')),
  filtro       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordem        int DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS criativo_grupos_workspace_idx
  ON criativo_grupos (workspace_id, ordem);

CREATE INDEX IF NOT EXISTS criativo_grupos_user_idx
  ON criativo_grupos (workspace_id, user_email) WHERE user_email IS NOT NULL;
