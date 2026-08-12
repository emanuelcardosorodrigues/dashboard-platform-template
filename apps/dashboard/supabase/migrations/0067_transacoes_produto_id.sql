-- 0067_transacoes_produto_id.sql — ID do produto Hotmart na transação.
--
-- MOTIVO: a classificação de produto/funil casava por TRECHO DO NOME
-- (`funis.produtos[].match` com `por:'nome'`). Nome de produto na Hotmart é
-- editável — em 19/07/2026 "Manual do Lucro Oculto no WhatsApp" virou "Manual de
-- Encantamento no WhatsApp" e só não quebrou a classificação porque a palavra
-- "manual" sobreviveu por acaso. O ID do produto não muda: é a chave estável.
--
-- O campo `por:'id'` já existia no engine (lib/funisConfig.ts) mas era LETRA MORTA:
-- não havia coluna de ID na transação e nenhum caller passava o valor. Esta
-- migration cria a coluna; o webhook/reconciliação passam a gravá-la; só depois as
-- regras dos funis podem virar `por:'id'`.
--
-- ADITIVA: enquanto `produto_id` for NULL, as regras por NOME continuam valendo e
-- o comportamento é idêntico ao de hoje.

ALTER TABLE transacoes ADD COLUMN IF NOT EXISTS produto_id text;

CREATE INDEX IF NOT EXISTS transacoes_ws_produto_id_idx
  ON transacoes (workspace_id, produto_id);

-- ── Backfill do histórico do DEMO (nome → ID do painel da Hotmart) ─────────────
-- Só toca linhas com produto_id ainda NULL, e só do workspace DEMO. Idempotente.
-- Casamento por nome EXATO (não trecho) — é a última vez que confiamos no nome.
--
-- APLICADA em 07/08/2026 (via MCP): 2.201/2.201 linhas do DEMO com produto_id.
--
-- Dois produtos foram RENOMEADOS no painel — mesmo ID, nome novo (confirmado pelo dono):
--   'Imersão Lucro Clínico!'            → 'Desafio Lucro Odontológico'        (6990148)
--   'Manual do Lucro Oculto no WhatsApp' → 'Manual de Encantamento no WhatsApp' (7526276)
-- O ID entra nas DUAS eras: é o mesmo produto vendido. Quando as eras precisam ser
-- lidas separadamente (caso do LPS, que é a "Imersão"), a separação fica na regra do
-- funil por NOME — o ID identifica o produto, o nome identifica o momento comercial.

UPDATE transacoes t SET produto_id = m.id
FROM (VALUES
  ('Produto Demonstrativo',                  'PRODUTO_ID_DEMO'),
  ('Lucro Tributário Express',                 '6974085'),
  ('Script ANTI-Desconto',                     'PRODUTO_ID_DEMO'),
  ('Protocolo Dentista Parceiro Lucrativo',    '6974308'),
  ('Protocolo LucroOculto',                    '7438166'),
  ('Implementação LucroOculto',                '7478566'),
  ('Manual de Encantamento no WhatsApp',       '7526276'),
  ('Manual do Lucro Oculto no WhatsApp',       '7526276'),  -- nome antigo do mesmo produto
  ('Imersão Lucro Clínico!',                   '6990148'),  -- nome antigo do Desafio Lucro Odontológico
  ('Manual do Lucro Oculto no WhatsApp',       '7526276'),
  ('Programa Demonstrativo de Aceleração de Clínicas', '7080012'),
  ('Programa Secretária Águia',                '7966194'),
  ('KIT Lucro Blindado!',                      '7869334')
) AS m(nome, id)
WHERE t.workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c'
  AND t.produto = m.nome
  AND t.produto_id IS NULL;

-- Conferência (rodar depois; 'Imersão Lucro Clínico!' é a pendência esperada):
--   SELECT produto, count(*) FILTER (WHERE produto_id IS NULL) AS sem_id, count(*) AS total
--   FROM transacoes WHERE workspace_id = 'faafca5a-fb53-404f-8469-499d8869944c'
--   GROUP BY 1 ORDER BY sem_id DESC;
