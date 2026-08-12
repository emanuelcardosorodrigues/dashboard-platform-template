import { pageSlug } from './paginas'
import type { GA4PageRow } from './ga4'
import type { SbCheckoutHit } from './supabase'

/**
 * De onde veio o número de "chegou no checkout" de uma variante de página, do mais
 * preciso pro menos:
 *  - 'ab'   exato: interseção de uid com o checkout A/B vinculado
 *  - 'uid'  exato: interseção de uid com os cliques de checkout (GTM server-side lê o
 *           cookie HttpOnly no header Cookie) — mesma identidade, sem depender de vínculo
 *  - 'hits' aproximado (~GA): clicantes (cid do GA) ÷ usuários GA4 — identidade do GA
 */
export type CheckoutFonte = 'ab' | 'uid' | 'hits' | null

/** cids DISTINTOS que clicaram no CTA de checkout, por slug de página. */
export function buildHitCidsBySlug(hits: SbCheckoutHit[]): Map<string, Set<string>> {
  const bySlug = new Map<string, Set<string>>()
  for (const h of hits) {
    const s = (h.slug || '').toLowerCase()
    if (!s || !h.cid) continue
    if (!bySlug.has(s)) bySlug.set(s, new Set())
    bySlug.get(s)!.add(h.cid)
  }
  return bySlug
}

/**
 * uids DISTINTOS que clicaram no CTA de checkout, por slug de página — a identidade do
 * Worker, a MESMA de `impressions.uid`. Só existe pra quem entrou pelo /r/ (tráfego direto
 * não tem cookie uid); linha sem uid é ignorada, não vira zero.
 */
export function buildHitUidsBySlug(hits: SbCheckoutHit[]): Map<string, Set<string>> {
  const bySlug = new Map<string, Set<string>>()
  for (const h of hits) {
    const s = (h.slug || '').toLowerCase()
    if (!s || !h.uid) continue
    if (!bySlug.has(s)) bySlug.set(s, new Set())
    bySlug.get(s)!.add(h.uid)
  }
  return bySlug
}

/** Usuários distintos (client id) do GA4 por slug de página. */
export function buildGaUsersBySlug(gaPages: GA4PageRow[]): Map<string, number> {
  const bySlug = new Map<string, number>()
  for (const p of gaPages) {
    const s = pageSlug(p.pagePath)
    if (!s) continue
    bySlug.set(s, (bySlug.get(s) ?? 0) + (p.totalUsers || 0))
  }
  return bySlug
}

/**
 * A tag GTM grava o slug da URL que o visitante realmente viu. Isso nem sempre é
 * `variant.slug` (que é o rótulo de atribuição do sck) — ex: slug `col-pvia04-2906`
 * pra url `/p/col-pvia04/`. Tenta as duas chaves e une os cids (dedup por cid).
 */
export function variantHitCids(
  variant: { slug?: string; url?: string },
  hitCidsBySlug: Map<string, Set<string>>,
): Set<string> {
  const cids = new Set<string>()
  for (const k of [(variant.slug || '').toLowerCase(), pageSlug(variant.url || '')]) {
    if (!k) continue
    for (const cid of hitCidsBySlug.get(k) ?? []) cids.add(cid)
  }
  return cids
}

/**
 * Usuários GA4 da variante. Prefere o slug da URL — é a página que o visitante de fato
 * abriu, e é assim que o GA4 a nomeia. `variant.slug` só serve de reserva quando os dois
 * coincidem. Não soma as duas chaves: isso inflaria o denominador e afundaria a passagem.
 */
export function variantGaUsers(
  variant: { slug?: string; url?: string },
  gaUsersBySlug: Map<string, number>,
): number {
  const fromUrl = gaUsersBySlug.get(pageSlug(variant.url || ''))
  if (fromUrl !== undefined) return fromUrl
  return gaUsersBySlug.get((variant.slug || '').toLowerCase()) ?? 0
}

/** uids distintos por `experiment_id|variant` (clicks roteados OU views). */
export function buildUidsByExpVariant(
  rows: { experiment_id: string; variant: string; uid: string }[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const r of rows) {
    const k = `${r.experiment_id}|${r.variant}`
    if (!m.has(k)) m.set(k, new Set())
    m.get(k)!.add(r.uid)
  }
  return m
}

/**
 * Connect rate da variante = |uids roteados que TAMBÉM viram a página| ÷ |uids roteados|.
 *  - clickUids = uids que o 302 roteou (route_clicks)
 *  - viewUids  = uids que o beacon confirmou no load real (impressions, modo beacon)
 * A diferença é a perda no salto (página lenta / desistência) — quanto menor, melhor.
 *
 * É INTERSEÇÃO, não duas contagens soltas. O numerador é subconjunto do denominador,
 * então o resultado é matematicamente ≤100% — sem trava artificial. Isso importa porque
 * `impressions` acumula views há semanas e `route_clicks` só existe desde o deploy do
 * Worker (10/07/2026): dividir a contagem crua de views pela de clicks dava >100% travado
 * em 100% falso. Na interseção, view de uid que nunca foi roteado (histórico, orgânico,
 * tráfego direto) simplesmente não conta — o uid não está no conjunto de cliques.
 * Sem cliques na janela → null (mostra "—", nunca 0% nem 100% falso).
 */
