-- 0004_experiment_health_view.sql — Fase 7 do plano whimsical-seeking-lemon
-- View agregando saúde por experimento ativo (pct_bots, clarity_rage_pct).
-- ga4_connect_rate e vturb_play_rate ficam comentados até as tabelas existirem.

CREATE OR REPLACE VIEW experiment_health AS
SELECT
  e.id, e.name, e.entry_path, e.type, e.status,

  COALESCE(
    (
      SELECT COUNT(*)::float
      FROM bot_uids bu
      WHERE bu.status = 'confirmed'
        AND bu.uid IN (SELECT uid FROM impressions WHERE experiment_id = e.id)
    ) / NULLIF(
      (SELECT COUNT(DISTINCT uid) FROM impressions WHERE experiment_id = e.id), 0
    ), 0
  ) AS pct_bots,

  (
    SELECT AVG((rage_clicks::float) / NULLIF(total_pageviews, 0))
    FROM clarity_daily
    WHERE recorte = 'url'
      AND dimensao_valor LIKE '%' || e.entry_path
      AND data > now() - interval '7 days'
  ) AS clarity_rage_pct,

  (
    SELECT COUNT(DISTINCT uid)
    FROM impressions
    WHERE experiment_id = e.id
      AND timestamp > now() - interval '24 hours'
  ) AS uids_24h
FROM experiments e
WHERE e.status = 'active';

GRANT SELECT ON experiment_health TO service_role;
