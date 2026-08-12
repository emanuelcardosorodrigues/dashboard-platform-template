-- 0003_bandit.sql — Fase 5 do plano whimsical-seeking-lemon
-- Schema para Bandit Mode v2 (Thompson Sampling com guardrails).

ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS auto_optimize     bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS champion_variant  text,
  ADD COLUMN IF NOT EXISTS bandit_min_conv   int  DEFAULT 30,
  ADD COLUMN IF NOT EXISTS bandit_lock_until timestamptz;

CREATE TABLE IF NOT EXISTS bandit_log (
  id            bigserial PRIMARY KEY,
  experiment_id uuid REFERENCES experiments(id) ON DELETE CASCADE,
  weights       jsonb NOT NULL,
  decided_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bandit_log_exp_time
  ON bandit_log(experiment_id, decided_at DESC);
