/**
 * Análise de Páginas — núcleo determinístico (sem JSX, testável).
 *
 * Cruza GA4 (sessões por pagePath) × Hotmart (vendas front por sck) × motor A/B
 * (UIDs por página/checkout) × Clarity (scroll/UX por URL), tudo pela CHAVE = slug.
 *
 * Métricas por página:
 *  - Passagem pro checkout %  = |UIDs(página) ∩ UIDs(checkout)| ÷ |UIDs únicos da página|  (nota SC omdl8p9nvstv/cy865cjxkh85)
 *  - Conversão página→front % = vendas front ÷ base (UIDs únicos, senão sessões GA4)
 *  - Ticket médio             = faturamento front ÷ vendas front
 *  - CVR Checkout %, Scroll/UX (Clarity), Receita líquida
 *  + Diagnóstico automático de gargalo (árvore SC 0uxw2oqhg4yu, adaptada aos sinais por página).
 *
 * GOTCHA de dado (SC k625lvfqvivi): o denominador de UIDs depende de a impressão
 * ser logada no LOAD real (beacon /r/i) e não no redirect (302). `uidSource`
 * marca a origem pra a UI avisar (senão a conversão por página fica subavaliada
 * vs o connect rate do Meta).
 */
import type { GA4PageRow } from './ga4'
import { tipoDaTransacao, detectFunil, type SbTransacao, type SbExperiment, type SbImpressionUid, type SbClarityDaily, type SbCheckoutHit } from './supabase'
import { liquidoHotmartVenda } from './hotmartFees'
import { getSemaforoColor, getClarityColor } from './thresholds'
import type { SemaforoColor } from '@/types'

/** Cor de semáforo + 'gray' pra "sem dado". */
export type PaginaCor = SemaforoColor | 'gray'

// ── Normalização de slug (uma fonte da verdade) ──────────────────────────────
export function pageSlug(path: string): string {
  const clean = (path || '').split('?')[0].split('#')[0]
  const segs = clean.split('/').filter(Boolean)
  return (segs[segs.length - 1] || '').toLowerCase()
}
export function sckSlug(sck: string): string {
  // "col-pv02" ou composto "col-pv02_ckck01_obob02" → 1º segmento (hífen faz parte do slug).
  return (sck || '').split('_')[0].trim().toLowerCase()
}
export function slugFromClarityUrl(url: string): string {
  // dimensao_valor do Clarity é a URL canônica (origin+pathname) — mesma regra do pageSlug.
  return pageSlug((url || '').replace(/^https?:\/\/[^/]+/i, ''))
}

// ── Tipos ────────────────────────────────────────────────────────────────────
export type Gargalo = 'engajamento' | 'copy' | 'checkout' | 'congruencia' | 'ok' | 'insuficiente'

export interface Diagnostico {
  gargalo: Gargalo
  cor: PaginaCor
  texto: string
  acao: string
}

export interface PaginaRow {
  slug: string
  funil: string | null
  // volumes
  sessionsGa4: number
  uidsPagina: number
  checkoutInter: number
  frontSales: number
  receitaBruta: number
  receitaLiquida: number
  // sinal de checkout: existe experimento checkout VINCULADO a esta página (com
  // impressões)? Sem ele, "passagem" é imensurável (não zero) — evita 0% falso vermelho.
  temSinalCheckout: boolean
  // clicantes distintos no checkout via tag GTM (checkout_hits) — cobre página sem A/B
  hitClicantes: number
  // dos que VIRAM a página, quantos clicaram pro checkout — interseção de uid (exato).
  // Só quem veio pelo /r/ tem uid; o GTM server-side lê o cookie HttpOnly no header.
  hitUidInter: number
  // fonte da passagem, do mais preciso pro menos:
  //   'ab'   interseção de uid com o checkout A/B vinculado (exato)
  //   'uid'  interseção de uid com os cliques de checkout (exato, sem precisar de vínculo)
  //   'hits' cid do GA ÷ usuários GA4 (aproximado, ~GA)
  passagemFonte: 'ab' | 'uid' | 'hits' | null
  // métricas
  passagemCheckoutPct: number | null
  convPaginaFrontPct: number | null
  cvrCheckoutPct: number | null
  ticketMedio: number | null
  convBase: 'uid' | 'ga4' | 'na'
  // clarity
  scrollDepthPct: number | null
  engagementSec: number | null
  rageClicks: number | null
  claritySessions: number | null
  // flags
  temUid: boolean
  temGa4: boolean
  temClarity: boolean
  soHotmart: boolean
  // diagnóstico
  diag: Diagnostico
}

