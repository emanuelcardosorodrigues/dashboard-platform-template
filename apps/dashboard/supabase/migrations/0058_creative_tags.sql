-- 0058_creative_tags.sql
-- Tags personalizadas de criativos (A-F2): catálogo por workspace + atribuições
-- por ad_id. namespace/source separam a tag MANUAL (usuário) da do ODIN (taxonomia
-- IA já existente) e da do EQUIPE (auto-tag agêntica); o filtro unifica as três.
-- Aditiva. RLS deny-all (service-role only), mesmo molde de checkout_hits (0051).

CREATE TABLE IF NOT EXISTS creative_tags (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id) ON DELETE CASCADE,
  namespace     text NOT NULL DEFAULT 'manual' CHECK (namespace IN ('manual','odin','equipe')),
  slug          text NOT NULL,
  label         text NOT NULL,
  color         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, namespace, slug)
);

CREATE TABLE IF NOT EXISTS creative_tag_assignments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id) ON DELETE CASCADE,
  tag_id        bigint NOT NULL REFERENCES creative_tags(id) ON DELETE CASCADE,
  ad_ref        text NOT NULL,                 -- ad_id (chave estável do Meta)
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','odin','equipe')),
  assigned_by   text,
  confidence    real,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tag_id, ad_ref)
);

CREATE INDEX IF NOT EXISTS idx_cta_ws_tag ON creative_tag_assignments (workspace_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_cta_ws_ad  ON creative_tag_assignments (workspace_id, ad_ref);

ALTER TABLE creative_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_tag_assignments ENABLE ROW LEVEL SECURITY;
