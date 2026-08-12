-- 0052_purge_rate_limit_buckets.sql
-- Agenda a purga dos buckets de rate-limit.
--
-- A função purge_old_rate_limit_buckets já existia (scripts/create-rate-limit.sql)
-- mas NUNCA foi agendada → os buckets acumulavam pra sempre. Com o link-hit agora
-- rate-limitado por (ws,slug) — chave parcialmente controlável por quem chama a
-- rota pública — isso vira vetor de bloat. Buckets são janelas de <=60s; apagar os
-- intocados há >60min é seguro. Beneficia também o checkout-hit (keyado por IP).
--
-- Aditiva e idempotente.

do $$
begin
  perform cron.unschedule('purge-rate-limit-buckets');
exception when others then
  null; -- job ainda não existe: segue
end $$;

select cron.schedule(
  'purge-rate-limit-buckets',
  '17 * * * *',                                    -- de hora em hora, aos :17
  $$ select public.purge_old_rate_limit_buckets(60) $$
);
