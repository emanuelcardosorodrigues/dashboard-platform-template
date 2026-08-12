-- 0039_planejamento_perpetuo.sql — opção "perpétuo" para ações de venda.
-- Qualquer tipo (lançamento pago, low ticket, VSL) pode ser perpétuo: nesse caso
-- NÃO exige janela de datas (data_inicio/data_fim ficam opcionais) e a "Previsão"
-- pelo pace deixa de projetar (não há fim). 100% ADITIVO.

ALTER TABLE acoes_vendas ADD COLUMN IF NOT EXISTS perpetuo boolean NOT NULL DEFAULT false;
