-- Fase 4 — mapa funil × papel → player vTurb (configurável, com default).
-- Destrava as etapas vTurb no funil e o Tier B por criativo.
create table if not exists public.vsl_player_map (
  id uuid primary key default gen_random_uuid(),
  funil text not null check (funil in ('col','plo','dpl','lps')),
  papel text not null check (papel in ('principal','upsell','downsell','order_bump')),
  player_id text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists vsl_player_map_funil_idx on public.vsl_player_map (funil, papel);
