-- 0016_criativo_analise_instagram_permalink.sql
-- Adiciona instagram_permalink_url em criativo_analise pra possibilitar
-- abrir o post público do criativo direto do dashboard (modal Analise).
--
-- O campo vem do Meta Graph creative.instagram_permalink_url e já é
-- retornado por getAdCreativeAssets em lib/meta-graph.ts; agora é
-- persistido no upsert de runAnalysisForAd.
--
-- Pra ads já analisados antes desta migration o campo fica NULL;
-- backfill = rodar refresh stale (PR 13) ou re-analisar manualmente.

ALTER TABLE criativo_analise
  ADD COLUMN IF NOT EXISTS instagram_permalink_url text;
