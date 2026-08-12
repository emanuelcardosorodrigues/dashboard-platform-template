-- 0006_criativo_analise.sql
-- Análise IA multimodal por criativo, cacheada por video_hash (sha256).
-- Cache eterno: análises não re-rodam salvo se asset mudar.
-- pgvector v0.8.0 já habilitado no projeto Supabase; create extension é idempotente.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS criativo_analise (
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_id                 text NOT NULL,
  ad_name               text,
  video_url             text,
  video_hash            text,
  thumbnail_url         text,
  transcricao           text,
  resumo                text,
  hook_descricao        text,
  hook_tipo             text[] DEFAULT '{}',
  angulo_copy           text[] DEFAULT '{}',
  formato_visual        text[] DEFAULT '{}',
  elementos_visuais     text[] DEFAULT '{}',
  cta                   text[] DEFAULT '{}',
  producao              text[] DEFAULT '{}',
  one_belief_score      numeric,
  one_belief_desvio     text,
  estrutura_roteiro     jsonb DEFAULT '{}'::jsonb,
  embedding             vector(768),
  padroes_detectados    jsonb DEFAULT '{}'::jsonb,
  modelo                text NOT NULL,
  prompt_version        text NOT NULL,
  tokens_input          int,
  tokens_output         int,
  custo_usd             numeric,
  status                text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed','running')),
  error_message         text,
  gerado_at             timestamptz DEFAULT now(),
  PRIMARY KEY (workspace_id, ad_id)
);

CREATE INDEX IF NOT EXISTS criativo_analise_ad_name_idx
  ON criativo_analise (workspace_id, ad_name);

CREATE INDEX IF NOT EXISTS criativo_analise_video_hash_idx
  ON criativo_analise (video_hash) WHERE video_hash IS NOT NULL;

-- ivfflat funciona melhor com ANALYZE rodado depois de dados — listas=100 é
-- razoável até ~100k linhas. Re-criar com listas=sqrt(N) quando passar disso.
CREATE INDEX IF NOT EXISTS criativo_analise_embedding_idx
  ON criativo_analise USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
