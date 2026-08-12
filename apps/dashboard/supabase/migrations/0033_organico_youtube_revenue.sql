-- 0033_organico_youtube_revenue.sql — receita do YouTube (escopo monetário).
-- Aditiva e instantânea. BRL. NULL = sem dado (canal não monetizado / escopo
-- não concedido) — nunca zero falso.
ALTER TABLE organic_profile_daily ADD COLUMN IF NOT EXISTS revenue numeric;
ALTER TABLE organic_profile_daily ADD COLUMN IF NOT EXISTS cpm numeric;
ALTER TABLE organic_posts ADD COLUMN IF NOT EXISTS revenue numeric;
