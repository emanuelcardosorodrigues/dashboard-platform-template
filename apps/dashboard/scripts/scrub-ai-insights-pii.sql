-- Scrub do histórico de ai_insights.metricas_contexto
-- Remove texto livre de PII (top_dores / top_medos / top_objetivos /
-- top_faturamento) de fichas de qualificação acumulado antes do hardening
-- da Fase 0.5 (que passou a mascarar esses campos antes de enviar pro Gemini).
--
-- A coluna tldr / alertas / oportunidades / recomendacoes fica intacta —
-- já é texto sintetizado pelo modelo, sem PII original.
--
-- Execute no SQL Editor do Supabase. Idempotente.

BEGIN;

UPDATE ai_insights
SET metricas_contexto = jsonb_set(
  metricas_contexto,
  '{qualificacao,top_dores}',
  '["REDACTED-historic"]'::jsonb,
  false
)
WHERE metricas_contexto -> 'qualificacao' -> 'top_dores' IS NOT NULL;

UPDATE ai_insights
SET metricas_contexto = jsonb_set(
  metricas_contexto,
  '{qualificacao,top_medos}',
  '["REDACTED-historic"]'::jsonb,
  false
)
WHERE metricas_contexto -> 'qualificacao' -> 'top_medos' IS NOT NULL;

UPDATE ai_insights
SET metricas_contexto = jsonb_set(
  metricas_contexto,
  '{qualificacao,top_objetivos}',
  '["REDACTED-historic"]'::jsonb,
  false
)
WHERE metricas_contexto -> 'qualificacao' -> 'top_objetivos' IS NOT NULL;

UPDATE ai_insights
SET metricas_contexto = jsonb_set(
  metricas_contexto,
  '{qualificacao,top_faturamento}',
  '["REDACTED-historic"]'::jsonb,
  false
)
WHERE metricas_contexto -> 'qualificacao' -> 'top_faturamento' IS NOT NULL;

-- Cohort por criativo também carrega top_* das fichas. Scrub aninhado:
-- itera por cada elemento do array cohort_por_criativo zerando os top_*.
UPDATE ai_insights
SET metricas_contexto = jsonb_set(
  metricas_contexto,
  '{cohort_por_criativo}',
  (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(elem, '{top_dores}',       '["REDACTED-historic"]'::jsonb, false),
              '{top_medos}',       '["REDACTED-historic"]'::jsonb, false
            ),
            '{top_objetivos}',     '["REDACTED-historic"]'::jsonb, false
          ),
          '{top_faturamento}',     '["REDACTED-historic"]'::jsonb, false
        )
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(metricas_contexto -> 'cohort_por_criativo') AS elem
  ),
  false
)
WHERE jsonb_typeof(metricas_contexto -> 'cohort_por_criativo') = 'array';

COMMIT;

-- Verificação: deve retornar > 0 se havia histórico, 0 se já scrubed.
-- SELECT COUNT(*) FROM ai_insights
--   WHERE metricas_contexto -> 'qualificacao' ->> 'top_dores' LIKE '%REDACTED-historic%';
