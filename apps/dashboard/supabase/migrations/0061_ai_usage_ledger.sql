-- 0061_ai_usage_ledger.sql
-- Ledger de custo/tokens da IA (A-F5). ai_usage_daily (0002x) conta PERGUNTAS por
-- usuário/dia (quota). Este ledger registra TOKENS + CUSTO em USD por turno, por
-- provider/modelo — base do "créditos" no header e do TETO por workspace (BYO
-- Claude cobra por token; Gemini/Groq entram com custo 0).
-- Aditiva. RLS deny-all (service-role only), molde de creative_tags (0058).

CREATE TABLE IF NOT EXISTS ai_usage_ledger (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id   uuid NOT NULL DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id) ON DELETE CASCADE,
  user_email     text,
  scope          text,                              -- creative | portfolio | insight | ...
  provider       text NOT NULL,                     -- gemini | claude | groq
  model          text NOT NULL,
  tokens_input   integer,
  tokens_output  integer,
  cost_usd       numeric(12,6) NOT NULL DEFAULT 0,
  at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ail_ws_at ON ai_usage_ledger (workspace_id, at);

ALTER TABLE ai_usage_ledger ENABLE ROW LEVEL SECURITY;
