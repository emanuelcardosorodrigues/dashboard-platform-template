-- 0011_criativo_ltv.sql
-- LTV/recompra/NPS por criativo (first-touch).
-- Backfill via cron (PR 12) cruza transacoes (email × ad_id da PRIMEIRA compra)
-- com todas compras subsequentes do mesmo email.

CREATE TABLE IF NOT EXISTS criativo_ltv (
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_id              text NOT NULL,
  email              text NOT NULL,
  primeira_compra    date,
  total_compras      int DEFAULT 1,
  ltv_bruto          numeric DEFAULT 0,
  ltv_liquido        numeric DEFAULT 0,
  dias_ate_recompra  int,
  nps_score          int CHECK (nps_score IS NULL OR nps_score BETWEEN 0 AND 10),
  nps_categoria      text CHECK (nps_categoria IN ('promotor','neutro','detrator') OR nps_categoria IS NULL),
  nps_respondido_em  timestamptz,
  ultima_atualizacao timestamptz DEFAULT now(),
  PRIMARY KEY (workspace_id, ad_id, email)
);

CREATE INDEX IF NOT EXISTS criativo_ltv_ad_idx
  ON criativo_ltv (workspace_id, ad_id);

CREATE INDEX IF NOT EXISTS criativo_ltv_email_idx
  ON criativo_ltv (workspace_id, email);
