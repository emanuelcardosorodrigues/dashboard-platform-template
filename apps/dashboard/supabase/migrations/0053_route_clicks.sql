-- 0053_route_clicks.sql
-- Connect rate por variante de página: quantos dos que CLICARAM (foram roteados pelo
-- 302 do Worker /r/) realmente VIRAM a página (beacon /r/i → impressions).
--   connect rate = views (impressions) ÷ clicks (route_clicks), pela MESMA identidade (uid).
-- A diferença é a perda no salto — página lenta / desistência. Quanto menor, melhor.
--
-- Tabela SEPARADA de propósito: o clique (302) NÃO pode entrar em `impressions`, senão o
-- Thompson Sampling, o z-test e a health-view passariam a contar clique como impressão e
-- o bandit otimizaria contra clique. Nenhum leitor de `impressions` muda por causa disto.
-- Aditiva. RLS deny-all (service-role only, igual impressions/checkout_hits). ws default = DEMO.

CREATE TABLE IF NOT EXISTS route_clicks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id) ON DELETE CASCADE,
  experiment_id uuid,                          -- page experiment roteado (pode ser null em fallback)
  variant       text NOT NULL,                 -- nome da variante atribuída pelo uid (mesma do beacon)
  uid           text NOT NULL,                 -- cookie uid do Worker — MESMA identidade de impressions.uid
  ip_fp         text,
  country       text,
  dia           date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  timestamp     timestamptz NOT NULL DEFAULT now()
);

-- dedup: 1 clicante distinto (uid) por variante por dia — reload/duplo-302 não infla.
-- O connect rate lê COUNT(DISTINCT uid) na janela, então o teto é 1 clique/uid/dia/variante.
CREATE UNIQUE INDEX IF NOT EXISTS uq_route_clicks_ws_exp_variant_uid_dia
  ON route_clicks (workspace_id, experiment_id, variant, uid, dia);

-- leitura por janela de data (mesma janela das impressions) na aba Experimentos.
CREATE INDEX IF NOT EXISTS idx_route_clicks_ws_ts
  ON route_clicks (workspace_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_route_clicks_exp_ts
  ON route_clicks (experiment_id, timestamp);

ALTER TABLE route_clicks ENABLE ROW LEVEL SECURITY;
