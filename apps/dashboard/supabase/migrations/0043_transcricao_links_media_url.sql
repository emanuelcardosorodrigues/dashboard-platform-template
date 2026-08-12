-- Adiciona coluna media_url à tabela transcricao_links.
-- Resolvida no submit pelo Vercel (IP não bloqueado) e armazenada aqui
-- para o worker VPS baixar diretamente do CDN (sem passar pelo Cloudflare).
ALTER TABLE transcricao_links ADD COLUMN IF NOT EXISTS media_url text;
