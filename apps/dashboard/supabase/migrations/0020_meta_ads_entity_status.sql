-- Fase 8 — controle Meta. Captura IDs de entidade + STATUS REAL + orçamento, pra
-- (a) trocar o "Status FAKE" (investimento>0?ativo:pausado) pelo status real e
-- (b) habilitar pausar/ativar/escalar com compare-and-set. Aditiva (colunas novas).
alter table public.meta_ads add column if not exists campaign_id text;
alter table public.meta_ads add column if not exists adset_id text;
alter table public.meta_ads add column if not exists status text;                 -- ACTIVE | PAUSED | ...
alter table public.meta_ads add column if not exists daily_budget_cents bigint;    -- ABO: orçamento do conjunto
alter table public.meta_ads add column if not exists lifetime_budget_cents bigint;
alter table public.meta_ads add column if not exists campaign_daily_budget_cents bigint; -- CBO: orçamento da campanha
