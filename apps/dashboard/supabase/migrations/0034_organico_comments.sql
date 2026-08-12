-- 0034_organico_comments.sql — Onda 5: comentários (texto + análise IA com
-- vocabulário FIXO) + cache de insights determinísticos. Aditiva, RLS deny-all.

CREATE TABLE IF NOT EXISTS organic_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_id       uuid NOT NULL REFERENCES organic_posts(id) ON DELETE CASCADE,
  external_id   text NOT NULL,
  author_handle text,
  text          text,
  like_count    bigint,
  reply_count   bigint,
  published_at  timestamptz,
  is_reply      boolean NOT NULL DEFAULT false,
  -- análise IA restrita a vocabulário fixo (lib/organico/taxonomiaComentarios.ts)
  sentiment     text CHECK (sentiment IN ('positivo','negativo','neutro')),
  themes        text[] DEFAULT '{}',
  is_question   boolean,
  analyzed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, post_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_organic_comments_post ON organic_comments (workspace_id, post_id);
CREATE INDEX IF NOT EXISTS idx_organic_comments_pending ON organic_comments (workspace_id) WHERE analyzed_at IS NULL;

ALTER TABLE organic_comments ENABLE ROW LEVEL SECURITY;

-- cache dos insights determinísticos (recalculado pelo cron organic-insights)
CREATE TABLE IF NOT EXISTS organic_insights_cache (
  workspace_id  uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  insights      jsonb NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE organic_insights_cache ENABLE ROW LEVEL SECURITY;

-- agendamentos (pg_cron + pg_net; Vault dash_base_url/dash_cron_secret)
DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['sync-organic-comments','analyze-organic-comments','classify-organic-posts','organic-insights'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
END $$;

SELECT cron.schedule('sync-organic-comments', '0 10 * * *', $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url') || '/api/cron/sync-organic-comments',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')),
    timeout_milliseconds := 290000);
$$);
SELECT cron.schedule('classify-organic-posts', '20 10 * * *', $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url') || '/api/cron/classify-organic-posts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')),
    timeout_milliseconds := 290000);
$$);
SELECT cron.schedule('analyze-organic-comments', '0 11 * * *', $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url') || '/api/cron/analyze-organic-comments',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')),
    timeout_milliseconds := 290000);
$$);
SELECT cron.schedule('organic-insights', '0 12 * * *', $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url') || '/api/cron/organic-insights',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')),
    timeout_milliseconds := 290000);
$$);
