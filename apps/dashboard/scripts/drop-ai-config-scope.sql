-- Sprint 1 (#2) — DROP ai_config.scope
--
-- Contexto: na Fase 2.6 o escopo da IA deixou de ser independente — passou a ser
-- DERIVADO de allowed_paths. A chave `scope` dentro do JSONB ai_config ficou só
-- como fallback histórico. Validado em 2026-05-14: ZERO referências em código
-- (apenas o comentário no script alter-users-fase2-personalizacao.sql).
--
-- Como ai_config é JSONB (não coluna), usamos `jsonb - 'scope'` para remover a
-- chave de todos os registros. Idempotente: rodar de novo não quebra nada.
-- Use Transaction Pool no Supabase SQL Editor.

BEGIN;

-- 1) Snapshot dos registros que TINHAM scope (auditoria pré-mudança).
SELECT
  count(*) AS users_with_scope,
  jsonb_agg(DISTINCT id ORDER BY id) AS user_ids
FROM public.users
WHERE ai_config ? 'scope';

-- 2) Remove a chave `scope` de TODOS os ai_config que a contém.
UPDATE public.users
   SET ai_config = ai_config - 'scope'
 WHERE ai_config ? 'scope';

-- 3) Verificação pós-update: deve retornar 0.
SELECT count(*) AS still_has_scope
FROM public.users
WHERE ai_config ? 'scope';

-- Se still_has_scope = 0, fechar:
COMMIT;

-- Em caso de erro acima, fazer ROLLBACK em vez de COMMIT.
