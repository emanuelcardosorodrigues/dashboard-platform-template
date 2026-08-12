-- 0044_funis_config.sql — Funis configuráveis no admin.
-- Substitui (gradualmente) a régua hard-coded de classificação (produtoToTipo /
-- resolveFunil / produtoToFunil / produtoBumpDefault). Cada funil define seus
-- PRODUTOS (match por nome/ID + papel front/ob/upsell/downsell) e as CAMPANHAS
-- (tokens p/ atribuir o gasto). ADITIVA: enquanto a tabela está vazia, o engine
-- (lib/funisConfig.ts) usa DEFAULT_FUNIS — comportamento idêntico ao de hoje.
-- O seed abaixo é o espelho 1:1 de DEFAULT_FUNIS (COL/DPL/LPS/PLO).

CREATE TABLE IF NOT EXISTS funis (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  slug          text NOT NULL,
  ordem         smallint NOT NULL DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  cor           text,
  -- [{ match, por:'nome'|'id', papel:'front'|'ob'|'upsell'|'downsell', ordemOb? }]
  produtos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- { habilitado, tokens:[], campos:['ad_name','sck','campaign_name'] }
  campanhas     jsonb NOT NULL DEFAULT '{"habilitado":true,"tokens":[],"campos":["ad_name","sck","campaign_name"]}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS funis_ws_slug_uidx ON funis (workspace_id, slug);
CREATE INDEX IF NOT EXISTS funis_ws_ordem_idx ON funis (workspace_id, ordem);

-- ── Seed DEMO (espelho de DEFAULT_FUNIS). ON CONFLICT DO NOTHING = re-rodável. ──
INSERT INTO funis (workspace_id, nome, slug, ordem, ativo, cor, produtos, campanhas) VALUES
('faafca5a-fb53-404f-8469-499d8869944c', 'COL', 'col', 1, true, '#06B6D4',
 '[{"match":"calculadora","por":"nome","papel":"front"},
   {"match":"script","por":"nome","papel":"ob","ordemOb":1},
   {"match":"tribut","por":"nome","papel":"ob","ordemOb":2},
   {"match":"dentista","por":"nome","papel":"ob","ordemOb":3},
   {"match":"manual","por":"nome","papel":"ob","ordemOb":4}]'::jsonb,
 '{"habilitado":true,"tokens":["col"],"campos":["ad_name","sck","campaign_name"]}'::jsonb),
('faafca5a-fb53-404f-8469-499d8869944c', 'DPL', 'dpl', 2, true, '#F59E0B',
 '[{"match":"dentista","por":"nome","papel":"front"}]'::jsonb,
 '{"habilitado":true,"tokens":["dpl"],"campos":["ad_name","sck","campaign_name"]}'::jsonb),
('faafca5a-fb53-404f-8469-499d8869944c', 'LPS', 'lps', 3, true, '#10B981',
 '[{"match":"imers","por":"nome","papel":"front"}]'::jsonb,
 '{"habilitado":true,"tokens":["lps"],"campos":["ad_name","sck","campaign_name"]}'::jsonb),
('faafca5a-fb53-404f-8469-499d8869944c', 'PLO', 'plo', 4, true, '#A78BFA',
 '[{"match":"implementa express","por":"nome","papel":"downsell"},
   {"match":"implementa","por":"nome","papel":"upsell"},
   {"match":"protocolo lucro oculto","por":"nome","papel":"front"}]'::jsonb,
 '{"habilitado":true,"tokens":["plo"],"campos":["ad_name","sck","campaign_name"]}'::jsonb)
ON CONFLICT (workspace_id, slug) DO NOTHING;
