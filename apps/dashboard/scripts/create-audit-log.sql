-- Fase 1.4 — Audit log
-- Trilha de auditoria centralizada. Indexada por (action, occurred_at desc) pra
-- consulta no Admin Panel da Fase 2.
--
-- Retenção: 180 dias (cron da 1.11). PII (IP, UA) também cai junto.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_role    text,                          -- 'admin' | 'viewer' | null (pre-login)
  actor_label   text,                          -- email_hash ou identificador (sem PII crua)
  action        text NOT NULL,                 -- ex: login.success, ai.ask.canary_leak, admin.backfill_sck
  status        text NOT NULL DEFAULT 'ok',    -- 'ok' | 'denied' | 'error'
  ip            text,                          -- IP truncado (último octeto removido) — LGPD
  user_agent    text,                          -- UA simplified (browser+major version)
  resource      text,                          -- ex: '/api/ai/ask' '/api/admin/backfill-sck'
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id    text                           -- correlation id se disponível
);

CREATE INDEX IF NOT EXISTS audit_log_action_occurred_at_idx
  ON public.audit_log (action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_actor_occurred_at_idx
  ON public.audit_log (actor_label, occurred_at DESC)
  WHERE actor_label IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx
  ON public.audit_log (occurred_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- Sem policies → só service-role escreve/lê.
