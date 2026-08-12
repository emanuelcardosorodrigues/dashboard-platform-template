-- 0060_hotmart_refund_tombstones.sql
-- Tombstone de estorno (cross-cutting A). O webhook Hotmart entrega eventos FORA
-- DE ORDEM: se PURCHASE_REFUNDED chega ANTES do PURCHASE_APPROVED, o
-- `update transacoes set status=... where hotmart_id` atinge 0 linhas (a compra
-- ainda não existe) e o estorno se perde — depois o APPROVED insere SEM status
-- (default = receita) e a transação estornada infla o faturamento/Lucro (que o
-- "Copiar ID do maior lucro" e os nós do Perpétuo consomem).
--
-- Solução order-independent: todo estorno grava um tombstone permanente por
-- hotmart_id; o APPROVED consulta o tombstone antes de inserir e, se existir,
-- escreve a transação já como não-receita. Cobre refund-antes, refund-depois e
-- entrega DUPLICADA do APPROVED (que "ressuscitaria" a receita).
--
-- Aditiva. RLS deny-all (service-role only), molde de creative_tags (0058).

CREATE TABLE IF NOT EXISTS hotmart_refund_tombstones (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL DEFAULT 'faafca5a-fb53-404f-8469-499d8869944c' REFERENCES workspaces(id) ON DELETE CASCADE,
  hotmart_id    text NOT NULL,
  status        text NOT NULL,                 -- refunded | chargeback | protest | canceled
  event         text,                          -- evento Hotmart que originou (auditoria)
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, hotmart_id)
);

ALTER TABLE hotmart_refund_tombstones ENABLE ROW LEVEL SECURITY;
