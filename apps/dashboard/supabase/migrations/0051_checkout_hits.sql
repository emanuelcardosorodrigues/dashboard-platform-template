-- 0051_checkout_hits.sql
-- Cobertura universal de "passagem pro checkout" na Análise de Páginas.
-- Uma tag GTM dispara no clique do CTA de checkout e faz beacon pra /api/checkout-hit.
-- Guarda 1 clicante distinto (cid = GA client id) por página por dia — assim a
-- passagem existe pra QUALQUER página, não só as que rodam teste A/B de checkout.
-- Aditiva. RLS deny-all (service-role only). workspace_id default = DEMO.

CREATE TABLE IF NOT EXISTS checkout_hits (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  cid           text NOT NULL,                 -- GA client id (ou fingerprint ip+ua se ausente)
  dia           date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- dedup: 1 clicante distinto (cid) por página por dia — upsert on conflict do nothing
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_hits_ws_slug_cid_dia
  ON checkout_hits (workspace_id, slug, cid, dia);

-- leitura por janela de data na Análise de Páginas
CREATE INDEX IF NOT EXISTS idx_checkout_hits_ws_dia
  ON checkout_hits (workspace_id, dia);

ALTER TABLE checkout_hits ENABLE ROW LEVEL SECURITY;
