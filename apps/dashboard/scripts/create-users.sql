-- Fase 2.1 — multi-user + admin panel.
-- Cria tabelas users, user_sessions, device_trust.
-- Padrão de chave: id text (uuid gerado em app via crypto.randomUUID()).

create table if not exists public.users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'viewer')),
  status text not null default 'active' check (status in ('active', 'pending_onboarding', 'disabled')),
  name text,
  ai_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists users_email_idx on public.users (email);
create index if not exists users_role_status_idx on public.users (role, status);

-- ai_config shape esperado (validado em app):
--   {
--     "scope": ["/visao-geral", "/criativos", ...]   -- allowlist de rotas
--     "quota_daily": 20,                              -- perguntas por dia
--     "disabled": false                               -- override hard
--   }

create table if not exists public.user_sessions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists user_sessions_user_idx on public.user_sessions (user_id);
create index if not exists user_sessions_expires_idx on public.user_sessions (expires_at);
create index if not exists user_sessions_revoked_idx on public.user_sessions (revoked_at) where revoked_at is null;

create table if not exists public.device_trust (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  device_fingerprint text not null,
  trusted_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, device_fingerprint)
);

create index if not exists device_trust_user_idx on public.device_trust (user_id);

-- ai_usage_daily — quota tracking, key = (user_id, day UTC).
create table if not exists public.ai_usage_daily (
  user_id text not null references public.users(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  last_at timestamptz not null default now(),
  primary key (user_id, day)
);
