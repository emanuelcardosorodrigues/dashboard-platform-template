-- 0030_organico_core.sql — Área ORGÂNICO, Onda 1: contas conectadas, posts,
-- séries diárias, curva de retenção (YT), perfil diário e snapshots de audiência.
--
-- Princípios (mesmos das 0024-0029): 100% ADITIVA; workspace_id + UNIQUE/PK
-- compostas desde o dia 1 (multi-tenant nativo, sem onda de "compostas depois");
-- métricas NULLABLE — NULL = "API não retornou" (gap honesto), nunca 0 silencioso;
-- RLS deny-all (só service-role acessa).
--
-- Janelas de retenção das APIs que tornam o warehouse obrigatório:
--   IG follower_count = só 30 dias · IG media insights = só 2 anos ·
--   TikTok account daily = só 60 dias · TikTok por vídeo = lifetime snapshot.

-- 1) providers novos no cofre de credenciais (youtube/instagram/tiktok = OAuth)
ALTER TABLE workspace_credentials DROP CONSTRAINT IF EXISTS workspace_credentials_provider_check;
ALTER TABLE workspace_credentials ADD CONSTRAINT workspace_credentials_provider_check
  CHECK (provider IN ('meta','vturb','ga4','clarity','hotmart','cloudflare','nfse','youtube','instagram','tiktok'));

-- 2) contas orgânicas conectadas (multi-conta por workspace nativo)
CREATE TABLE IF NOT EXISTS organic_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('youtube','instagram','tiktok')),
  external_id   text NOT NULL,            -- UC… / IG user id / TikTok business id
  handle        text,
  display_name  text,
  avatar_url    text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','token_expired','disconnected')),
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- uploads_playlist_id, reporting_job_ids, page_id…
  connected_at  timestamptz NOT NULL DEFAULT now(),
  last_sync_at  timestamptz,
  last_error    text,
  UNIQUE (workspace_id, platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_organic_accounts_ws ON organic_accounts (workspace_id, platform);

-- 3) posts/vídeos (1 linha = 1 conteúdo; snapshot lifetime + derivados)
CREATE TABLE IF NOT EXISTS organic_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES organic_accounts(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('youtube','instagram','tiktok')),
  external_id   text NOT NULL,
  format        text CHECK (format IN ('long','short','reel','feed','carousel','live')),
  title         text,
  caption       text,
  thumbnail_url text,
  permalink     text,
  published_at  timestamptz NOT NULL,
  duration_seconds numeric,
  hashtags      text[] DEFAULT '{}',
  -- snapshot lifetime (NULL = sem dado na API; nunca coagir a 0)
  views               bigint,
  engaged_views       bigint,   -- YT (Shorts: views é inflado desde 2025 → usar engaged)
  reach               bigint,
  likes               bigint,
  comments_count      bigint,
  shares              bigint,
  saves               bigint,
  follows             bigint,   -- IG: follows a partir do post (não-Reels)
  impressions         bigint,   -- YT Reporting (thumbnail impressions)
  impressions_ctr     numeric,  -- YT Reporting (%)
  apv                 numeric,  -- YT averageViewPercentage (%)
  avg_watch_time_s    numeric,  -- YT AVD / IG Reels avg / TikTok average_time_watched
  total_watch_time_s  numeric,
  completion_rate     numeric,  -- TikTok full_video_watched_rate (%)
  skip_rate           numeric,  -- IG reels_skip_rate (%)
  subs_gained         bigint,   -- YT por vídeo
  subs_lost           bigint,
  profile_visits      bigint,
  -- derivados (cron organic-insights; determinístico, vs MEDIANA do cohort)
  first7_views        bigint,
  first7_engagement   bigint,
  first7_locked       boolean NOT NULL DEFAULT false,
  composite_score     numeric,
  outlier_score       numeric,
  -- classificação IA com vocabulário FIXO (Onda 5; taxonomia DEMO)
  gancho_codigo       text,
  estrutura           text,
  tema                text,
  thumb_elementos     text[] DEFAULT '{}',
  -- jsonb de detalhe
  traffic_sources     jsonb,    -- YT insightTrafficSourceType % / TikTok impression_sources %
  search_terms        jsonb,    -- YT termos de busca (top-N)
  subscribed_status   jsonb,    -- YT views por SUBSCRIBED/UNSUBSCRIBED
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_organic_posts_ws_pub ON organic_posts (workspace_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_organic_posts_account ON organic_posts (account_id);

-- 4) série diária por post. source distingue dado diário VERDADEIRO (YT
-- analytics/reporting) de DELTA entre snapshots (IG/TikTok).
CREATE TABLE IF NOT EXISTS organic_post_metrics_daily (
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_id       uuid NOT NULL REFERENCES organic_posts(id) ON DELETE CASCADE,
  date          date NOT NULL,
  source        text NOT NULL CHECK (source IN ('analytics','reporting','snapshot_delta')),
  views             bigint,
  engaged_views     bigint,
  reach             bigint,
  likes             bigint,
  comments          bigint,
  shares            bigint,
  saves             bigint,
  follows           bigint,
  watch_time_s      numeric,
  impressions       bigint,
  impressions_ctr   numeric,
  subs_gained       bigint,
  subs_lost         bigint,
  PRIMARY KEY (workspace_id, post_id, date)
);

