-- funis-demo-por-id.sql — troca as regras de produto do DEMO de NOME para ID Hotmart.
--
-- ⚠️ PRÉ-REQUISITOS (rodar fora de ordem desclassifica TODA venda do DEMO):
--   1. migration 0067 aplicada (coluna transacoes.produto_id + backfill do histórico);
--   2. código com produto_id no ar (webhook e reconciliação gravando o id);
--   3. conferência de cobertura sem surpresa:
--        SELECT produto, count(*) FILTER (WHERE produto_id IS NULL) AS sem_id, count(*)
--        FROM transacoes WHERE workspace_id='faafca5a-fb53-404f-8469-499d8869944c'
--        GROUP BY 1 ORDER BY sem_id DESC;
--      Uma regra `por:'id'` NÃO casa em linha com produto_id NULL — por isso o
--      backfill vem antes, nunca depois.
--
-- IDs conforme o painel da Hotmart (lista do dono, 07/08/2026):
--   PRODUTO_ID_DEMO Produto Demonstrativo          PRODUTO_ID_DEMO Script ANTI-Desconto
--   6974085 Lucro Tributário Express         6974308 Protocolo Dentista Parceiro Lucrativo
--   7526276 Manual de Encantamento no WhatsApp (ex-"Manual do Lucro Oculto no WhatsApp")
--   7438166 Protocolo LucroOculto            7478566 Implementação LucroOculto
--   7725347 Implementação Express Lucro Oculto
--
-- ── O LPS CONTINUA POR NOME, de propósito ───────────────────────────────────
-- "Imersão Lucro Clínico!" e "Desafio Lucro Odontológico" são o MESMO produto
-- (6990148) renomeado. O dono quer as duas eras separadas na análise — e o ID,
-- por definição, não separa o que é o mesmo produto. Então a regra do LPS fica
-- `por:'nome'` com match "imers": o ID identifica o PRODUTO, o nome identifica o
-- MOMENTO COMERCIAL. É o único caso em que nome é a chave certa, e é deliberado —
-- não é resíduo da régua antiga. Quando o Desafio começar a vender sob o nome
-- novo, ele entra como regra própria (match "desafio"), não no LPS.
--
-- FORA DE QUALQUER FUNIL, por decisão do dono (07/08/2026):
--   · 8217460 "Script Anti Desconto + Lucro Tributário Express" — combo que hoje
--     não é order bump de nada. Quando virar OB, somar o id ao match do papel.
--   · 7966194 "Programa Secretária Águia" — só vende para adicionar secretárias
--     ao programa; não é entrada de funil.
--   · 7869334 KIT Lucro Blindado / 8204315 Campanha Pronta / 8217416 Painel +
--     Campanhas / 8204066 Painel de Reativação.
-- PENDENTE: 7080012 "Programa Demonstrativo de Aceleração de Clínicas" é o high ticket
-- (14 vendas, R$ 5.600) e hoje não pertence a funil nenhum — falta decidir se
-- ganha funil próprio.

BEGIN;

UPDATE funis SET produtos = '[
  {"match":"PRODUTO_ID_DEMO","por":"id","papel":"front"},
  {"match":"PRODUTO_ID_DEMO","por":"id","papel":"ob","ordemOb":1},
  {"match":"6974085","por":"id","papel":"ob","ordemOb":2},
  {"match":"6974308","por":"id","papel":"ob","ordemOb":3},
  {"match":"7526276","por":"id","papel":"ob","ordemOb":4}
]'::jsonb
WHERE workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' AND slug = 'col';

UPDATE funis SET produtos = '[
  {"match":"6974308","por":"id","papel":"front"}
]'::jsonb
WHERE workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' AND slug = 'dpl';

-- PLO: downsell ANTES do upsell continua irrelevante aqui (ID é igualdade exata,
-- não há mais ambiguidade de ordem entre "implementa" e "implementa express") —
-- a ordem foi mantida só para o diff ficar legível contra a config antiga.
UPDATE funis SET produtos = '[
  {"match":"7725347","por":"id","papel":"downsell"},
  {"match":"7478566","por":"id","papel":"upsell"},
  {"match":"7438166","por":"id","papel":"front"}
]'::jsonb
WHERE workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c' AND slug = 'plo';

COMMIT;

-- Conferência depois de rodar: a distribuição por papel tem que bater com a de
-- antes (75% front / OB1..OB4), fora as linhas sem produto_id.