export interface PageAnalysisResult {
  rows: PaginaRow[]
  uidSource: 'beacon' | 'redirect' | 'desconhecido'
  totals: { paginas: number; comUid: number; comClarity: number; sessoes: number; vendasFront: number; receitaLiquida: number }
}

// cores por métrica (reusa thresholds canônicos)
function corPassagem(v: number | null): PaginaCor { return v == null ? 'gray' : getSemaforoColor('taxaPassagemCheckout', v) }
function corConv(v: number | null): PaginaCor { return v == null ? 'gray' : getSemaforoColor('txConversaoPagina', v) }
function corCheckout(v: number | null): PaginaCor { return v == null ? 'gray' : getSemaforoColor('cvrCheckout', v) }
function corScroll(v: number | null): PaginaCor { return v == null ? 'gray' : getClarityColor('scroll_depth_pct', v) }

/**
 * Árvore de diagnóstico (SC 0uxw2oqhg4yu), adaptada aos sinais disponíveis POR
 * PÁGINA — descarta upstream antes de downstream (cada etapa é pré-condição da
 * próxima): engajamento (scroll) → leva ao checkout (passagem) → fecha (CVR checkout).
 */
export function diagnosticarPagina(r: Pick<PaginaRow, 'scrollDepthPct' | 'passagemCheckoutPct' | 'cvrCheckoutPct' | 'convPaginaFrontPct' | 'frontSales' | 'uidsPagina' | 'sessionsGa4'>): Diagnostico {
  const temBase = (r.uidsPagina > 0 || r.sessionsGa4 > 0)
  if (!temBase) {
    return { gargalo: 'insuficiente', cor: 'gray', texto: 'Sem tráfego rastreável nesta página no período (sem UIDs A/B nem sessões GA4).', acao: 'Confirmar GTM/click tracker e roteamento A/B da página.' }
  }
  // 1. Engajamento (Clarity scroll) — upstream: se ninguém rola, o resto não importa.
  if (r.scrollDepthPct != null && r.scrollDepthPct < 40) {
    return { gargalo: 'engajamento', cor: 'red', texto: 'Visitantes quase não rolam a página — primeira dobra/carregamento/gancho não estão prendendo.', acao: 'Atacar velocidade/connect rate (skill 90plus-page-cf-worker) e a primeira dobra.' }
  }
  // 2. Passagem pro checkout — a página leva ao CTA?
  if (r.passagemCheckoutPct != null && r.passagemCheckoutPct < 15) {
    return { gargalo: 'copy', cor: 'red', texto: 'A página não está levando ao checkout — chega gente, mas poucos clicam pra comprar. Em low-ticket o que falta é DESEJO, não preço.', acao: 'Reescrever copy/oferta e fortalecer o CTA; considerar squad de página.' }
  }
  // 3. CVR Checkout — chegam ao checkout mas fecham?
  if (r.cvrCheckoutPct != null && r.cvrCheckoutPct < 30) {
    return { gargalo: 'checkout', cor: 'red', texto: 'Fricção no checkout — visitantes chegam ao checkout mas não concluem a compra.', acao: 'Revisar o checkout (campos, preço, order bumps, congruência da oferta).' }
  }
  // 4. Congruência transversal (SC heendj4p0ivl): passagem boa mas conversão final fraca.
  if (r.passagemCheckoutPct != null && r.passagemCheckoutPct >= 15 && r.convPaginaFrontPct != null && r.convPaginaFrontPct < 1.5) {
    return { gargalo: 'congruencia', cor: 'yellow', texto: 'Boa passagem pro checkout, mas conversão final baixa — possível quebra de congruência entre página, checkout e oferta.', acao: 'Conferir se anúncio→página→checkout→produto contam a MESMA mensagem central.' }
  }
  // Saudável (amarelo se conversão mediana)
  const cor: PaginaCor = corConv(r.convPaginaFrontPct)
  return { gargalo: 'ok', cor, texto: cor === 'green' ? 'Página saudável — conversão dentro do alvo.' : 'Página ok, com espaço pra melhorar a conversão.', acao: cor === 'green' ? 'Escalar tráfego pra esta página.' : 'Testar variação de copy/CTA (lateralizar) pra subir a conversão.' }
}

