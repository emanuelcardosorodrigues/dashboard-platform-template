-- 0066 — Predefinições da Calculadora Estratégica (S8).
--
-- Guarda um cenário inteiro da aba /calculadora: funil, janela, posição dos sliders,
-- métrica-objetivo, VSL on/off e backend. Aplicar um preset repovoa os sliders.
--
-- Molde: 0017_column_presets.sql. Duas diferenças deliberadas:
--   1. `workspace_id` — o 0017 não tem, e num dash multi-tenant isso faz preset de um
--      projeto aparecer no outro. Aqui o escopo é (workspace, dono).
--   2. Sem `visibility` — o pedido é escopo POR USUÁRIO. Compartilhar é decisão futura;
--      adicionar depois é uma coluna, remover um vazamento é um incidente.
--
-- ⚠️ RLS aqui é deny-all, igual ao resto do repo (enable-rls.sql, 0053_route_clicks.sql).
-- RLS NÃO isola usuário neste app: o servidor Next fala via service_role, que bypassa
-- policy por design do Postgres. Uma policy `auth.uid() = user_id` daria sensação de
-- proteção e não protegeria nada. O isolamento real é o filtro obrigatório por
-- workspace_id + owner_user na camada de dados, com teste de vazamento.
--
-- Aditiva/idempotente.

create table if not exists public.calc_presets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user   text not null,                      -- email do dono (da sessão)
  funil        text,                               -- slug do funil; null = "todos"
  nome         text not null,
  config       jsonb not null default '{}'::jsonb, -- { drivers, janela, metricaObjetivo, vslOn, backend }
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table  public.calc_presets is
  'Cenários salvos da aba /calculadora. Escopo por (workspace_id, owner_user) — filtro no servidor, não em RLS.';
comment on column public.calc_presets.config is
  'Cenário completo: posição dos sliders, janela, métrica-objetivo, VSL on/off, backend. jsonb pra não migrar a cada driver novo.';

-- Um nome por dono dentro do workspace. Constraint nomeada pra suportar upsert onConflict.
alter table public.calc_presets drop constraint if exists calc_presets_ws_owner_nome_uq;
alter table public.calc_presets add  constraint calc_presets_ws_owner_nome_uq
  unique (workspace_id, owner_user, nome);

create index if not exists calc_presets_ws_owner_idx
  on public.calc_presets (workspace_id, owner_user);

-- RLS ligada SEM policy = deny-all para anon/authenticated. service_role bypassa.
alter table public.calc_presets enable row level security;
