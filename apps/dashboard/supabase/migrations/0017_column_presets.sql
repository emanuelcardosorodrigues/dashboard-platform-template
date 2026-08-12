-- Fase 3.3 — predefinições de colunas sincronizadas (privadas + compartilhadas + padrão).
-- Aditiva: cria tabela nova, não toca dados existentes.
create table if not exists public.column_presets (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('criativos','campanhas','conjuntos','funil','clarity')),
  name text not null,
  payload jsonb not null default '{}'::jsonb,   -- { columns: [{id,width?}], sort?: {id,dir} }
  owner_user text,                              -- email do dono (sessão); null = sistema
  visibility text not null default 'private' check (visibility in ('private','shared')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists column_presets_scope_owner_idx on public.column_presets (scope, owner_user);
-- Constraint nomeada pra suportar upsert onConflict (scope, owner_user, name).
alter table public.column_presets drop constraint if exists column_presets_scope_owner_name_uq;
alter table public.column_presets add constraint column_presets_scope_owner_name_uq unique (scope, owner_user, name);