// ── Agregador principal ──────────────────────────────────────────────────────
export function buildPageAnalysis(input: {
  gaPages: GA4PageRow[]
  transacoes: SbTransacao[] // já filtradas por data (e funil, se aplicável) pelo caller
  experiments: SbExperiment[]
  impressionUids: SbImpressionUid[]
  clarityRows: SbClarityDaily[]
  checkoutHits?: SbCheckoutHit[]
  funil?: string
}): PageAnalysisResult {
  // funil global vem como 'col-'/'dpl-'/'lps-'/'plo'; detectFunil devolve 'col'/'dpl'/'lps'/'plo'.
  const nf = !input.funil || input.funil === 'all' ? null : input.funil.replace(/-$/, '').toLowerCase()
  const funilOk = (slug: string) => nf == null || detectFunil(slug) === nf

  // 1. GA4 sessões por slug (+ usuários distintos, que denominam os cliques da tag GTM)
  const sessBySlug = new Map<string, number>()
  const usersBySlug = new Map<string, number>()
  for (const p of input.gaPages) {
    const s = pageSlug(p.pagePath)
    if (!s) continue
    sessBySlug.set(s, (sessBySlug.get(s) ?? 0) + (p.sessions || 0))
    usersBySlug.set(s, (usersBySlug.get(s) ?? 0) + (p.totalUsers || 0))
  }

  // 2. UIDs por experimento/variante (interseção pro passthrough) — igual experimentos/page.tsx
  const uidsByExpVariant = new Map<string, Set<string>>()
  const uidsByExp = new Map<string, Set<string>>()
  for (const imp of input.impressionUids) {
    const vk = `${imp.experiment_id}|${imp.variant}`
    if (!uidsByExpVariant.has(vk)) uidsByExpVariant.set(vk, new Set())
    uidsByExpVariant.get(vk)!.add(imp.uid)
    if (!uidsByExp.has(imp.experiment_id)) uidsByExp.set(imp.experiment_id, new Set())
    uidsByExp.get(imp.experiment_id)!.add(imp.uid)
  }
  const checkoutUidsByPath = new Map<string, Set<string>>()
  for (const exp of input.experiments) {
    if (exp.type !== 'checkout') continue
    // Dois checkout-experiments podem dividir o MESMO entry_path (ex: variações de
    // mobile/desktop). UNE os UIDs em vez de sobrescrever — senão a passagem pro
    // checkout perde os UIDs do experimento que ficou de fora.
    const acc = checkoutUidsByPath.get(exp.entry_path) ?? new Set<string>()
    for (const u of uidsByExp.get(exp.id) ?? new Set<string>()) acc.add(u)
    checkoutUidsByPath.set(exp.entry_path, acc)
  }
  // Acumula UIDs (página) + interseção (checkout) POR SLUG (slug = variant.slug do page-exp)
  const uidSetBySlug = new Map<string, Set<string>>()
  const checkoutInterUidBySlug = new Map<string, Set<string>>()
  // Marca se a página tem QUALQUER experimento checkout vinculado COM impressões. Sem
  // ele, checkoutInter=0 não significa "0% passaram", significa "não dá pra medir" —
  // senão a passagem vira 0% vermelho falso e o diagnóstico acusa "copy" sem motivo.
  const checkoutSignalBySlug = new Map<string, boolean>()
  for (const exp of input.experiments) {
    if (exp.type !== 'page') continue
    const linkedCheckout = exp.checkout_slug ? checkoutUidsByPath.get(exp.checkout_slug) ?? null : null
    const hasCkSignal = !!linkedCheckout && linkedCheckout.size > 0
    for (const v of exp.variants) {
      const slug = (v.slug || pageSlug(v.url || '')).toLowerCase()
      if (!slug) continue
      const pageUids = uidsByExpVariant.get(`${exp.id}|${v.name}`) ?? new Set<string>()
      const acc = uidSetBySlug.get(slug) ?? new Set<string>()
      const inter = checkoutInterUidBySlug.get(slug) ?? new Set<string>()
      for (const uid of pageUids) {
        acc.add(uid)
        if (linkedCheckout && linkedCheckout.has(uid)) inter.add(uid)
      }
      uidSetBySlug.set(slug, acc)
      checkoutInterUidBySlug.set(slug, inter)
      checkoutSignalBySlug.set(slug, (checkoutSignalBySlug.get(slug) ?? false) || hasCkSignal)
    }
  }

  // 3. Hotmart front por slug
  const hotBySlug = new Map<string, { frontSales: number; receita: number; liquido: number }>()
  for (const t of input.transacoes) {
    if ((t.valor_bruto || 0) <= 1) continue
    if (tipoDaTransacao(t) !== 'frontEnd') continue
    const s = sckSlug(t.sck_slug || '')
    if (!s) continue
    const cur = hotBySlug.get(s) ?? { frontSales: 0, receita: 0, liquido: 0 }
    cur.frontSales += 1
    cur.receita += t.valor_bruto || 0
    cur.liquido += liquidoHotmartVenda(t.valor_bruto || 0) // líquido POR transação (canônico)
    hotBySlug.set(s, cur)
  }

  // 4. Clarity por slug (recorte url) — média ponderada de scroll/engajamento
  const clarityBySlug = new Map<string, { sessions: number; scrollW: number; engW: number; rage: number }>()
  for (const c of input.clarityRows) {
    if (c.recorte !== 'url') continue
    const s = slugFromClarityUrl(c.dimensao_valor || '')
    if (!s) continue
    const sess = c.sessions || 0
    const cur = clarityBySlug.get(s) ?? { sessions: 0, scrollW: 0, engW: 0, rage: 0 }
    cur.sessions += sess
    cur.scrollW += (c.scroll_depth_pct || 0) * sess
    cur.engW += (c.engagement_time_sec || 0) * sess
    cur.rage += c.rage_clicks || 0
    clarityBySlug.set(s, cur)
  }

  // 5. Cliques de checkout via GTM (checkout_hits) — clicantes DISTINTOS por slug.
  //    Duas identidades por linha: `cid` (GA, todo mundo tem) e `uid` (cookie do Worker,
  //    só quem veio pelo /r/ — o GTM server-side lê o HttpOnly no header Cookie).
  //    O uid dá passagem EXATA (mesma identidade das views); o cid dá o ~GA aproximado.
  const hitCidsBySlug = new Map<string, Set<string>>()
  const hitUidsBySlug = new Map<string, Set<string>>()
  for (const h of input.checkoutHits ?? []) {
    const s = (h.slug || '').toLowerCase()
    if (!s) continue
    if (h.cid) {
      if (!hitCidsBySlug.has(s)) hitCidsBySlug.set(s, new Set())
      hitCidsBySlug.get(s)!.add(h.cid)
    }
    if (h.uid) {
      if (!hitUidsBySlug.has(s)) hitUidsBySlug.set(s, new Set())
      hitUidsBySlug.get(s)!.add(h.uid)
    }
  }

  // União de todos os slugs vistos em qualquer fonte
  const slugs = new Set<string>([...sessBySlug.keys(), ...uidSetBySlug.keys(), ...hotBySlug.keys(), ...clarityBySlug.keys(), ...hitCidsBySlug.keys()])

  const rows: PaginaRow[] = []
  for (const slug of slugs) {
    if (!funilOk(slug)) continue
    const sessionsGa4 = sessBySlug.get(slug) ?? 0
    const uidsPagina = uidSetBySlug.get(slug)?.size ?? 0
    const checkoutInter = checkoutInterUidBySlug.get(slug)?.size ?? 0
    const temSinalCheckout = checkoutSignalBySlug.get(slug) ?? false
    const hitClicantes = hitCidsBySlug.get(slug)?.size ?? 0
    // Interseção: dos uids que VIRAM esta página, quantos clicaram pro checkout.
    // Numerador ⊆ denominador (uidsPagina) → nunca passa de 100%, sem trava artificial.
    const pageUidSet = uidSetBySlug.get(slug)
    const hitUidSet = hitUidsBySlug.get(slug)
    let hitUidInter = 0
    if (pageUidSet && hitUidSet) {
      for (const u of pageUidSet) if (hitUidSet.has(u)) hitUidInter++
    }
    const hot = hotBySlug.get(slug) ?? { frontSales: 0, receita: 0, liquido: 0 }
    const cl = clarityBySlug.get(slug)

    const convBase: 'uid' | 'ga4' | 'na' = uidsPagina > 0 ? 'uid' : sessionsGa4 > 0 ? 'ga4' : 'na'
    const base = convBase === 'uid' ? uidsPagina : convBase === 'ga4' ? sessionsGa4 : 0

    // Passagem pro checkout, em ordem de precisão:
    //  1. 'ab'   teste A/B de checkout vinculado → interseção de uid ÷ uids da página (exato)
    //  2. 'uid'  cliques com uid (GTM server-side leu o cookie HttpOnly no header Cookie) →
    //            interseção de uid ÷ uids da página (exato, sem depender de vínculo)
    //  3. 'hits' cliques só com cid do GA → cids distintos ÷ USUÁRIOS GA4 (aprox., ~GA)
    //  4. nada → null (—), NUNCA 0% falso (que o diagnóstico leria como gargalo de copy)
    //
    // O denominador SEMPRE acompanha a identidade do numerador. `hitClicantes` conta cid do
    // GA, que existe pra todo visitante; `uidsPagina` conta o cookie do Worker, que só existe
    // pra quem entrou pelo /r/. Dividir um pelo outro passava de 100% em página com tráfego
    // direto — e o Math.min(100) só disfarçava, virando "passagem perfeita" falsa.
    const usersGa4 = usersBySlug.get(slug) ?? 0
    const baseHits = usersGa4 || sessionsGa4
    let passagemCheckoutPct: number | null
    let passagemFonte: 'ab' | 'uid' | 'hits' | null
    if (uidsPagina > 0 && temSinalCheckout) {
      passagemCheckoutPct = (checkoutInter / uidsPagina) * 100
      passagemFonte = 'ab'
    } else if (hitUidInter > 0 && uidsPagina > 0) {
      passagemCheckoutPct = (hitUidInter / uidsPagina) * 100
      passagemFonte = 'uid'
    } else if (hitClicantes > 0 && baseHits > 0) {
      passagemCheckoutPct = Math.min(100, (hitClicantes / baseHits) * 100)
      passagemFonte = 'hits'
    } else {
      passagemCheckoutPct = null
      passagemFonte = null
    }
    const convPaginaFrontPct = base > 0 ? (hot.frontSales / base) * 100 : null
    const cvrCheckoutPct = checkoutInter > 0 ? (hot.frontSales / checkoutInter) * 100 : null
    const ticketMedio = hot.frontSales > 0 ? hot.receita / hot.frontSales : null
    const scrollDepthPct = cl && cl.sessions > 0 ? cl.scrollW / cl.sessions : null
    const engagementSec = cl && cl.sessions > 0 ? cl.engW / cl.sessions : null

    const diag = diagnosticarPagina({ scrollDepthPct, passagemCheckoutPct, cvrCheckoutPct, convPaginaFrontPct, frontSales: hot.frontSales, uidsPagina, sessionsGa4 })

    rows.push({
      slug,
      funil: detectFunil(slug),
      sessionsGa4,
      uidsPagina,
      checkoutInter,
      frontSales: hot.frontSales,
      receitaBruta: hot.receita,
      receitaLiquida: hot.liquido,
      temSinalCheckout,
      hitClicantes,
      hitUidInter,
      passagemFonte,
      passagemCheckoutPct,
      convPaginaFrontPct,
      cvrCheckoutPct,
      ticketMedio,
      convBase,
      scrollDepthPct,
      engagementSec,
      rageClicks: cl?.rage ?? null,
      claritySessions: cl?.sessions ?? null,
      temUid: uidsPagina > 0,
      temGa4: sessionsGa4 > 0,
      temClarity: !!cl,
      soHotmart: uidsPagina === 0 && sessionsGa4 === 0 && hot.frontSales > 0,
      diag,
    })
  }

  rows.sort((a, b) => b.receitaLiquida - a.receitaLiquida)

  return {
    rows,
    uidSource: (process.env.AB_IMPRESSION_MODE === 'beacon' ? 'beacon' : process.env.AB_IMPRESSION_MODE === 'redirect' ? 'redirect' : 'desconhecido'),
    totals: {
      paginas: rows.length,
      comUid: rows.filter((r) => r.temUid).length,
      comClarity: rows.filter((r) => r.temClarity).length,
      sessoes: rows.reduce((s, r) => s + r.sessionsGa4, 0),
      vendasFront: rows.reduce((s, r) => s + r.frontSales, 0),
      receitaLiquida: rows.reduce((s, r) => s + r.receitaLiquida, 0),
    },
  }
}

// cores expostas pra UI
export const paginaCores = { corPassagem, corConv, corCheckout, corScroll }
