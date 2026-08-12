-- 0046_extracao_comentarios_youtube.sql
-- Ferramenta "Extrair Comentários": usuário cola URLs de vídeos do YouTube
-- (qualquer canal público) e recebe TODOS os comentários + replies em CSV/XLSX.
-- Processamento em chunks dirigido pelo client (Vercel Hobby: sem request longa);
-- cursor persistido aqui = extração retomável (quota/refresh/timeout).
-- Linhas expiram em 30 dias (pg_cron) a não ser que salva=true.
-- Aditiva. RLS deny-all (service-role only). workspace_id + ON DELETE CASCADE (padrão).

-- ── Extrações (1 linha por vídeo submetido) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS yt_comment_extractions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  video_id           text NOT NULL,             -- 11 chars
  url                text NOT NULL,             -- URL original colada
  video_title        text,
  channel_title      text,
  thumbnail_url      text,
  video_published_at timestamptz,
  expected_comments  int,                       -- statistics.commentCount no submit (aprox.)

  -- Máquina de estados do processamento em chunks
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','done','failed','comments_disabled','quota')),
  phase              text NOT NULL DEFAULT 'threads'
                     CHECK (phase IN ('threads','replies')),
  page_cursor        text,                      -- nextPageToken da fase threads (retomada)
  pages_fetched      int NOT NULL DEFAULT 0,
  comments_count     int NOT NULL DEFAULT 0,
  quota_units        int NOT NULL DEFAULT 0,    -- observabilidade da quota (10k/dia)
  lease_until        timestamptz,               -- guarda contra process concorrente (2 abas)
  ultimo_erro        text,                      -- truncado em 500 chars
  concluida_em       timestamptz,

  -- Ciclo de vida
  salva              boolean NOT NULL DEFAULT false,
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '30 days',

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Índice para leitura pelo workspace (lista da UI)
CREATE INDEX IF NOT EXISTS idx_yt_extractions_ws_created
  ON yt_comment_extractions (workspace_id, created_at DESC);

-- ── Comentários extraídos (raízes + replies) ────────────────────────────────

CREATE TABLE IF NOT EXISTS yt_extracted_comments (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  extraction_id      uuid NOT NULL REFERENCES yt_comment_extractions(id) ON DELETE CASCADE,
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  external_id        text NOT NULL,
  parent_external_id text,                      -- null = comentário raiz
  author             text,
  author_channel_url text,
  text               text NOT NULL DEFAULT '',
  like_count         int,
  reply_count        int,                       -- só raiz (replies têm null)
  published_at       timestamptz,

  -- false = raiz cujas replies inline (~5) não cobrem totalReplyCount →
  -- fila da fase 'replies' é derivada DAQUI (não de jsonb): índice parcial abaixo
  replies_fetched    boolean NOT NULL DEFAULT true,

  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Upsert idempotente: retomada/re-processamento nunca duplica
  UNIQUE (extraction_id, external_id)
);

-- Export por keyset pagination (id crescente)
CREATE INDEX IF NOT EXISTS idx_yt_comments_extr_id
  ON yt_extracted_comments (extraction_id, id);

-- Fila da fase replies: só raízes pendentes, sem varrer o resto
CREATE INDEX IF NOT EXISTS idx_yt_comments_replies_pending
  ON yt_extracted_comments (extraction_id)
  WHERE replies_fetched = false AND parent_external_id IS NULL;

-- RLS deny-all (service-role bypassa; sem policy = sem acesso anônimo)
ALTER TABLE yt_comment_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yt_extracted_comments ENABLE ROW LEVEL SECURITY;

-- Trigger updated_at (padrão do projeto)
CREATE OR REPLACE FUNCTION set_yt_comment_extractions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_yt_comment_extractions_updated_at ON yt_comment_extractions;
CREATE TRIGGER trg_yt_comment_extractions_updated_at
  BEFORE UPDATE ON yt_comment_extractions
  FOR EACH ROW EXECUTE FUNCTION set_yt_comment_extractions_updated_at();

-- pg_cron cleanup: diário às 03:10 UTC (10min após o de transcricao_links)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-extracao-comentarios') THEN
    PERFORM cron.unschedule('cleanup-extracao-comentarios');
  END IF;
END $$;

SELECT cron.schedule('cleanup-extracao-comentarios', '10 3 * * *', $$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_base_url')
           || '/api/cron/cleanup-extracao-comentarios',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_secret')
    ),
    timeout_milliseconds := 30000
  );
$$);
