export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { cookies } from 'next/headers'
import Header from '@/components/layout/Header'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { fetchMetaAds, fetchTransacoes, fetchFunisConfig, fetchQualificacao, fetchConfig, fetchVturbCreativeDaily, scoreQualificacao, tipoDaTransacao, getDateRange, filterByFunil, filterByAccount, filterTransacoesByFunil } from '@/lib/supabase'
import { getSemaforoColor } from '@/lib/thresholds'
import type { CriativoAgregado } from '@/types'
import type { OrganicRow } from './CriativosClient'
import { classifyOrigem, type Origem } from '@/lib/origem'
import CriativosClient from './CriativosClient'
import ComparisonHero from '@/components/cards/ComparisonHero'
import { computePeriodSummary } from '@/lib/periodSummary'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel } from '@/lib/comparePeriods'
import { brazilDateStr } from '@/lib/brazilDate'
import { diaSemanaFatores } from '@/lib/metrics/sparkline'
import { emptyComp, type DailyComp } from '@/lib/metrics/dailyDerive'
import { liquidoHotmartVenda } from '@/lib/hotmartFees'
import { convBodyPct } from '@/lib/metrics/convBody'

export default async function CriativosPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string; cmp?: string; cmpDe?: string; cmpAte?: string }> }) {
  const { de = '', ate = '', funil = 'all', conta = 'all', cmp, cmpDe, cmpAte } = await searchParams
  const cmpMode = parseCompareMode(cmp)
  const cmpRange = computeComparisonRange(de, ate, cmpMode, cmpDe, cmpAte)
  const cmpLabel = cmpRange ? formatComparisonLabel(cmpMode, cmpRange) : ''
  const allMeta = await fetchMetaAds()
  const accountOptions = [...new Set(allMeta.map((r) => r.account_id).filter((id): id is string => Boolean(id)))]
  return (
    <div className="flex flex-col h-full">
      <Header title="Criativos" subtitle="Performance por criativo" accountOptions={accountOptions} />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-96 animate-pulse" />}>
          <CriativosContent de={de} ate={ate} funil={funil} conta={conta} cmpFrom={cmpRange?.from} cmpTo={cmpRange?.to} cmpLabel={cmpLabel} />
        </Suspense>
      </div>
    </div>
  )
}

