-- 0057_criativo_analise_drift.sql
-- Formaliza colunas de `criativo_analise` que existem em PRODUÇÃO mas nunca
-- entraram em nenhuma migration (foram aplicadas manualmente via SQL editor).
-- `lib/criativos.ts` faz SELECT de fadiga_status / frames_path / hook_rate /
-- momento_funil / etc.; sem estas colunas, um ambiente novo (branch / preview /
-- reset do Supabase — que só replica os arquivos de migration) QUEBRARIA a
-- listagem de criativos.
--
-- Idempotente por design: `ADD COLUMN IF NOT EXISTS` é no-op em prod (as colunas
-- já existem) e cria as colunas num ambiente do zero. Tipos conferidos contra o
-- information_schema real de prod.
ALTER TABLE public.criativo_analise
  ADD COLUMN IF NOT EXISTS hook_rate numeric,
  ADD COLUMN IF NOT EXISTS hold_rate numeric,
  ADD COLUMN IF NOT EXISTS transcricao_confidence numeric,
  ADD COLUMN IF NOT EXISTS frames_extracted integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frames_path text,
  ADD COLUMN IF NOT EXISTS fadiga_status text,
  ADD COLUMN IF NOT EXISTS fadiga_calculado_em timestamptz,
  ADD COLUMN IF NOT EXISTS nivel_consciencia text,
  ADD COLUMN IF NOT EXISTS objecao_principal text,
  ADD COLUMN IF NOT EXISTS angulo_entrada text,
  ADD COLUMN IF NOT EXISTS momento_funil text,
  ADD COLUMN IF NOT EXISTS promessa_principal text,
  ADD COLUMN IF NOT EXISTS produto_aparece boolean,
  ADD COLUMN IF NOT EXISTS logo_aparece boolean,
  ADD COLUMN IF NOT EXISTS cores_marca boolean,
  ADD COLUMN IF NOT EXISTS transcricao_modelo text;
