-- 0032_organico_profile_watch_time.sql — watch time diário do canal (YouTube)
-- no perfil diário. Aditiva e instantânea (coluna nullable).
ALTER TABLE organic_profile_daily ADD COLUMN IF NOT EXISTS watch_time_s numeric;
