-- 0045_criativo_nao_rodaram.sql — Análise de criativos que NÃO rodaram.
-- "Cobertura TOTAL": anúncios criados com 0 entrega + assets soltos da biblioteca
-- de mídia que nunca viraram anúncio. ADITIVA.
--
-- Separa INVENTÁRIO (criativo_biblioteca — o que não rodou, custo zero de listar)
-- da ANÁLISE (criativo_analise — Gemini, cost-capped). O cron de análise lê o
-- inventário, classifica e marca analisado=true.

-- 1) Inventário dos criativos sem entrega (refrescado por cron de leitura — sem Gemini).
CREATE TABLE IF NOT EXISTS criativo_biblioteca (
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_key        text NOT NULL,            -- ad_id real (anúncio 0-entrega) OU lib_vid_<id>/lib_img_<hash> (asset solto)
  fonte            text NOT NULL,            -- 'anuncio' | 'biblioteca'
  account_id       text,
  nome             text,
  video_id         text,
  image_hash       text,
  video_url        text,                     -- source baixável (vídeo) — pode expirar; re-resolve na análise
  thumbnail_url    text,
  effective_status text,                     -- status Meta do anúncio (só fonte='anuncio')
  analisado        boolean NOT NULL DEFAULT false,
  descoberto_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, asset_key)
);
CREATE INDEX IF NOT EXISTS criativo_biblioteca_fila_idx
  ON criativo_biblioteca (workspace_id, analisado, descoberto_em) WHERE analisado = false;

-- 2) Marca na análise quais criativos NÃO rodaram (pra aba "Não rodaram" do /criativos-ia).
ALTER TABLE criativo_analise ADD COLUMN IF NOT EXISTS rodou boolean NOT NULL DEFAULT true;
ALTER TABLE criativo_analise ADD COLUMN IF NOT EXISTS fonte text NOT NULL DEFAULT 'anuncio';
CREATE INDEX IF NOT EXISTS criativo_analise_nao_rodaram_idx
  ON criativo_analise (workspace_id, rodou) WHERE rodou = false;
