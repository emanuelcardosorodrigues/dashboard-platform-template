-- Migration: ai_insights periodo_from / periodo_to (suporte a análise retroativa)
-- Aplicar manualmente no Supabase Dashboard → SQL Editor
-- Após aplicar, o insightsRunner passa a salvar periodo_from/periodo_to para
-- todas as gerações (cron usa from===to=ontem). Backwards compat: insights
-- antigos com data preenchida têm periodo_from = periodo_to = data via backfill.

ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS periodo_from DATE;
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS periodo_to DATE;

-- Backfill: rows existentes (single-day insights v1)
UPDATE ai_insights SET periodo_from = data WHERE periodo_from IS NULL;
UPDATE ai_insights SET periodo_to = data WHERE periodo_to IS NULL;

-- Relaxa o CHECK do periodo pra aceitar 'custom'
ALTER TABLE ai_insights DROP CONSTRAINT IF EXISTS ai_insights_periodo_check;
-- (não havia constraint nomeada antes — default não tinha check. Adiciono agora.)
ALTER TABLE ai_insights ADD CONSTRAINT ai_insights_periodo_check CHECK (periodo IN ('daily','weekly','custom'));

-- Index pra busca por range
CREATE INDEX IF NOT EXISTS idx_ai_insights_periodo_range
  ON ai_insights (periodo_from DESC, periodo_to DESC, gerado_at DESC);
