-- 0009_criativo_sugestoes.sql
-- Cowork queue: sugestões pendentes que humano aprova antes de virar ação real.
-- Nada é executado autopilot — pausar/escalar/salvar-no-vault sempre passa por aqui.
-- Origem do guardrail: mind-vault [b4crjq2vat53].

CREATE TABLE IF NOT EXISTS criativo_sugestoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN (
                  'escalar','pausar','novo_brief','lateralizar',
                  'congruencia_fix','vault_save'
                )),
  ad_id         text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN (
                  'pending','approved','rejected','edited','executed'
                )),
  decisao_por   text,
  decisao_em    timestamptz,
  decisao_diff  jsonb,
  custo_usd     numeric,
  modelo        text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS criativo_sugestoes_status_idx
  ON criativo_sugestoes (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS criativo_sugestoes_ad_idx
  ON criativo_sugestoes (workspace_id, ad_id) WHERE ad_id IS NOT NULL;