-- 5) curva de retenção (YouTube only — única API que expõe; 1 vídeo por query)
CREATE TABLE IF NOT EXISTS organic_retention_points (
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_id               uuid NOT NULL REFERENCES organic_posts(id) ON DELETE CASCADE,
  elapsed_ratio         numeric NOT NULL,  -- 0.00–1.00 (elapsedVideoTimeRatio)
  audience_watch_ratio  numeric,
  relative_performance  numeric,           -- vs vídeos de duração similar
  captured_at           date NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (workspace_id, post_id, elapsed_ratio)
);

-- 6) perfil/canal diário (warehouse das janelas curtas das APIs)
CREATE TABLE IF NOT EXISTS organic_profile_daily (
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES organic_accounts(id) ON DELETE CASCADE,
  date          date NOT NULL,
  followers           bigint,
  follows             bigint,   -- ganhos no dia
  unfollows           bigint,
  subs_gained         bigint,   -- YT
  subs_lost           bigint,
  profile_views       bigint,
  reach               bigint,
  views               bigint,
  views_followers     bigint,   -- IG breakdown follow_type (nível CONTA)
  views_non_followers bigint,
  accounts_engaged    bigint,
  link_taps           bigint,
  PRIMARY KEY (workspace_id, account_id, date)
);

-- 7) snapshots de audiência (demografia/horários — API só dá foto, sem histórico)
CREATE TABLE IF NOT EXISTS organic_audience_snapshots (
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES organic_accounts(id) ON DELETE CASCADE,
  captured_on   date NOT NULL DEFAULT CURRENT_DATE,
  kind          text NOT NULL CHECK (kind IN ('follower','engaged','reached','online_times','activity_times','device','subscribed_status')),
  breakdown     jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (workspace_id, account_id, captured_on, kind)
);

-- RLS deny-all em tudo (service-role bypassa; nenhuma policy = nenhum acesso)
ALTER TABLE organic_accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE organic_posts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE organic_post_metrics_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE organic_retention_points    ENABLE ROW LEVEL SECURITY;
ALTER TABLE organic_profile_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE organic_audience_snapshots  ENABLE ROW LEVEL SECURITY;

-- 8) agendamento sub-diário via pg_cron+pg_net (padrão setup-pgcron-sync-meta.sql).
-- Vault: dash_cron_secret/dash_base_url já existem (criados na 0024-era).
-- Idempotente: unschedule se já existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-youtube-daily') THEN
    PERFORM cron.unschedule('sync-youtube-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'sync-youtube-daily',
  '0 9 * * *',  -- 09:00 UTC = 06:00 BRT
  $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url') || '/api/cron/sync-youtube?days=7',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')),
    timeout_milliseconds := 290000
  );
  $$
);
