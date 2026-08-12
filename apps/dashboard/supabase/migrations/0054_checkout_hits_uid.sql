-- 0054_checkout_hits_uid.sql
-- Passagem pro checkout EXATA (uid÷uid), sem tocar no GTM web compartilhado.
--
-- O cookie `uid` do Worker A/B é `Domain=.example.com; HttpOnly; SameSite=Lax`.
-- HttpOnly bloqueia o JS (document.cookie), mas NÃO bloqueia a transmissão HTTP: o
-- browser manda o `uid` no header Cookie de qualquer request first-party — inclusive
-- pro GTM SERVER-SIDE (Stape, ts.example.com). Ou seja, o container server-side
-- (que é NOSSO, não o web GTM-MCZKSV8N compartilhado) já recebe o uid e pode repassá-lo
-- no POST que ele já faz pra /api/checkout-hit.
--
-- Com o uid no clique de checkout, a passagem deixa de ser aproximada (cid do GA ÷
-- usuários GA4) e vira interseção na MESMA identidade do denominador (uids de view do
-- beacon): |quem viu a página E clicou pro checkout| ÷ |quem viu a página|.
-- Nulo quando o visitante não veio pelo /r/ (sem cookie uid) → cai no ~GA de sempre.
--
-- Aditiva e retrocompatível: coluna NULLABLE, nenhum backfill, nenhum leitor quebra.
-- A UNIQUE de dedup (workspace_id, slug, cid, dia) NÃO muda — o uid é identidade extra
-- na mesma linha, não uma nova chave.

ALTER TABLE checkout_hits ADD COLUMN IF NOT EXISTS uid text;

-- leitura da passagem exata: uids distintos por slug na janela.
CREATE INDEX IF NOT EXISTS idx_checkout_hits_ws_slug_uid
  ON checkout_hits (workspace_id, slug, uid) WHERE uid IS NOT NULL;

COMMENT ON COLUMN checkout_hits.uid IS
  'Cookie uid do Worker A/B, lido server-side pelo GTM server (Stape) no header Cookie. '
  'Mesma identidade de impressions.uid → passagem exata por interseção. NULL = visitante '
  'que não passou pelo /r/ (tráfego direto/orgânico) → passagem cai no aproximado ~GA (cid).';
