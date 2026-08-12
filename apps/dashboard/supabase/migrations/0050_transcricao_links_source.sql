-- 0050_transcricao_links_source.sql
-- Fase 5: "Transcrições de Links" passa a aceitar vídeos do YouTube (qualquer
-- canal público), além do Instagram. `source` diz ao worker da VPS qual pipeline
-- usar: 'instagram' (resolve media_url no Vercel) × 'youtube' (yt-dlp direto).
-- Aditiva; default 'instagram' preserva as linhas existentes.

ALTER TABLE transcricao_links ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'instagram';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_transcricao_links_source'
  ) THEN
    ALTER TABLE transcricao_links
      ADD CONSTRAINT chk_transcricao_links_source CHECK (source IN ('instagram','youtube'));
  END IF;
END $$;
