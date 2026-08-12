-- Fase 2.6 — personalização por usuário.
-- Adiciona colunas em public.users:
--   allowed_paths  text[]   — abas que o user vê (vazio = sem acesso a abas de dashboard)
--   phone          text     — contato (opcional)
--   avatar_url     text     — foto/avatar (opcional)
--   admin_notes    text     — notas internas só visíveis pra admin
--   default_filters jsonb   — filtros default aplicados ao logar (funil/conta/periodo)
--
-- O escopo da IA deixou de ser independente — agora é DERIVADO de allowed_paths.
-- ai_config.scope continua sendo lido como fallback se existir mas será ignorado
-- pela próxima Fase. Não removemos a coluna pra evitar quebrar runtime durante
-- a janela de deploy.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS allowed_paths   text[]  NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone           text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url      text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin_notes     text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS default_filters jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: admins sempre veem tudo (o role bypassa o allowed_paths no middleware).
-- Esse backfill é só pra deixar o registro consistente quando admin é exibido na UI.
UPDATE public.users
   SET allowed_paths = ARRAY[
     '/visao-geral','/criativos','/campanhas','/qualificacao','/funil',
     '/financeiro','/comparacao','/perfil-comprador','/voz-comprador',
     '/analise-estrategica','/experimentos','/quizzes','/saude-trafego',
     '/clarity','/notas-fiscais','/insights-ia'
   ]
 WHERE role = 'admin' AND cardinality(allowed_paths) = 0;

-- Backfill viewers existentes (se houver) com o preset clássico de 5 abas.
UPDATE public.users
   SET allowed_paths = ARRAY[
     '/visao-geral','/criativos','/campanhas','/funil','/financeiro'
   ]
 WHERE role = 'viewer' AND cardinality(allowed_paths) = 0;

-- Índice GIN pra futuras queries "quem tem acesso a /X?".
CREATE INDEX IF NOT EXISTS users_allowed_paths_idx
  ON public.users USING GIN (allowed_paths);