async function CriativosContent({ de, ate, funil, conta, cmpFrom, cmpTo, cmpLabel }: { de: string; ate: string; funil: string; conta: string; cmpFrom?: string; cmpTo?: string; cmpLabel?: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allRows, allTransacoes, allQualificacao, config, sessionRole] = await Promise.all([
    fetchMetaAds(), fetchTransacoes(), fetchQualificacao(), fetchConfig(),
    cookies().then((c) => c.get(SESSION_COOKIE)?.value).then((sid) => sid ? lookupSession(sid) : null).then((s) => s?.role ?? null).catch(() => null),
  ])
  const isAdmin = sessionRole === 'admin'
  const precoMentoria = Number(config['preco_mentoria'] ?? 4000)
  const accountFiltered = filterByAccount(allRows, conta)

  // ── Qualificação e Mentoria por criativo (all-time, baseado em emails únicos) ─
  const emailToQual: Record<string, typeof allQualificacao[0]> = {}
  allQualificacao.forEach((q) => { if (q.email) emailToQual[q.email.toLowerCase()] = q })

  const frontEmailsMap: Record<string, Set<string>> = {}
  const qualifEmailsMap: Record<string, Set<string>> = {}
  const mentoriaEmailsMap: Record<string, Set<string>> = {}

  allTransacoes.forEach((t) => {
    if ((t.valor_bruto || 0) <= 1) return
    const criativo = t.criativo || ''; if (!criativo) return
    const tipo = tipoDaTransacao(t)
    if (tipo !== 'frontEnd') return
    const email = t.email?.toLowerCase(); if (!email) return
    if (!frontEmailsMap[criativo]) frontEmailsMap[criativo] = new Set()
    frontEmailsMap[criativo].add(email)
    const qual = emailToQual[email]
    if (qual?.tem_ficha) {
      if (!qualifEmailsMap[criativo]) qualifEmailsMap[criativo] = new Set()
      qualifEmailsMap[criativo].add(email)
    }
    if (qual?.aluno_mentoria) {
      if (!mentoriaEmailsMap[criativo]) mentoriaEmailsMap[criativo] = new Set()
      mentoriaEmailsMap[criativo].add(email)
    }
  })

  // ── ultimoDia por criativo (all-time meta_ads) ─────────────────────────────
  const ultimoDiaMap: Record<string, string> = {}
  allRows.forEach((r) => {
    const nome = r.ad_name || r.criativo || ''; if (!nome || !r.data) return
    if (!ultimoDiaMap[nome] || r.data > ultimoDiaMap[nome]) ultimoDiaMap[nome] = r.data
  })

  // ── ad_id all-time por nome (fallback para criativos pausados no período) ──
  // Quando um criativo não tem gastos no período filtrado, m.ad_id fica vazio e
  // o match vById falha. Este mapa usa os dados all-time pra preencher o ad_id.
  const allTimeAdIdByName: Record<string, string> = {}
  allRows.forEach((r) => {
    const nome = r.ad_name || r.criativo || ''; if (!nome || !r.ad_id) return
    if (!allTimeAdIdByName[nome]) allTimeAdIdByName[nome] = r.ad_id
  })

  // ── CPA 24h: investimento e vendas no último dia ativo ────────────────────
  const lastDayInvMap: Record<string, number> = {}
  allRows.forEach((r) => {
    const nome = r.ad_name || r.criativo || ''; if (!nome || !r.data) return
    if (r.data === ultimoDiaMap[nome]) lastDayInvMap[nome] = (lastDayInvMap[nome] || 0) + (r.investimento || 0)
  })
  const lastDayVendasMap: Record<string, number> = {}
  allTransacoes.forEach((t) => {
    if ((t.valor_bruto || 0) <= 1) return
    const criativo = t.criativo || ''; if (!criativo || !t.data) return
    if (t.data.slice(0, 10) !== ultimoDiaMap[criativo]) return
    if (tipoDaTransacao(t) === 'frontEnd')
      lastDayVendasMap[criativo] = (lastDayVendasMap[criativo] || 0) + 1
  })

  // Confirmed Meta creative names (all time, account-filtered)
  // These are ad_names that have ever appeared in the Meta Ads table
  const metaCreativeNames = new Set(
    accountFiltered.map((r) => r.ad_name || r.criativo).filter(Boolean)
  )

  // Date + funil filtered Meta rows for the selected period
  const funis = await fetchFunisConfig()
  const rows = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, funis)

  // All transactions in this period, funil-filtered
  const transacoesFiltradas = filterTransacoesByFunil(
    allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)) && (t.valor_bruto || 0) > 1),
    funil,
    accountFiltered,
    funis
  )

  type HotmartEntry = {
    vendas: number; vendasFront: number; vendasOB1: number; vendasOB2: number; vendasOB3: number; vendasOB4: number
    vendasUpsell: number; vendasDownsell: number
    faturamento: number; faturamentoFront: number; faturamentoOB: number; faturamentoUpsell: number; faturamentoDownsell: number
    liquido: number // soma do líquido POR transação (taxa Hotmart canônica)
  }
  const emptyEntry = (): HotmartEntry => ({
    vendas: 0, vendasFront: 0, vendasOB1: 0, vendasOB2: 0, vendasOB3: 0, vendasOB4: 0,
    vendasUpsell: 0, vendasDownsell: 0,
    faturamento: 0, faturamentoFront: 0, faturamentoOB: 0, faturamentoUpsell: 0, faturamentoDownsell: 0,
    liquido: 0,
  })

  // Lookup email → criativo do FE (no período filtrado). Usado pra atribuir
  // upsell/downsell SEM UTM ao criativo do FE comprado pelo MESMO email.
  const emailToCriativoFE: Record<string, string> = {}
  transacoesFiltradas.forEach((t) => {
    if (!t.email) return
    const c = t.criativo || ''
    if (!c) return
    if (tipoDaTransacao(t) !== 'frontEnd') return
    const email = t.email.toLowerCase()
    if (!emailToCriativoFE[email]) emailToCriativoFE[email] = c
  })

  // Split transactions: Meta-confirmed creatives vs organic/other
  const hotmartMetaMap: Record<string, HotmartEntry> = {}
  const hotmartOrganicMap: Record<string, HotmartEntry> = {}
  // Origem canônica (pago/organico/whatsapp/direto) por fonte do bloco orgânico.
  const organicOrigem: Record<string, Origem> = {}

  transacoesFiltradas.forEach((t) => {
    let criativo = t.criativo || ''
    const tipo = tipoDaTransacao(t)

    // Atribuição pra upsell/downsell sem UTM: cruza pelo email com o FE do mesmo comprador.
    if (!criativo && (tipo === 'upsell' || tipo === 'downsell') && t.email) {
      const linked = emailToCriativoFE[t.email.toLowerCase()]
      if (linked) criativo = linked
    }

    const isMetaCreative = Boolean(criativo) && metaCreativeNames.has(criativo)

    let key: string
    if (isMetaCreative) {
      key = criativo
    } else if (criativo) {
      key = criativo  // campaign name / adset / other utm_content as-is
    } else {
      // No utm_content — use medium/source as fallback with asterisk
      const fallback = t.utm_medium_ultimo || t.utm_source_ultimo || 'Direto'
      key = `* ${fallback}`
    }

    const target = isMetaCreative ? hotmartMetaMap : hotmartOrganicMap
    if (!isMetaCreative && !organicOrigem[key]) organicOrigem[key] = classifyOrigem(t)
    if (!target[key]) target[key] = emptyEntry()
    const e = target[key]
    e.vendas++
    e.faturamento += t.valor_bruto || 0
    e.liquido += liquidoHotmartVenda(t.valor_bruto || 0)
    if (tipo === 'frontEnd') { e.vendasFront++; e.faturamentoFront += t.valor_bruto || 0 }
    else if (tipo === 'ob1') { e.vendasOB1++; e.faturamentoOB += t.valor_bruto || 0 }
    else if (tipo === 'ob2') { e.vendasOB2++; e.faturamentoOB += t.valor_bruto || 0 }
    else if (tipo === 'ob3') { e.vendasOB3++; e.faturamentoOB += t.valor_bruto || 0 }
    else if (tipo === 'ob4') { e.vendasOB4++; e.faturamentoOB += t.valor_bruto || 0 }
    else if (tipo === 'upsell') { e.vendasUpsell++; e.faturamentoUpsell += t.valor_bruto || 0 }
    else if (tipo === 'downsell') { e.vendasDownsell++; e.faturamentoDownsell += t.valor_bruto || 0 }
  })

  // Build preview link map
  const linkMap: Record<string, string> = {}
  allRows.forEach((r) => {
    const nome = r.ad_name || r.criativo
    if (nome && r.preview_url && !linkMap[nome]) linkMap[nome] = r.preview_url
  })

  // Build Meta aggregation map from Meta rows
  const map: Record<string, {
    investimento: number; impressoes: number; alcance: number
    views_3seg: number; views_75pct: number; views_95pct: number; cliques_link: number
    landing_views: number; checkouts: number; comentarios: number
    campaign_name: string; adset_name: string; ad_id: string
    status: string; adset_id: string; campaign_id: string
    daily_budget_cents: number | null; campaign_daily_budget_cents: number | null
  }> = {}

  rows.forEach((r) => {
    const key = r.ad_name || r.criativo || 'Sem nome'
    if (!map[key]) map[key] = { investimento: 0, impressoes: 0, alcance: 0, views_3seg: 0, views_75pct: 0, views_95pct: 0, cliques_link: 0, landing_views: 0, checkouts: 0, comentarios: 0, campaign_name: r.campaign_name || '', adset_name: r.adset_name || '', ad_id: r.ad_id || '', status: '', adset_id: '', campaign_id: '', daily_budget_cents: null, campaign_daily_budget_cents: null }
    const m = map[key]
    if (!m.ad_id && r.ad_id) m.ad_id = r.ad_id
    if (!m.status && r.status) m.status = r.status
    if (!m.adset_id && r.adset_id) m.adset_id = r.adset_id
    if (!m.campaign_id && r.campaign_id) m.campaign_id = r.campaign_id
    if (m.daily_budget_cents == null && r.daily_budget_cents != null) m.daily_budget_cents = r.daily_budget_cents
    if (m.campaign_daily_budget_cents == null && r.campaign_daily_budget_cents != null) m.campaign_daily_budget_cents = r.campaign_daily_budget_cents
    m.investimento += r.investimento || 0
    m.impressoes += r.impressoes || 0
    m.alcance += r.alcance || 0
    m.views_3seg += r.views_3seg || 0
    m.views_75pct += r.views_75pct || 0
    m.views_95pct += r.views_95pct || 0
    m.cliques_link += r.cliques_link || 0
    m.landing_views += r.landing_views || 0
    m.checkouts += r.checkouts || 0
    m.comentarios += r.comentarios ?? 0 // NULL (dia pré-coluna) soma 0
  })

  // Add Meta creatives that have Hotmart sales in this period but no Meta spend
  // (e.g. paused creative or retargeting) — only confirmed Meta creatives
  Object.keys(hotmartMetaMap).forEach((nome) => {
    if (!map[nome]) {
      map[nome] = { investimento: 0, impressoes: 0, alcance: 0, views_3seg: 0, views_75pct: 0, views_95pct: 0, cliques_link: 0, landing_views: 0, checkouts: 0, comentarios: 0, campaign_name: '', adset_name: '', ad_id: '', status: '', adset_id: '', campaign_id: '', daily_budget_cents: null, campaign_daily_budget_cents: null }
    }
  })

  // ROAS Geral (all-time): receita TOTAL dos compradores atribuída ao criativo de
  // PRIMEIRO toque, com fallback pro last-touch quando criativo_primeiro está vazio
  // (~47% dos casos — ver Fase 0). Usa TODAS as transações (não filtra período); o
  // investimento no cálculo segue do período → tooltip deixa o caveat explícito.
  const allTimeRevByCreative: Record<string, number> = {}
  allTransacoes.forEach((t) => {
    if ((t.valor_bruto || 0) <= 1) return
    const nome = (t.criativo_primeiro || t.criativo || '').trim()
    if (!nome) return
    allTimeRevByCreative[nome] = (allTimeRevByCreative[nome] || 0) + (t.valor_bruto || 0)
  })

  // ── Tier B (vTurb por criativo): soma absolutos no período por chave de match ──
  // (utm_id = ad_id, preferido; utm_content = ad_name, fallback). Vazio se a
  // migration 0019 não foi aplicada ou o cron ainda não rodou → métricas VSL = n/d.
  const vturbDaily = await fetchVturbCreativeDaily(from || '', to || '')
  type VAgg = { viewed: number; started: number; finished: number; clicked: number; conversions: number; overPitch: number; firstMin: number }
  const vById: Record<string, VAgg> = {}
  const vByName: Record<string, VAgg> = {}
  for (const r of vturbDaily) {
    const target = r.match_kind === 'utm_id' ? vById : vByName
    const a = target[r.match_key] ?? (target[r.match_key] = { viewed: 0, started: 0, finished: 0, clicked: 0, conversions: 0, overPitch: 0, firstMin: 0 })
    a.viewed += r.total_viewed || 0; a.started += r.total_started || 0
    a.finished += r.total_finished || 0; a.clicked += r.total_clicked || 0
    a.conversions += r.total_conversions || 0
    a.overPitch += r.total_over_pitch || 0
    a.firstMin += r.total_first_minute || 0
  }

  const criativos: CriativoAgregado[] = Object.entries(map)
    .filter(([nome]) => nome)
    .map(([nome, m]) => {
      const hotmart = hotmartMetaMap[nome] ?? emptyEntry()
      const faturamento = hotmart.faturamento
      const vendasFront = hotmart.vendasFront
      const vendasUpsell = hotmart.vendasUpsell
      const vendasDownsell = hotmart.vendasDownsell
      const taxaUpsell = vendasFront > 0 ? (vendasUpsell / vendasFront) * 100 : 0
      const elegivelDownsell = Math.max(vendasFront - vendasUpsell, 0)
      const taxaDownsell = elegivelDownsell > 0 ? (vendasDownsell / elegivelDownsell) * 100 : 0
      const roas = m.investimento > 0 ? faturamento / m.investimento : 0
      const receitaLiquidaCriativo = hotmart.liquido // canônico, por transação
      const roasLiquido = m.investimento > 0 ? receitaLiquidaCriativo / m.investimento : 0
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
      const convClique = m.cliques_link > 0 ? (vendasFront / m.cliques_link) * 100 : 0
      const pctQualificados = (frontEmailsMap[nome]?.size ?? 0) > 0
        ? ((qualifEmailsMap[nome]?.size ?? 0) / frontEmailsMap[nome].size) * 100 : 0
      const alunosMentoria = mentoriaEmailsMap[nome]?.size ?? 0
      const qualifCount = qualifEmailsMap[nome]?.size ?? 0
      const receitaMentoria = alunosMentoria * precoMentoria
      const lucro = faturamento - m.investimento
      const lucroTotal = lucro + receitaMentoria
      const roasTotal = m.investimento > 0 ? (faturamento + receitaMentoria) / m.investimento : 0
      const ultimoDia = ultimoDiaMap[nome]
      const cpa24h = (lastDayVendasMap[nome] ?? 0) > 0
        ? (lastDayInvMap[nome] ?? 0) / lastDayVendasMap[nome] : 0
      // ── Métricas Tier A (Fase 3.4) ──
      const inv = m.investimento
      const faturamentoFront = hotmart.faturamentoFront
      const faturamentoOB = hotmart.faturamentoOB
      const roasSoFront = inv > 0 ? faturamentoFront / inv : 0
      const roas1oCheckout = inv > 0 ? (faturamentoFront + faturamentoOB) / inv : 0
      const roasComUpsell = inv > 0 ? (faturamentoFront + faturamentoOB + hotmart.faturamentoUpsell) / inv : 0
      const roasGeral = inv > 0 ? (allTimeRevByCreative[nome] ?? 0) / inv : 0
      const rpc = m.cliques_link > 0 ? faturamento / m.cliques_link : 0
      const lpc = m.cliques_link > 0 ? lucro / m.cliques_link : 0
      const cpaUpsell = vendasUpsell > 0 ? inv / vendasUpsell : 0
      const custoPorCheckout = m.checkouts > 0 ? inv / m.checkouts : 0
      // Conv. Body só existe pra VÍDEO, e só com denominador que sustente a taxa.
      // Anúncio de imagem tem views_75pct residual e a conta explode (demo-lps-img-02:
      // 7 compras / 1 view75 = 700%). Abaixo do piso → "—", nunca % fantasma.
      const convCorpo = convBodyPct(vendasFront, m.views_75pct)
      // ── Tier B (vTurb) — undefined quando não há match (coluna mostra n/d) ──
      // Fallback all-time: criativo pausado no período perde m.ad_id; usa o mapa
      // all-time pra recuperar o ad_id e tentar o match por utm_id mesmo assim.
      const effectiveAdId = m.ad_id || allTimeAdIdByName[nome] || ''
      const vs = vById[effectiveAdId] || vByName[nome]
      const vslViews = vs?.viewed
      const rpv = vs && vs.viewed > 0 ? faturamento / vs.viewed : undefined
      const lpv = vs && vs.viewed > 0 ? lucro / vs.viewed : undefined
      const pctPlayRate = vs && vs.viewed > 0 ? (vs.started / vs.viewed) * 100 : undefined
      const pctEngajamento = vs && vs.started > 0 ? (vs.finished / vs.started) * 100 : undefined
      const pctConvPlay = vs && vs.started > 0 ? (vs.conversions / vs.started) * 100 : undefined
      const pctVslClicou = vs && vs.started > 0 ? (vs.clicked / vs.started) * 100 : undefined
      const custoPlay = vs && vs.started > 0 ? inv / vs.started : undefined
      // Pitch (over_pitch da vTurb): chegou ao momento da oferta no vídeo.
      // Só calcula quando há over_pitch real (>0) — senão "n/d" honesto, até
      // confirmarmos que a API devolve esse campo por criativo (re-sync valida).
      const pctRetencaoPitch = vs && vs.overPitch > 0 && vs.started > 0 ? (vs.overPitch / vs.started) * 100 : undefined
      const pctConvPitch = vs && vs.overPitch > 0 ? (vs.conversions / vs.overPitch) * 100 : undefined
      const pctPitchClique = vs && vs.overPitch > 0 ? (vs.clicked / vs.overPitch) * 100 : undefined
      const custoPorPitch = vs && vs.overPitch > 0 ? inv / vs.overPitch : undefined
      // 1º minuto (retenção por tempo por criativo — user_engagement_by_traffic_origin).
      const pctRetencao1Min = vs && vs.firstMin > 0 && vs.started > 0 ? (vs.firstMin / vs.started) * 100 : undefined
      const custoPor1Min = vs && vs.firstMin > 0 ? inv / vs.firstMin : undefined
      return {
        criativo: nome, tipo: 'video',
        investimento: m.investimento, faturamento, lucro,
        roas, roasLiquido, cpa, ctr, cpm, cpc, hookRate, retencaoRate, cvrPagina, cvrCheckout, conversaoCheckout, txConversaoPagina,
        convClique, pctQualificados, qualifCount, alunosMentoria, receitaMentoria, lucroTotal, roasTotal, ultimoDia, cpa24h,
        vendas: hotmart.vendas, vendasFront,
        vendasOB1: hotmart.vendasOB1,
        vendasOB2: hotmart.vendasOB2,
        vendasOB3: hotmart.vendasOB3,
        vendasOB4: hotmart.vendasOB4,
        vendasUpsell, vendasDownsell,
        faturamentoUpsell: hotmart.faturamentoUpsell,
        faturamentoDownsell: hotmart.faturamentoDownsell,
        faturamentoFront, faturamentoOB,
        roasSoFront, roas1oCheckout, roasComUpsell, roasGeral,
        rpc, lpc, cpaUpsell, custoPorCheckout, convCorpo,
        comentarios: m.comentarios ?? 0, // NULL (dia anterior à coluna) → 0
        views75: m.views_75pct,
        vslViews, rpv, lpv, pctPlayRate, pctEngajamento, pctConvPlay, pctVslClicou, custoPlay,
        pctRetencaoPitch, pctConvPitch, pctPitchClique, custoPorPitch,
        pctRetencao1Min, custoPor1Min,
        taxaUpsell, taxaDownsell,
        ticketMedio: vendasFront > 0 ? faturamento / vendasFront : 0,
        impressoes: m.impressoes, frequencia, alcance: m.alcance,
        views3s: m.views_3seg, views95: m.views_95pct, cliques: m.cliques_link,
        landingViews: m.landing_views, checkouts: m.checkouts,
        // Status real do Meta quando sincronizado (Fase 8); senão, heurística por gasto.
        status: m.status ? (m.status === 'ACTIVE' ? 'ativo' : 'pausado') : (m.investimento > 0 ? 'ativo' : 'pausado'),
        statusMeta: m.status || undefined,
        adId: m.ad_id || undefined,
        adsetId: m.adset_id || undefined,
        campaignId: m.campaign_id || undefined,
        dailyBudgetCents: m.daily_budget_cents ?? undefined,
        campaignDailyBudgetCents: m.campaign_daily_budget_cents ?? undefined,
        semaforo: getSemaforoColor('roasLiquido', roas),
        link: linkMap[nome] || undefined,
        campaign_name: m.campaign_name,
        adset_name: m.adset_name,
      } satisfies CriativoAgregado
    })
    .sort((a, b) => b.investimento - a.investimento)

  // Build organic table
  const organico: OrganicRow[] = Object.entries(hotmartOrganicMap)
    .map(([fonte, d]) => ({
      fonte,
      origem: organicOrigem[fonte] ?? 'direto',
      faturamento: d.faturamento,
      ticketMedio: d.vendasFront > 0 ? d.faturamento / d.vendasFront : 0,
      vendas: d.vendas,
      vendasFront: d.vendasFront,
      vendasOB1: d.vendasOB1,
      vendasOB2: d.vendasOB2,
      vendasOB3: d.vendasOB3,
      vendasOB4: d.vendasOB4,
      vendasUpsell: d.vendasUpsell,
      vendasDownsell: d.vendasDownsell,
    }))
    .sort((a, b) => b.faturamento - a.faturamento)

  const [current, previous] = await Promise.all([
    computePeriodSummary(de, ate, funil, conta),
    (cmpFrom && cmpTo) ? computePeriodSummary(cmpFrom, cmpTo, funil, conta) : null,
  ])

  // Ticket médio FE agregado do período — usado no semáforo CPA (relativo)
  const ticketMedioPeriodo = current.ticketMedio ?? 0

  // ── Séries diárias pros minigráficos (hover): janela de 30 dias até ontem ──
  // Independe do filtro de data da página (o gráfico é sempre "últimos 7 + proj 7").
  const hoje = brazilDateStr(0)
  const janelaDias: string[] = []
  for (let n = 30; n >= 1; n--) janelaDias.push(brazilDateStr(n))
  const jIni = janelaDias[0]
  const jFim = janelaDias[janelaDias.length - 1]
  // IMPORTANTE: o histórico é propriedade do CRIATIVO — NÃO aplica filtro de
  // data/funil/conta (senão alguns ficam zerados ao filtrar). Só a janela de 30d.
  const dailyByCreative: Record<string, Record<string, DailyComp>> = {}
  allRows.filter((r) => r.data >= jIni && r.data <= jFim).forEach((r) => {
    const nome = r.ad_name || r.criativo; if (!nome || !r.data) return
    const c = (dailyByCreative[nome] ??= {})[r.data] ??= emptyComp(r.data)
    c.inv += r.investimento || 0; c.imp += r.impressoes || 0; c.alc += r.alcance || 0
    c.cliques += r.cliques_link || 0; c.lpv += r.landing_views || 0; c.checkouts += r.checkouts || 0
    c.v3 += r.views_3seg || 0; c.v75 += r.views_75pct || 0; c.v95 += r.views_95pct || 0
  })
  allTransacoes.filter((t) => t.data && t.data.slice(0, 10) >= jIni && t.data.slice(0, 10) <= jFim && (t.valor_bruto || 0) > 1).forEach((t) => {
    const nome = t.criativo || ''; if (!nome || !t.data) return
    const day = t.data.slice(0, 10)
    const c = (dailyByCreative[nome] ??= {})[day] ??= emptyComp(day)
    c.fat += t.valor_bruto || 0
    if (tipoDaTransacao(t) === 'frontEnd') c.vendasFront += 1
  })
  const serieDe = (nome: string): DailyComp[] => {
    const m = dailyByCreative[nome] || {}
    return janelaDias.map((d) => m[d] ?? emptyComp(d))
  }
  // Sazonalidade por dia-da-semana a partir do faturamento diário global (90d).
  const dowDias: string[] = []
  for (let n = 90; n >= 1; n--) dowDias.push(brazilDateStr(n))
  const fatDia: Record<string, number> = {}
  allTransacoes.forEach((t) => {
    if ((t.valor_bruto || 0) <= 1 || !t.data) return
    const day = t.data.slice(0, 10)
    if (day >= dowDias[0] && day <= dowDias[dowDias.length - 1]) fatDia[day] = (fatDia[day] || 0) + (t.valor_bruto || 0)
  })
  const dowFatores = diaSemanaFatores(dowDias.map((d) => ({ date: d, value: fatDia[d] ?? 0 })))

  const criativosComDaily = criativos.map((c) => ({ ...c, __daily: serieDe(c.criativo) }))

  return (
    <>
      <ComparisonHero
        current={current}
        previous={previous}
        cmpLabel={cmpLabel}
        metrics={['faturamento', 'investimento', 'lucro', 'roas', 'cpa', 'vendasFront']}
      />
      <CriativosClient criativos={criativosComDaily} organico={organico} funil={funil} ticketMedioPeriodo={ticketMedioPeriodo} isAdmin={isAdmin} hoje={hoje} dowFatores={dowFatores} />
    </>
  )
}
