-- 0031_organico_instagram.sql — Área ORGÂNICO, Onda 2: Stories do Instagram +
-- agendamento dos syncs IG.
--
-- Stories têm tabela própria porque o ciclo de vida é outro: insights só são
-- consultáveis ENQUANTO o story está vivo (24h) → poll de 3/3h + webhook
-- story_insights (dispara na expiração com métricas finais). 1 linha = 1 frame;
-- "sessões" (sequências com gap < 30min) são derivadas em código, não no banco.
-- Métricas NULLABLE = API não retornou (gap honesto; IG suprime <5 views).

CREATE TABLE IF NOT EXISTS organic_stories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES organic_accounts(id) ON DELETE CASCADE,
  external_id   text NOT NULL,
  media_type    text,                      -- IMAGE | VIDEO
  thumbnail_url text,
  permalink     text,
  published_at  timestamptz NOT NULL,
  expires_at    timestamptz,               -- published_at + 24h
  -- métricas (atualizadas no poll; finais via webhook na expiração)
  views            bigint,
  reach            bigint,
  replies          bigint,                 -- 0 p/ viewers EU/JP (privacidade) — nunca alertar
  shares           bigint,
  profile_visits   bigint,
  follows          bigint,
  taps_forward     bigint,
  taps_back        bigint,
  exits            bigint,
  swipes_forward   bigint,
  finalized        boolean NOT NULL DEFAULT false,
  last_polled_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_organic_stories_ws_pub ON organic_stories (workspace_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_organic_stories_live ON organic_stories (workspace_id, finalized) WHERE finalized = false;

ALTER TABLE organic_stories ENABLE ROW LEVEL SECURITY;

-- Agendamentos via pg_cron+pg_net (padrão setup-pgcron-sync-meta.sql; Vault já
-- tem dash_base_url/dash_cron_secret).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-instagram-6h') THEN
    PERFORM cron.unschedule('sync-instagram-6h');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-instagram-stories-3h') THEN
    PERFORM cron.unschedule('sync-instagram-stories-3h');
  END IF;
END $$;

-- media+perfil 4×/dia (00:15/06:15/12:15/18:15 UTC)
SELECT cron.schedule(
  'sync-instagram-6h',
  '15 */6 * * *',
  $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url') || '/api/cron/sync-instagram',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')),
    timeout_milliseconds := 290000
  );
  $$
);

-- stories vivos 8×/dia (a cada 3h, :45) — janela de 24h nunca fica sem poll
SELECT cron.schedule(
  'sync-instagram-stories-3h',
  '45 */3 * * *',
  $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url') || '/api/cron/sync-instagram-stories',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')),
    timeout_milliseconds := 120000
  );
  $$
);
