-- 0064 — Camada de dados do carrossel: tipo do criativo + cards do child_attachments.
--
-- Destrava o preview de carrossel no popup do anúncio (a UI é follow-up). Populado
-- por /api/cron/backfill-creatives, que lê o `creative` do Meta ad-a-ad.
--
-- Aditiva/idempotente (ADD COLUMN IF NOT EXISTS). NÃO aplicar aqui — o coordenador aplica.
--   • tipo_criativo   já existe em prod; reafirmado por idempotência (não recria/não zera).
--   • child_attachments é a coluna nova (jsonb com os cards do carrossel).
-- Nenhuma métrica é tocada; ambas convivem com o unique existente (data, ad_id).

alter table public.meta_ads add column if not exists tipo_criativo text;      -- 'carousel' | 'video' | 'image' | 'dynamic'
alter table public.meta_ads add column if not exists child_attachments jsonb;  -- [{title,image_url,link}] — só quando carrossel

comment on column public.meta_ads.tipo_criativo is
  'Tipo do criativo derivado do creative do Meta: carousel|video|image|dynamic. Populado por /api/cron/backfill-creatives.';
comment on column public.meta_ads.child_attachments is
  'Cards do carrossel [{title,image_url,link}] quando tipo_criativo=carousel; NULL caso contrário. image_url é URL fbcdn assinada (expira ~dias) — o cron diário re-resolve.';
