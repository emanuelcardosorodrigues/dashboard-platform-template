-- 0001_ab_testing_rpcs.sql
-- Cria infraestrutura mínima pro cron de quarentena de bots funcionar.
-- Origem: app/api/cron/quarantine-bots/route.ts (constante MIGRATION_SQL inline).
-- Aplicar via SQL editor do Supabase (projeto SEU_PROJECT_REF).

-- Tabela de UIDs em quarentena (suspeitos ou confirmados como bot).
CREATE TABLE IF NOT EXISTS bot_uids (
  uid        text PRIMARY KEY,
  ip_fp      text,
  source     text NOT NULL DEFAULT 'rate_suspicious',
  created_at timestamptz DEFAULT now()
);

-- Função RPC: detecta UIDs com burst >3 impressões no mesmo experimento em ≤60s,
-- janela das últimas 24h. Retorna uma row por (uid, ip_fp) — DISTINCT colapsa
-- múltiplos experimentos do mesmo UID.
CREATE OR REPLACE FUNCTION find_rate_suspicious_uids()
RETURNS TABLE(uid text, ip_fp text) AS $$
  SELECT DISTINCT uid, ip_fp
  FROM impressions
  WHERE timestamp > now() - interval '24 hours'
  GROUP BY experiment_id, uid, ip_fp
  HAVING COUNT(*) > 3
    AND MAX(timestamp) - MIN(timestamp) < interval '60 seconds'
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION find_rate_suspicious_uids() TO service_role;
