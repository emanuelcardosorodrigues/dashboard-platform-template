-- 0063_fadiga_notificacoes.sql
-- Snapshot pro push de "criativo fadigado" (A-F6, trigger 4). Uma linha por ad_id
-- que JÁ foi avisado como saturado — pro cron disparar SÓ na virada (transição),
-- nunca todo dia. Se o anúncio recupera (sai de saturado), a linha é removida e uma
-- futura re-saturação volta a alertar. Aditiva. RLS deny-all (service-role only),
-- molde de push_subscriptions (0062).
CREATE TABLE IF NOT EXISTS fadiga_notificacoes (
  workspace_id  uuid NOT NULL DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_id         text NOT NULL,
  status        text NOT NULL,
  notified_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, ad_id)
);

ALTER TABLE fadiga_notificacoes ENABLE ROW LEVEL SECURITY;
