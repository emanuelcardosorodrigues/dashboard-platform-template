-- 0031_mt_composite_uniques.sql — GATE de chaves compostas (rodar no 1º cliente).
--
-- Só as tabelas de chave "mole" (valor pode repetir entre clientes) precisam de
-- workspace_id na unique. meta_ads(ad_id)/transacoes(hotmart_id)/vturb(player_id)
-- NÃO entram (chaves globalmente únicas — nunca colidem).
--
-- SEQUÊNCIA SEGURA (sem janela quebrada):
--   FASE 1 (este arquivo, parte A): CREATE UNIQUE INDEX compostas — ADITIVO. O DEMO
--     satisfaz as duas (antiga e nova) ao mesmo tempo, então prod segue idêntico.
--   >>> deploy do código com onConflict composto (branch prep-onboarding + flips em
--       sync-clarity / lead-score). Só DEPOIS:
--   FASE 2 (parte B, rodar separado): DROP das uniques antigas de coluna única.
--
-- Rodar a parte A agora; a parte B só após o deploy do código novo.

-- ───────────────────────── FASE 1 (parte A) — ADITIVO ─────────────────────────
-- qualificacao: email pode repetir entre clientes → (workspace_id, email)
CREATE UNIQUE INDEX IF NOT EXISTS qualificacao_ws_email_uniq
  ON qualificacao (workspace_id, email);

-- clarity_daily: mesma URL/dia pode aparecer em 2 clientes
CREATE UNIQUE INDEX IF NOT EXISTS clarity_daily_ws_uniq
  ON clarity_daily (workspace_id, data, recorte, dimensao_valor);

-- lead_score_config: nome de funil ('col') pode repetir entre clientes
CREATE UNIQUE INDEX IF NOT EXISTS lead_score_config_ws_uniq
  ON lead_score_config (workspace_id, funil);


-- ───────────────────────── FASE 2 (parte B) — RODAR DEPOIS ─────────────────────
-- DESCOMENTAR e rodar SÓ APÓS o deploy do código que usa onConflict composto.
-- Dropa as uniques antigas de coluna única (achadas dinamicamente p/ não depender
-- do nome exato). Pra DEMO sozinho a composta já garante unicidade.
--
-- DO $$
-- DECLARE r record;
-- BEGIN
--   -- qualificacao: dropa qualquer UNIQUE só em (email)
--   FOR r IN
--     SELECT c.conname FROM pg_constraint c
--     WHERE c.conrelid = 'qualificacao'::regclass AND c.contype = 'u'
--       AND (SELECT array_agg(att.attname ORDER BY att.attnum)
--            FROM unnest(c.conkey) k JOIN pg_attribute att
--              ON att.attrelid = c.conrelid AND att.attnum = k) = ARRAY['email']
--   LOOP EXECUTE format('ALTER TABLE qualificacao DROP CONSTRAINT %I', r.conname); END LOOP;
--   -- idem índices unique soltos em (email)
--   FOR r IN SELECT indexname FROM pg_indexes
--     WHERE tablename='qualificacao' AND indexdef ILIKE '%UNIQUE%(email)%' AND indexname <> 'qualificacao_ws_email_uniq'
--   LOOP EXECUTE format('DROP INDEX %I', r.indexname); END LOOP;
--
--   -- clarity_daily: dropa a PK/unique antiga em (data,recorte,dimensao_valor)
--   FOR r IN
--     SELECT c.conname FROM pg_constraint c
--     WHERE c.conrelid='clarity_daily'::regclass AND c.contype IN ('p','u')
--       AND (SELECT array_agg(att.attname ORDER BY att.attnum)
--            FROM unnest(c.conkey) k JOIN pg_attribute att
--              ON att.attrelid=c.conrelid AND att.attnum=k) = ARRAY['data','recorte','dimensao_valor']
--   LOOP EXECUTE format('ALTER TABLE clarity_daily DROP CONSTRAINT %I', r.conname); END LOOP;
--
--   -- lead_score_config: dropa unique/PK antiga em (funil)
--   FOR r IN
--     SELECT c.conname FROM pg_constraint c
--     WHERE c.conrelid='lead_score_config'::regclass AND c.contype IN ('p','u')
--       AND (SELECT array_agg(att.attname ORDER BY att.attnum)
--            FROM unnest(c.conkey) k JOIN pg_attribute att
--              ON att.attrelid=c.conrelid AND att.attnum=k) = ARRAY['funil']
--   LOOP EXECUTE format('ALTER TABLE lead_score_config DROP CONSTRAINT %I', r.conname); END LOOP;
-- END $$;
