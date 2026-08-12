-- 0002_bot_score.sql — Fase 3 do plano whimsical-seeking-lemon
-- Expande bot_uids com score, signals jsonb e workflow suspect→confirmed.
-- Adiciona vturb_enabled em experiments.

ALTER TABLE bot_uids
  ADD COLUMN IF NOT EXISTS score   int  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS signals jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status  text DEFAULT 'suspect'
    CHECK (status IN ('suspect','confirmed','cleared'));

CREATE INDEX IF NOT EXISTS idx_bot_uids_status ON bot_uids(status);

ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS vturb_enabled bool DEFAULT false;
