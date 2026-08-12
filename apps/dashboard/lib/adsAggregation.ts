/**
 * Agregação de Meta Ads + receita Hotmart por campanha / conjunto / anúncio, com
 * atribuição exata por data. EXTRAÍDA verbatim de campanhas/page.tsx (Track B / B-P3)
 * pra ser reusada na aba Perpétuo (expandir 4-abas) SEM divergir dos números do
 * /campanhas. Única mudança vs original: `key` aceita também 'ad_name'.
 */
import { fetchMetaAds, fetchTransacoes, tipoDaTransacao } from '@/lib/supabase'
import { getSemaforoColor } from '@/lib/thresholds'
import type { CriativoAgregado } from '@/types'

export type AggregateKey = 'campaign_name' | 'adset_name' | 'ad_name'

export function aggregateBy(
  rows: Awaited<ReturnType<typeof fetchMetaAds>>,        // date-filtered, used for metrics
  allRows: Awaited<ReturnType<typeof fetchMetaAds>>,     // full history (same account+funil), used for attribution
  transacoes: Awaited<ReturnType<typeof fetchTransacoes>>,
  key: AggregateKey,
): CriativoAgregado[] {
  // ── Step 1: Aggregate Meta Ads metrics by campaign/adset/ad (date-filtered) ────
  const map: Record<string, {
    investimento: number; impressoes: number; alcance: number
    views_3seg: number; views_75pct: number; views_95pct: number; cliques_link: number
    landing_views: number; checkouts: number; ultimoDia: string
    entityId: string; budgetCents: number | null   // id+orçamento da entidade (campanha/adset)
  }> = {}

  rows.forEach((r) => {
    const nome = r[key] || 'Sem nome'
    if (!map[nome]) map[nome] = { investimento: 0, impressoes: 0, alcance: 0, views_3seg: 0, views_75pct: 0, views_95pct: 0, cliques_link: 0, landing_views: 0, checkouts: 0, ultimoDia: '', entityId: '', budgetCents: null }
    const m = map[nome]
    // Captura o id da entidade e o orçamento conforme o escopo (campanha vs conjunto vs anúncio).
    if (!m.entityId) m.entityId = (key === 'campaign_name' ? r.campaign_id : key === 'adset_name' ? r.adset_id : r.ad_id) || ''
    if (m.budgetCents == null) m.budgetCents = (key === 'campaign_name' ? r.campaign_daily_budget_cents : key === 'adset_name' ? r.daily_budget_cents : null) ?? null
    m.investimento += r.investimento || 0
    m.impressoes += r.impressoes || 0
    m.alcance += r.alcance || 0
    m.views_3seg += r.views_3seg || 0
    m.views_75pct += r.views_75pct || 0
    m.views_95pct += r.views_95pct || 0
    m.cliques_link += r.cliques_link || 0
    m.landing_views += r.landing_views || 0
    m.checkouts += r.checkouts || 0
    if (r.data && r.data > m.ultimoDia) m.ultimoDia = r.data
  })

  // ── Step 2: Build attribution lookups from ALL rows (no date filter) ─────────
  const adIdMap: Record<string, string> = {}
  const adHistory: Record<string, Array<{ date: string; group: string; spend: number }>> = {}

  allRows.forEach((r) => {
    const group = r[key] || 'Sem nome'

    // id-based lookup
    if (r.ad_id) adIdMap[r.ad_id] = group

    // name-based lookup (date-indexed)
    const adKey = r.ad_name || r.criativo || ''
    if (!adKey) return
    if (!adHistory[adKey]) adHistory[adKey] = []
    adHistory[adKey].push({ date: r.data, group, spend: r.investimento || 0 })
  })
  for (const adKey of Object.keys(adHistory)) {
    adHistory[adKey].sort((a, b) => a.date.localeCompare(b.date))
  }

  function getAttribute(adId: string | null | undefined, criativo: string, txDate: string): string {
    // 1. ad_id from the transaction itself — único por (criativo × adset), zero ambiguidade
    if (adId && adIdMap[adId]) return adIdMap[adId]

    // 2. Legacy: criativo às vezes guarda ad_id cru (utm_id-style)
    if (adIdMap[criativo]) return adIdMap[criativo]

    // 3. Name + date: find which campaign ran this ad on the transaction date
    const history = adHistory[criativo]
    if (!history || history.length === 0) return 'Sem campanha'

    const onDate = history.filter((e) => e.date === txDate)
    if (onDate.length > 0) return onDate.sort((a, b) => b.spend - a.spend)[0].group

    // Most recent entry on or before the transaction date
    let best: { date: string; group: string; spend: number } | undefined
    for (const entry of history) {
      if (entry.date <= txDate) best = entry
      else break
    }
    return best ? best.group : history[0].group
  }

  // ── Step 3: Aggregate Hotmart revenue with exact date-based attribution ────────
  type CampEntry = {
    vendas: number; vendasFront: number; vendasOB1: number; vendasOB2: number; vendasOB3: number; vendasOB4: number
    vendasUpsell: number; vendasDownsell: number
    faturamento: number; faturamentoFront: number; faturamentoOB: number; faturamentoUpsell: number
  }
  const emptyCamp = (): CampEntry => ({
    vendas: 0, vendasFront: 0, vendasOB1: 0, vendasOB2: 0, vendasOB3: 0, vendasOB4: 0,
    vendasUpsell: 0, vendasDownsell: 0, faturamento: 0, faturamentoFront: 0, faturamentoOB: 0, faturamentoUpsell: 0,
  })

  // Lookup email → campanha do FE (mesmo período). Atribui upsell/downsell sem
  // UTM à campanha que vendeu o FE pro mesmo comprador.
  const emailToCampaign: Record<string, string> = {}
  transacoes.forEach((t) => {
    if (!t.email) return
    const tipo = tipoDaTransacao(t)
    if (tipo !== 'frontEnd') return
    const nome = getAttribute(t.ad_id, t.criativo || '', t.data || '')
    if (nome === 'Sem campanha') return
    const email = t.email.toLowerCase()
    if (!emailToCampaign[email]) emailToCampaign[email] = nome
  })

  const hotmartMap: Record<string, CampEntry> = {}
  transacoes.forEach((t) => {
    const criativo = t.criativo || 'Sem criativo'
    const txDate = t.data || ''
    const tipo = tipoDaTransacao(t)

    let nome: string
    if (!t.criativo && (tipo === 'upsell' || tipo === 'downsell') && t.email) {
      // Atribui ao email comprador FE (mesma chave de campanha/conjunto que vendeu o FE)
      nome = emailToCampaign[t.email.toLowerCase()] || getAttribute(t.ad_id, criativo, txDate)
    } else {
      nome = getAttribute(t.ad_id, criativo, txDate)
    }

    if (!hotmartMap[nome]) hotmartMap[nome] = emptyCamp()
    const v = t.valor_bruto || 0
    hotmartMap[nome].vendas += 1
    hotmartMap[nome].faturamento += v
    if (tipo === 'frontEnd') { hotmartMap[nome].vendasFront += 1; hotmartMap[nome].faturamentoFront += v }
    else if (tipo === 'ob1') { hotmartMap[nome].vendasOB1 += 1; hotmartMap[nome].faturamentoOB += v }
    else if (tipo === 'ob2') { hotmartMap[nome].vendasOB2 += 1; hotmartMap[nome].faturamentoOB += v }
    else if (tipo === 'ob3') { hotmartMap[nome].vendasOB3 += 1; hotmartMap[nome].faturamentoOB += v }
    else if (tipo === 'ob4') { hotmartMap[nome].vendasOB4 += 1; hotmartMap[nome].faturamentoOB += v }
    else if (tipo === 'upsell') { hotmartMap[nome].vendasUpsell += 1; hotmartMap[nome].faturamentoUpsell += v }
    else if (tipo === 'downsell') hotmartMap[nome].vendasDownsell += 1
  })

  // ── Step 3.5: Garante linha "Sem campanha" quando há receita não atribuída ────
  if (hotmartMap['Sem campanha'] && !map['Sem campanha']) {
    map['Sem campanha'] = {
      investimento: 0, impressoes: 0, alcance: 0, views_3seg: 0, views_75pct: 0, views_95pct: 0,
      cliques_link: 0, landing_views: 0, checkouts: 0, ultimoDia: '', entityId: '', budgetCents: null,
    }
  }

  // ── Step 4: Build final output ────────────────────────────────────────────────
  return Object.entries(map)
    .map(([nome, m]) => {
      const hotmart = hotmartMap[nome] ?? emptyCamp()
      const faturamento = hotmart.faturamento
      const vendasFront = hotmart.vendasFront
      const roas = m.investimento > 0 ? faturamento / m.investimento : 0
      const cpa = vendasFront > 0 ? m.investimento / vendasFront : 0
      const ctr = m.impressoes > 0 ? (m.cliques_link / m.impressoes) * 100 : 0
      const cpm = m.impressoes > 0 ? (m.investimento / m.impressoes) * 1000 : 0
      const cpc = m.cliques_link > 0 ? m.investimento / m.cliques_link : 0
      const hookRate = m.impressoes > 0 ? (m.views_3seg / m.impressoes) * 100 : 0
      const retencaoRate = m.views_3seg > 0 ? (m.views_95pct / m.views_3seg) * 100 : 0
      const cvrPagina = m.cliques_link > 0 ? (m.landing_views / m.cliques_link) * 100 : 0
      const cvrCheckout = m.landing_views > 0 ? (m.checkouts / m.landing_views) * 100 : 0
      const conversaoCheckout = m.checkouts > 0 ? (vendasFront / m.checkouts) * 100 : 0
      const txConversaoPagina = m.landing_views > 0 ? (vendasFront / m.landing_views) * 100 : 0
      const frequencia = m.alcance > 0 ? m.impressoes / m.alcance : 0
      const taxaUpsell = vendasFront > 0 ? (hotmart.vendasUpsell / vendasFront) * 100 : 0
      const elegivelDownsell = Math.max(vendasFront - hotmart.vendasUpsell, 0)
      const taxaDownsell = elegivelDownsell > 0 ? (hotmart.vendasDownsell / elegivelDownsell) * 100 : 0
      const lucro = faturamento - m.investimento
      const inv = m.investimento
      // Tier A (Fase 3.4) — também por campanha/conjunto
      const roasSoFront = inv > 0 ? hotmart.faturamentoFront / inv : 0
      const roas1oCheckout = inv > 0 ? (hotmart.faturamentoFront + hotmart.faturamentoOB) / inv : 0
      const roasComUpsell = inv > 0 ? (hotmart.faturamentoFront + hotmart.faturamentoOB + hotmart.faturamentoUpsell) / inv : 0
      const rpc = m.cliques_link > 0 ? faturamento / m.cliques_link : 0
      const lpc = m.cliques_link > 0 ? lucro / m.cliques_link : 0
      const cpaUpsell = hotmart.vendasUpsell > 0 ? inv / hotmart.vendasUpsell : 0
      const custoPorCheckout = m.checkouts > 0 ? inv / m.checkouts : 0
      const convCorpo = m.views_75pct > 0 ? (vendasFront / m.views_75pct) * 100 : 0
      return {
        criativo: nome, tipo: 'video',
        investimento: m.investimento, faturamento, lucro,
        roas, cpa, ctr, cpm, cpc, hookRate, retencaoRate, cvrPagina, cvrCheckout, conversaoCheckout, txConversaoPagina,
        vendas: hotmart.vendas, vendasFront,
        vendasOB1: hotmart.vendasOB1, vendasOB2: hotmart.vendasOB2,
        vendasOB3: hotmart.vendasOB3, vendasOB4: hotmart.vendasOB4,
        vendasUpsell: hotmart.vendasUpsell, vendasDownsell: hotmart.vendasDownsell,
        faturamentoFront: hotmart.faturamentoFront, faturamentoOB: hotmart.faturamentoOB,
        faturamentoUpsell: hotmart.faturamentoUpsell,
        roasSoFront, roas1oCheckout, roasComUpsell, rpc, lpc, cpaUpsell, custoPorCheckout, convCorpo,
        views75: m.views_75pct,
        taxaUpsell, taxaDownsell,
        ticketMedio: vendasFront > 0 ? faturamento / vendasFront : 0,
        impressoes: m.impressoes, frequencia, alcance: m.alcance,
        views3s: m.views_3seg, views95: m.views_95pct, cliques: m.cliques_link,
        landingViews: m.landing_views, checkouts: m.checkouts,
        convClique: m.cliques_link > 0 ? (vendasFront / m.cliques_link) * 100 : 0,
        ultimoDia: m.ultimoDia || undefined,
        semaforo: getSemaforoColor('roasLiquido', roas),
        // ── Controle Meta (Fase 8): id da entidade + orçamento + status heurístico ──
        campaignId: key === 'campaign_name' ? (m.entityId || undefined) : undefined,
        adsetId: key === 'adset_name' ? (m.entityId || undefined) : undefined,
        campaignDailyBudgetCents: key === 'campaign_name' ? (m.budgetCents ?? undefined) : undefined,
        dailyBudgetCents: key === 'adset_name' ? (m.budgetCents ?? undefined) : undefined,
        status: m.investimento > 0 ? 'ativo' : 'pausado', // heurístico; o modal lê o status real ao vivo
      } satisfies CriativoAgregado
    })
    .sort((a, b) => b.investimento - a.investimento)
}
