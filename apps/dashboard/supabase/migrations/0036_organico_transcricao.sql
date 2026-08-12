-- 0036_organico_transcricao.sql — transcrição (Whisper na VPS) dos vídeos
-- orgânicos. Aditiva. A classificação de gancho/estrutura/tema passa a usar a
-- transcrição quando presente (muito mais preciso que caption/título).
ALTER TABLE organic_posts ADD COLUMN IF NOT EXISTS transcricao text;
ALTER TABLE organic_posts ADD COLUMN IF NOT EXISTS transcricao_status text
  CHECK (transcricao_status IN ('pending','processing','ok','failed','no_audio'));
CREATE INDEX IF NOT EXISTS idx_organic_posts_transc_pendente
  ON organic_posts (workspace_id, platform)
  WHERE transcricao IS NULL AND transcricao_status IS DISTINCT FROM 'no_audio' AND transcricao_status IS DISTINCT FROM 'failed';
