-- 0047_yt_reply_cursor.sql
-- Cursor de paginação de replies POR raiz. Sem ele, uma thread com >2000
-- respostas (teto de páginas) ou interrompida por tempo/quota no meio da raiz
-- ou (a) perdia replies silenciosamente ao marcar replies_fetched=true, ou
-- (b) re-baixava da página 1 no "Continuar" (queima quota). Com o cursor, a
-- fase replies retoma exatamente de onde parou aquela raiz.
-- Aditiva, nullable. Só é preenchido em raízes parcialmente processadas.

ALTER TABLE yt_extracted_comments ADD COLUMN IF NOT EXISTS reply_cursor text;