export function resolveConnectRate(
  viewUids: Set<string>,
  clickUids: Set<string>,
): { routed: number; landed: number; rate: number | null } {
  const routed = clickUids.size
  if (routed === 0) return { routed: 0, landed: 0, rate: null }
  let landed = 0
  for (const uid of clickUids) if (viewUids.has(uid)) landed++
  return { routed, landed, rate: (landed / routed) * 100 }
}

/**
 * Amostra mínima de cliques roteados pro connect rate valer como NÚMERO, não ruído.
 * n=35 dá ±10 pontos a 95% de confiança perto de p≈0,9 (regime típico de connect rate:
 * 1,96²·0,9·0,1 / 0,10² ≈ 35). Abaixo disso o "%" oscila demais pra decidir nada.
 */
export const CONNECT_RATE_MIN_CLICKS = 35

export type ConnectRateDisplay =
  | { kind: 'value'; rate: number; routed: number; landed: number }
  | { kind: 'low-sample'; rate: number; routed: number; landed: number }
  | { kind: 'none' }

/**
 * Decide o que a UI mostra, pra nunca exibir um % que é ruído estatístico:
 *  - sem cliques na janela            → 'none'       (mostra "—")
 *  - abaixo da amostra mínima         → 'low-sample' (mostra "n baixo", esconde o %)
 *  - amostra suficiente               → 'value'      (mostra o %)
 * A fórmula já é exata (interseção); isto é sobre CONFIANÇA no número, não validade.
 */
export function connectRateDisplay(
  rate: number | null,
  routed: number,
  landed: number,
): ConnectRateDisplay {
  if (rate === null || routed === 0) return { kind: 'none' }
  if (routed < CONNECT_RATE_MIN_CLICKS) return { kind: 'low-sample', rate, routed, landed }
  return { kind: 'value', rate, routed, landed }
}

/**
 * Quantos visitantes desta variante chegaram ao checkout, em ordem de precisão:
 *  1. 'ab'   teste A/B de checkout vinculado → interseção de uid ÷ uids da variante (exato)
 *  2. 'uid'  cliques de checkout com uid (GTM server-side leu o cookie HttpOnly) →
 *            interseção de uid ÷ uids da variante (exato, e sem precisar de vínculo)
 *  3. 'hits' cliques só com cid do GA → cids distintos ÷ usuários GA4 (aprox., ~GA)
 *  4. nada → undefined. NUNCA 0, que a UI leria como "ninguém passou".
 *
 * O denominador SEMPRE acompanha o numerador — na mesma IDENTIDADE e na mesma JANELA.
 *  - identidade: o uid só existe pra quem entrou pelo /r/ do Worker; o cid do GA existe pra
 *    todo mundo. Dividir cid por uid dá passagem acima de 100% em página com tráfego direto.
 *  - janela: `pageUids` é a janela das impressões (sem filtro = tudo, ou seja, desde o início
 *    do experimento) e `pageUidsJanela` é a janela dos HITS (sem filtro = 30d). O tier 'uid'
 *    usa `pageUidsJanela`, senão um experimento com mais de 30 dias dividiria cliques de 30
 *    dias por views de 40+ e a passagem sairia menor que a real, encolhendo sozinha com o
 *    passar do tempo. Os tiers 'ab' (tudo vem de impressions) e 'hits' (tudo vem da janela
 *    de hits/GA4) já são internamente consistentes.
 */
export function resolveVariantCheckout(input: {
  pageUids: Set<string>
  /** Views na janela dos hits. Omitido → cai em `pageUids` (compat). */
  pageUidsJanela?: Set<string>
  linkedCheckoutUids: Set<string> | null
  hitUids: Set<string>
  hitCids: Set<string>
  gaUsers: number
}): { checkoutViews: number | undefined; checkoutFonte: CheckoutFonte; checkoutDenom: number } {
  const { pageUids, linkedCheckoutUids, hitUids, hitCids, gaUsers } = input
  const pageUidsJanela = input.pageUidsJanela ?? pageUids

  if (linkedCheckoutUids && linkedCheckoutUids.size > 0) {
    let inter = 0
    for (const uid of pageUids) if (linkedCheckoutUids.has(uid)) inter++
    return { checkoutViews: inter, checkoutFonte: 'ab', checkoutDenom: pageUids.size }
  }
  // Interseção com quem VIU a variante NA JANELA DOS HITS: um clique de uid que não viu esta
  // variante não conta (numerador ⊆ denominador → nunca passa de 100%, sem trava artificial).
  if (hitUids.size > 0 && pageUidsJanela.size > 0) {
    let inter = 0
    for (const uid of pageUidsJanela) if (hitUids.has(uid)) inter++
    if (inter > 0) return { checkoutViews: inter, checkoutFonte: 'uid', checkoutDenom: pageUidsJanela.size }
  }
  if (hitCids.size > 0) {
    return { checkoutViews: hitCids.size, checkoutFonte: 'hits', checkoutDenom: gaUsers }
  }
  return { checkoutViews: undefined, checkoutFonte: null, checkoutDenom: 0 }
}
