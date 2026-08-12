-- Migration: clarity_daily + ai_insights
-- Aplicar manualmente no Supabase Dashboard → SQL Editor
-- RLS habilitado sem políticas → service_role bypassa (padrão do projeto)

CREATE TABLE IF NOT EXISTS clarity_daily (
  data DATE NOT NULL,
  recorte VARCHAR(20) NOT NULL CHECK (recorte IN ('total','url','device','source')),
  dimensao_valor TEXT NOT NULL DEFAULT '*',
  sessions INTEGER,
  pages_per_session NUMERIC(6,2),
  total_pageviews INTEGER,
  scroll_depth_pct NUMERIC(5,2),
  engagement_time_sec NUMERIC(8,2),
  dead_clicks INTEGER,
  rage_clicks INTEGER,
  quick_backs INTEGER,
  excessive_scroll INTEGER,
  script_errors INTEGER,
  error_clicks INTEGER,
  raw_json JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (data, recorte, dimensao_valor)
);
CREATE INDEX IF NOT EXISTS idx_clarity_daily_data ON clarity_daily (data DESC);
CREATE INDEX IF NOT EXISTS idx_clarity_daily_recorte ON clarity_daily (recorte, data DESC);
ALTER TABLE clarity_daily ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL,
  periodo VARCHAR(20) NOT NULL DEFAULT 'daily' CHECK (periodo IN ('daily','weekly','custom')),
  periodo_from DATE,
  periodo_to DATE,
  modelo VARCHAR(50) NOT NULL,
  prompt_version VARCHAR(20) NOT NULL,
  tldr TEXT,
  alertas JSONB,
  oportunidades JSONB,
  recomendacoes JSONB,
  metricas_contexto JSONB,
  tokens_input INTEGER,
  tokens_output INTEGER,
  custo_usd NUMERIC(8,4),
  gerado_at TIMESTAMPTZ DEFAULT NOW(),
  gerado_por VARCHAR(20) NOT NULL DEFAULT 'cron' CHECK (gerado_por IN ('cron','manual'))
);
CREATE INDEX IF NOT EXISTS idx_ai_insights_data ON ai_insights (data DESC, gerado_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_insights_periodo_range
  ON ai_insights (periodo_from DESC, periodo_to DESC, gerado_at DESC);
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;

-- Para instalações existentes, aplique scripts/alter-ai-insights-periodo.sql
-- pra adicionar as colunas periodo_from/periodo_to com backfill.
