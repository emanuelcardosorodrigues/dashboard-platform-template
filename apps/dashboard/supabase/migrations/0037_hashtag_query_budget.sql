-- 0037_hashtag_query_budget.sql — Aba "Inteligência de Conteúdo" (IG Hashtag Search).
-- Usa/demonstra a permissão "Instagram Public Content Access" do App Review da Meta.
--
-- LIMITE DURO DA META: 30 hashtags ÚNICAS por conta IG a cada 7 dias (janela móvel).
-- hashtag_query_budget = orçamento persistente: 1 linha por RESOLUÇÃO de hashtag nova.
-- Antes de resolver uma hashtag inédita, conta-se as DISTINTAS dos últimos 7 dias; se
-- já houver 30, bloqueia (a UI mostra o saldo). hashtag_id resolvido é REUSADO dentro
-- da janela (não conta de novo).
--
-- hashtag_media = AGREGADO PÚBLICO persistido (ranking por hashtag) p/ a UI renderizar
-- ao recarregar SEM gastar orçamento (busca é só sob demanda, nunca cron). Guarda apenas
-- o post público (permalink + métricas públicas); NENHUM dado pessoal de autor.
--
-- Aditivas. RLS deny-all (service-role bypassa; nenhuma policy = nenhum acesso anon).

CREATE TABLE IF NOT EXISTS hashtag_query_budget (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ig_user_id   text NOT NULL,                 -- conta IG que gastou o orçamento
  hashtag      text NOT NULL,                 -- normalizada (minúscula, sem '#')
  hashtag_id   text,                          -- id do ig_hashtag_search (reuso na janela)
  queried_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hashtag_budget_ws
  ON hashtag_query_budget (workspace_id, ig_user_id, queried_at DESC);
ALTER TABLE hashtag_query_budget ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS hashtag_media (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  hashtag           text NOT NULL,
  rank_kind         text NOT NULL CHECK (rank_kind IN ('top','recent')),
  media_external_id text NOT NULL,            -- id da mídia pública (não é pessoa)
  media_type        text,
  caption           text,
  media_url         text,
  permalink         text,
  like_count        bigint,
  comments_count    bigint,
  taken_at          timestamptz,
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, hashtag, rank_kind, media_external_id)
);
CREATE INDEX IF NOT EXISTS idx_hashtag_media_ws
  ON hashtag_media (workspace_id, hashtag, fetched_at DESC);
ALTER TABLE hashtag_media ENABLE ROW LEVEL SECURITY;
