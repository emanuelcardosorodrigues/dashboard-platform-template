-- 0012_criativo_acoes_log.sql
-- Audit trail de ações reais no Meta (pausar/escalar). Toda execução de
-- sugestão grava 1 linha aqui ANTES da chamada à Graph API, e atualiza
-- result/status depois. Permite reconstruir histórico sem depender só de
-- decisao_diff em criativo_sugestoes.

CREATE TABLE IF NOT EXISTS criativo_acoes_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sugestao_id   uuid REFERENCES criativo_sugestoes(id) ON DELETE SET NULL,
  ad_id         text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('escalar','pausar')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  resultado     jsonb,
  error_message text,
  executado_por text,
  iniciado_em   timestamptz DEFAULT now(),
  concluido_em  timestamptz
);

CREATE INDEX IF NOT EXISTS criativo_acoes_log_ad_idx
  ON criativo_acoes_log (workspace_id, ad_id, iniciado_em DESC);

CREATE INDEX IF NOT EXISTS criativo_acoes_log_sug_idx
  ON criativo_acoes_log (sugestao_id) WHERE sugestao_id IS NOT NULL;
