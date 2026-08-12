-- 0042_transcricao_links.sql
-- Ferramenta de Transcrição de Links do Instagram.
-- Usuário cola links de posts/reels; VPS processa com faster-whisper local (zero custo).
-- Linhas expiram em 3 dias (pg_cron) a não ser que salva=true.
-- Aditiva. RLS deny-all (service-role only). workspace_id + ON DELETE CASCADE (padrão).

CREATE TABLE IF NOT EXISTS transcricao_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  url             text NOT NULL,

  -- Queue/status (espelha padrão de organic_posts.transcricao_status)
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','ok','failed','no_audio')),
  tentativas      int NOT NULL DEFAULT 0,    -- worker abandona após 3
  ultimo_erro     text,                      -- truncado em 500 chars
  processado_em   timestamptz,

  -- Resultado
  transcricao     text,
  duracao_s       numeric,
  thumbnail_url   text,                      -- CDN URL via yt-dlp --print thumbnail

  -- Ciclo de vida
  salva           boolean NOT NULL DEFAULT false,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '3 days',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Índice para leitura pelo workspace (lista da UI)
CREATE INDEX IF NOT EXISTS idx_transcricao_links_ws_created
  ON transcricao_links (workspace_id, created_at DESC);

-- Índice parcial para o worker: só linhas relevantes, sem varrer terminadas
CREATE INDEX IF NOT EXISTS idx_transcricao_links_pending
  ON transcricao_links (created_at)
  WHERE status IN ('pending','processing');

-- RLS deny-all (service-role bypassa; sem policy = sem acesso anônimo)
ALTER TABLE transcricao_links ENABLE ROW LEVEL SECURITY;

-- Trigger updated_at (padrão do projeto)
CREATE OR REPLACE FUNCTION set_transcricao_links_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_transcricao_links_updated_at ON transcricao_links;
CREATE TRIGGER trg_transcricao_links_updated_at
  BEFORE UPDATE ON transcricao_links
  FOR EACH ROW EXECUTE FUNCTION set_transcricao_links_updated_at();

-- pg_cron cleanup: diário às 03:00 UTC (padrão vault do projeto)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-transcricao-links') THEN
    PERFORM cron.unschedule('cleanup-transcricao-links');
  END IF;
END $$;

SELECT cron.schedule('cleanup-transcricao-links', '0 3 * * *', $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url')
           || '/api/cron/cleanup-transcricao-links',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')
    ),
    timeout_milliseconds := 30000
  );
$$);
