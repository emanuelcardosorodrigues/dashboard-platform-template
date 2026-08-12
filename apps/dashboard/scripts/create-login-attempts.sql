-- Fase 1.5 — Lockout server-side
-- Por que existe: o lockout atual fica num cookie HMAC client-side. Atacante apaga
-- o cookie, atacante volta a tentar. Server-authoritative resolve isso.
--
-- Chave: ip + email_hash (sha256). Sem armazenar email cru pra reduzir PII.
-- Antes da Fase 2 (multi-user), email_hash é fixo (DASHBOARD_PASSWORD não tem email),
-- então a chave efetiva vira só ip + role. Quando entrar 2.0, hash do email passa
-- a ser por user de verdade.

CREATE TABLE IF NOT EXISTS public.login_attempts (
  key             text PRIMARY KEY,        -- "${ip}|${email_hash}"
  count           int NOT NULL DEFAULT 0,
  locked_until    timestamptz,             -- null = não bloqueado
  first_attempt   timestamptz NOT NULL DEFAULT now(),
  last_attempt    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_locked_until_idx
  ON public.login_attempts (locked_until)
  WHERE locked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS login_attempts_last_attempt_idx
  ON public.login_attempts (last_attempt);

-- RLS: tabela só acessada via service-role (login action server-side).
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
-- Sem policies → todos os clientes anon/authenticated negados. Service-role bypassa RLS.

-- Purge: linhas antigas (último attempt > 24h e não bloqueada) são removidas pelo
-- cron de retenção (Fase 1.11).
