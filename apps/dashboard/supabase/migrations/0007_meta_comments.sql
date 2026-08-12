-- 0007_meta_comments.sql
-- Cache de comments do Meta Graph por ad_id.
-- Cron diário (PR 2) faz refresh; sentimento/objeção classificados por LLM Flash.

CREATE TABLE IF NOT EXISTS meta_comments (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id           text PRIMARY KEY,
  ad_id        text NOT NULL,
  post_id      text NOT NULL,
  message      text,
  created_time timestamptz,
  like_count   int DEFAULT 0,
  reply_count  int DEFAULT 0,
  sentiment    text CHECK (sentiment IN ('positivo','neutro','negativo','objecao','pergunta') OR sentiment IS NULL),
  objecao_tipo text CHECK (objecao_tipo IN ('preco','tempo','ceticismo','tecnica') OR objecao_tipo IS NULL),
  cached_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_comments_ad_idx ON meta_comments (workspace_id, ad_id);
CREATE INDEX IF NOT EXISTS meta_comments_post_idx ON meta_comments (post_id);
CREATE INDEX IF NOT EXISTS meta_comments_sentiment_idx
  ON meta_comments (workspace_id, sentiment) WHERE sentiment IS NOT NULL;
