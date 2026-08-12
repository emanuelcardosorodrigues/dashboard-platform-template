-- 0041_organico_comment_intel.sql — Aba "Análises de Comentários".
-- (1) cache da IA-síntese qualitativa (dores/dificuldades ocultas/oportunidades/
--     desejos/dúvidas) por workspace; (2) palavras-gatilho de automação confirmadas.
-- Aditiva, RLS deny-all (acesso só via service-role nos fetchers, mesmo padrão do Orgânico).

CREATE TABLE IF NOT EXISTS organic_comment_insights (
  workspace_id  uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  amostra       int,                                  -- nº de comentários lidos na síntese
  insights      jsonb NOT NULL DEFAULT '{}'::jsonb     -- { dores, dificuldades, oportunidades, desejos, duvidas }
);
ALTER TABLE organic_comment_insights ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS organic_comment_triggers (
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  word          text NOT NULL,                        -- normalizada (UPPER, sem acento/emoji)
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, word)
);
ALTER TABLE organic_comment_triggers ENABLE ROW LEVEL SECURITY;

-- cron: síntese de IA dos comentários, logo após o organic-insights (12:00)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'analyze-comment-insights') THEN
    PERFORM cron.unschedule('analyze-comment-insights');
  END IF;
END $$;
SELECT cron.schedule('analyze-comment-insights', '30 12 * * *', $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url') || '/api/cron/analyze-comment-insights',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')),
    timeout_milliseconds := 290000);
$$);
