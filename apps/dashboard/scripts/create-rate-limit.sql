-- Sprint 1 (#3) — Burst protect via Supabase RPC
--
-- Janela deslizante por chave (IP, user_id, endpoint, ou combinação). Não substitui
-- o login_attempts (lockout por conta) — é proteção contra bursts curtos em endpoints
-- caros (IA, login). Reset automático após p_window_seconds.
--
-- Uso (lib/rateLimit.ts chama via RPC):
--   select * from check_rate_limit('ai:user:UUID', 20, 60);  -- 20 req/min
--   -> { allowed: true, remaining: 19, reset_at: '...' }
--
-- Idempotente: rodar de novo é seguro.

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key           text        PRIMARY KEY,
  count         int         NOT NULL DEFAULT 0,
  window_start  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_updated_at_idx
  ON public.rate_limit_buckets (updated_at);

-- RLS: bloqueia acesso direto. Só service_role (server) usa via RPC.
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_limit_buckets_no_access ON public.rate_limit_buckets;
CREATE POLICY rate_limit_buckets_no_access
  ON public.rate_limit_buckets
  FOR ALL
  TO authenticated, anon
  USING (false);

-- RPC: checa-e-incrementa atomicamente.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
)
RETURNS TABLE (allowed boolean, remaining int, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
  v_window_age int;
  v_count int;
  v_window_start timestamptz;
BEGIN
  -- Upsert: cria bucket se não existe.
  INSERT INTO public.rate_limit_buckets AS b (key, count, window_start, updated_at)
  VALUES (p_key, 1, v_now, v_now)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                  WHEN EXTRACT(EPOCH FROM (v_now - b.window_start)) >= p_window_seconds
                    THEN 1                          -- janela expirou, reseta
                  ELSE b.count + 1                  -- mesma janela, incrementa
                END,
        window_start = CASE
                         WHEN EXTRACT(EPOCH FROM (v_now - b.window_start)) >= p_window_seconds
                           THEN v_now               -- nova janela
                         ELSE b.window_start        -- mantém
                       END,
        updated_at = v_now
  RETURNING b.count, b.window_start INTO v_count, v_window_start;

  RETURN QUERY SELECT
    (v_count <= p_limit)                                          AS allowed,
    GREATEST(p_limit - v_count, 0)                                AS remaining,
    (v_window_start + make_interval(secs => p_window_seconds))    AS reset_at;
END;
$$;

-- Cleanup: cron pode rodar isso periodicamente pra evitar bloat.
CREATE OR REPLACE FUNCTION public.purge_old_rate_limit_buckets(p_older_than_minutes int DEFAULT 60)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted int;
BEGIN
  WITH d AS (
    DELETE FROM public.rate_limit_buckets
    WHERE updated_at < now() - make_interval(mins => p_older_than_minutes)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM d;
  RETURN v_deleted;
END;
$$;

-- Permissões: só service_role.
REVOKE ALL ON FUNCTION public.check_rate_limit(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) TO service_role;

REVOKE ALL ON FUNCTION public.purge_old_rate_limit_buckets(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_rate_limit_buckets(int) TO service_role;
