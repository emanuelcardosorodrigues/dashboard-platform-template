-- Habilita RLS em todas as tabelas
-- Efeito: acesso via anon key bloqueado por padrão
-- service_role (usado pelo servidor) continua com acesso total (bypassa RLS)

ALTER TABLE transacoes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_ads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualificacao  ENABLE ROW LEVEL SECURITY;
ALTER TABLE config        ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas se existirem
DROP POLICY IF EXISTS "Bloquear acesso publico" ON transacoes;
DROP POLICY IF EXISTS "Bloquear acesso publico" ON meta_ads;
DROP POLICY IF EXISTS "Bloquear acesso publico" ON qualificacao;
DROP POLICY IF EXISTS "Bloquear acesso publico" ON config;

-- Sem nenhuma política criada + RLS ativo = tudo bloqueado para anon/authenticated
-- service_role bypassa RLS automaticamente (comportamento do Supabase/PostgreSQL)
