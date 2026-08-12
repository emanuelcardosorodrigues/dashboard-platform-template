-- Fase 4 — vTurb por criativo (Tier B). Contagens ABSOLUTAS por dia; taxas são
-- re-derivadas na leitura (igual a aggregateTraffic/deriveRates de lib/vturb.ts).
-- Populada por cron (app/api/cron/sync-vturb-creatives) via trafficStats(utm_id).
create table if not exists public.vturb_creative_daily (
  player_id text not null,
  day date not null,
  match_key text not null,                 -- valor do utm_id (= ad_id) ou utm_content (= ad_name)
  match_kind text not null check (match_kind in ('utm_id','utm_content')),
  total_viewed int not null default 0,
  total_started int not null default 0,
  total_finished int not null default 0,
  total_clicked int not null default 0,
  total_conversions int not null default 0,
  total_over_pitch int not null default 0,
  total_under_pitch int not null default 0,
  synced_at timestamptz not null default now(),
  primary key (player_id, day, match_key, match_kind)
);
create index if not exists vturb_creative_daily_day_idx on public.vturb_creative_daily (day, match_kind, match_key);
