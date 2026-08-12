/**
 * Atribuição de receita por post orgânico — o loop fechado.
 *
 * Realidade do pipeline: o webhook Hotmart grava utm_content em
 * `transacoes.criativo` e o sck em `sck_slug`. O encurtador (Onda 6) carimba
 * utm_content = external_id do post e sck = org_{plataforma}_{external_id}.
 * Match: criativo OU sck_slug ∈ {external_id, org_{plataforma}_{external_id}},
 * com guarda de origem orgânica (classifyOrigem) — um external_id que por
 * coincidência apareça num utm de anúncio NÃO conta.
 *
 * Post sem link rastreado → receita NULL (gap honesto, nunca R$ 0 falso).
 */
import { classifyOrigem } from '@/lib/origem'
import { REFUND_STATUSES, type SbTransacao } from '@/lib/supabase'

export interface ReceitaPost {
  receita: number
  vendas: number
}

export function sckForPost(platform: string, externalId: string): string {
  return `org_${platform}_${externalId}`
}

export function computeOrganicRevenue(
  transacoes: Pick<SbTransacao, 'criativo' | 'sck_slug' | 'valor_bruto' | 'status' | 'utm_source_ultimo' | 'utm_source_primeiro' | 'utm_medium_ultimo' | 'utm_medium_primeiro' | 'ad_id' | 'ad_id_primeiro'>[],
  posts: Array<{ id: string; platform: string; external_id: string }>,
): Map<string, ReceitaPost> {
  // índice token → postId (external_id direto e o sck org_*)
  const byToken = new Map<string, string>()
  for (const p of posts) {
    byToken.set(p.external_id, p.id)
    byToken.set(sckForPost(p.platform, p.external_id), p.id)
  }

  const out = new Map<string, ReceitaPost>()
  for (const t of transacoes) {
    if (t.status && REFUND_STATUSES.has(t.status)) continue
    const postId = byToken.get(t.criativo ?? '') ?? byToken.get(t.sck_slug ?? '')
    if (!postId) continue
    // guarda: só conta se a transação é de origem orgânica
    if (classifyOrigem(t as SbTransacao) !== 'organico') continue
    const cur = out.get(postId) ?? { receita: 0, vendas: 0 }
    cur.receita += t.valor_bruto ?? 0
    cur.vendas += 1
    out.set(postId, cur)
  }
  return out
}
