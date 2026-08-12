-- 0059_perpetuo_graphs.sql
-- Editor do funil perpétuo (Track B / B-P0): layout salvo por (workspace, funil).
-- Guarda só a TOPOLOGIA e a POSIÇÃO (nodes/edges/viewport em jsonb) + os nós
-- custom que o usuário inseriu. As MÉTRICAS não são persistidas aqui — são
-- reinjetadas frescas a cada load (computePeriodSummary), pra não congelar dado.
-- Aditiva. RLS deny-all (service-role only), mesmo molde de creative_tags (0058).

CREATE TABLE IF NOT EXISTS perpetuo_graphs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id) ON DELETE CASCADE,
  funil_slug    text NOT NULL,
  nodes         jsonb NOT NULL DEFAULT '[]'::jsonb,
  edges         jsonb NOT NULL DEFAULT '[]'::jsonb,
  viewport      jsonb,
  updated_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, funil_slug)
);

ALTER TABLE perpetuo_graphs ENABLE ROW LEVEL SECURITY;
