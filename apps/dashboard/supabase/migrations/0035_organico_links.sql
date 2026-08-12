-- 0035_organico_links.sql — Onda 6: encurtador no domínio do cliente.
-- Cada link = slug no Worker CF do cliente que 302-redireciona carimbando
-- utm_source=organico & utm_medium={plataforma} & utm_content={post} & sck —
-- o webhook Hotmart grava utm_content em `transacoes.criativo`, fechando o
-- loop post orgânico → venda. Aditiva, RLS deny-all.

CREATE TABLE IF NOT EXISTS organic_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug            text NOT NULL,
  destination_url text NOT NULL,
  platform        text CHECK (platform IN ('youtube','instagram','tiktok')),
  post_external_id text,           -- external_id do organic_posts (vira utm_content)
  utm_content     text NOT NULL,
  sck             text,
  clicks          bigint NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_organic_links_ws ON organic_links (workspace_id, created_at DESC);

ALTER TABLE organic_links ENABLE ROW LEVEL SECURITY;
