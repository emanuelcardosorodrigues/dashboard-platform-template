-- ============================================================================
-- Sync da Meta a cada 30 min via pg_cron + pg_net (100% Supabase + Vercel)
-- Substitui o GitHub Actions e o cron-job.org. Roda dentro do Supabase e
-- chama o endpoint /api/cron/sync-meta (Vercel) com Bearer CRON_SECRET.
-- Colar no Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Idempotente: pode rodar mais de uma vez sem duplicar.
-- ⚠️ SEGREDO: este arquivo NÃO contém o CRON_SECRET real (placeholder abaixo).
--    Cole o valor ROTACIONADO só no SQL Editor na hora de rodar; nunca commite o valor.
-- ============================================================================

-- 1. pg_net (pg_cron já vem instalado no Supabase)
create extension if not exists pg_net;

-- 2. Credenciais no Vault (não ficam em texto na cron.job)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'dash_cron_secret') then
    -- ⚠️ SEGREDO: NUNCA commitar o valor real. O CRON_SECRET rotacionado deve ser
    -- colado aqui na hora de rodar (SQL Editor do Supabase) e o arquivo NÃO deve ser
    -- salvo/commitado com o valor. O valor antigo que estava aqui foi ROTACIONADO e queimado.
    perform vault.create_secret(
      '__COLE_O_CRON_SECRET_ROTACIONADO_AQUI__',
      'dash_cron_secret',
      'Bearer token dos /api/cron/* do dashboard DEMO'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'dash_base_url') then
    perform vault.create_secret(
      'https://dashboard.example.com',
      'dash_base_url',
      'URL base de producao do dashboard DEMO'
    );
  end if;
end $$;

-- 3. (Re)agenda o job a cada 30 min
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-meta-30min') then
    perform cron.unschedule('sync-meta-30min');
  end if;
end $$;

select cron.schedule(
  'sync-meta-30min',
  '*/30 * * * *',
  $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'dash_base_url')
             || '/api/cron/sync-meta?days=2',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dash_cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $job$
);

-- 4. Conferir que ficou agendado
select jobid, jobname, schedule, active from cron.job where jobname = 'sync-meta-30min';

-- ============================================================================
-- VERIFICAÇÃO (rodar daqui ~30 min, depois do primeiro disparo):
--
--   -- execuções do job:
--   select d.status, d.return_message, d.start_time
--   from cron.job_run_details d
--   join cron.job j on j.jobid = d.jobid
--   where j.jobname = 'sync-meta-30min'
--   order by d.start_time desc limit 5;
--
--   -- resposta HTTP do endpoint (espera status_code 200):
--   select id, status_code, created from net._http_response
--   order by created desc limit 5;
--
-- PARA DESLIGAR (se algum dia precisar):
--   select cron.unschedule('sync-meta-30min');
-- ============================================================================
