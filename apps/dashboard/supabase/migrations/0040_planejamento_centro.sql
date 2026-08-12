-- 0040_planejamento_centro.sql — Centro de Planejamento (consolidação financeira da operação).
-- Soma das Margens de Contribuição dos planejamentos − Despesas Fixas − Despesas Variáveis = Lucro Líquido.
-- 100% ADITIVO. Baseado na planilha "Centro de Planejamento e Projeção Financeira e de Funis".

-- Flag por planejamento: entra (ou não) na consolidação do Centro.
ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS incluir_consolidacao boolean NOT NULL DEFAULT true;

-- Config financeira do workspace (despesas fixas + variável %).
ALTER TABLE workspace_planejamento_config ADD COLUMN IF NOT EXISTS despesas_fixas jsonb NOT NULL DEFAULT '[]'::jsonb; -- [{ "nome": "Editor", "valor": 2200 }, ...]
ALTER TABLE workspace_planejamento_config ADD COLUMN IF NOT EXISTS pct_variavel numeric NOT NULL DEFAULT 0;           -- ex: 0.25 = 25% sobre faturamento (sócio/comissão)
