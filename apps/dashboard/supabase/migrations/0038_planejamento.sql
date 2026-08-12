-- 0038_planejamento.sql — Planejamento de Ação de Vendas (evolução de acoes_vendas).
-- 100% ADITIVO + idempotente. Não dropa nada. Ações antigas seguem funcionando
-- (colunas novas ficam default/NULL e o código trata "modo legado").
-- Aplicar À MÃO no SQL editor do Supabase (DDL não roda via REST). Ver 0024/0027.
-- Workspace default DEMO = 'faafca5a-fb53-404f-8469-499d8869944c'.

-- ── 1) acoes_vendas: colunas novas (planejador) ───────────────────────────────
ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS sigla            text;   -- ^[A-Z0-9]{3,}$ (validado no app)
ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS thumbnail_url    text;
ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS config_impostos  jsonb NOT NULL DEFAULT '{}'::jsonb;  -- override por plano
ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS comparacao_kpis  jsonb NOT NULL DEFAULT '{}'::jsonb;  -- checklist previsto×realizado
ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS arquivada_em     timestamptz;                          -- soft-archive (NULL = ativa)
ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS is_planejamento  boolean NOT NULL DEFAULT false;       -- true = criada pelo novo planejador
ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS is_template      boolean NOT NULL DEFAULT false;       -- template reutilizável
CREATE INDEX IF NOT EXISTS acoes_vendas_ws_planej_idx ON acoes_vendas (workspace_id, is_planejamento, arquivada_em);
-- status continua text livre (sem CHECK no banco). Os novos estados entram como strings
-- validadas por whitelist no app (rascunho|planejando|planejado|acao_andamento|acao_concluida|arquivado
-- + legados ativo|encerrado).

-- ── 2) acao_cenarios: N cenários por ação (estado do simulador em jsonb) ───────
CREATE TABLE IF NOT EXISTS acao_cenarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  acao_id       uuid NOT NULL REFERENCES acoes_vendas(id) ON DELETE CASCADE,
  nome          text NOT NULL,                  -- 'Base' | 'A' | 'B' | 'Extra 1'...
  ordem         smallint NOT NULL DEFAULT 0,
  kind          text NOT NULL DEFAULT 'simulado' CHECK (kind IN ('simulado','real')),
  estado        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- SimuladorState (só p/ kind='simulado')
  is_melhor     boolean NOT NULL DEFAULT false,      -- cache do melhorCenario; autoridade = server
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()   -- usado p/ concorrência otimista (409)
);
CREATE INDEX IF NOT EXISTS acao_cenarios_acao_idx ON acao_cenarios (acao_id, ordem);
CREATE INDEX IF NOT EXISTS acao_cenarios_ws_idx   ON acao_cenarios (workspace_id);
-- no máximo 1 cenário 'real' por ação:
CREATE UNIQUE INDEX IF NOT EXISTS acao_cenarios_one_real ON acao_cenarios (acao_id) WHERE kind = 'real';

-- ── 3) acao_notas: notas por planejamento ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS acao_notas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  acao_id       uuid NOT NULL REFERENCES acoes_vendas(id) ON DELETE CASCADE,
  corpo         text NOT NULL DEFAULT '',
  autor_email   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acao_notas_acao_idx ON acao_notas (acao_id, created_at DESC);

-- ── 4) impostos + defaults por workspace ──────────────────────────────────────
-- A tabela `config` global NÃO é multi-tenant → tabela própria por workspace.
CREATE TABLE IF NOT EXISTS workspace_planejamento_config (
  workspace_id            uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  imposto_faturamento_pct numeric NOT NULL DEFAULT 0,       -- 0.06 = 6% sobre faturamento
  hotmart_pct_fee         numeric NOT NULL DEFAULT 0.084,   -- = HOTMART_PCT_FEE (lib/formatters.ts)
  hotmart_fixed_fee       numeric NOT NULL DEFAULT 3.49,    -- = HOTMART_FIXED_FEE_PER_SALE
  checklist_kpis_default  jsonb   NOT NULL DEFAULT '{}'::jsonb,  -- checklist padrão do workspace
  updated_at              timestamptz NOT NULL DEFAULT now()
);
-- NOTA: NÃO há coluna meta_tax_rate aqui de propósito. O imposto Meta já vem aplicado
-- em meta_ads.investimento durante o sync (taxRate ~1.1382 via getMetaConfig). Guardá-lo
-- aqui convidaria dupla-contagem. A projeção do previsto lê o taxRate de getMetaConfig.

-- ── RLS deny-all (só service-role; mesmo padrão das 0024-0037) ─────────────────
ALTER TABLE acao_cenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE acao_notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_planejamento_config ENABLE ROW LEVEL SECURITY;
