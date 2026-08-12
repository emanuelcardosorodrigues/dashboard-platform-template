-- 0062_push_subscriptions.sql
-- Inscrições de Web Push (A-F6). Uma linha por endpoint de browser (o navegador
-- gera um endpoint único por dispositivo/instalação). O envio usa VAPID (chaves no
-- env do Vercel). Aditiva. RLS deny-all (service-role only), molde de creative_tags.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id) ON DELETE CASCADE,
  user_email    text,
  endpoint      text NOT NULL,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_ws ON push_subscriptions (workspace_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
