/**
 * Agregação unificada de um período pra comparação.
 *
 * `computePeriodSummary` recebe (de, ate, funil, conta) e retorna TODOS os KPIs
 * num único objeto — usado pela página /comparacao e quando preciso passar
 * `current`/`previous` pra componentes (KpiCard, DeltaBadge).
 */

import {
  fetchTransacoes, fetchMetaAds, fetchFunisConfig, getDateRange,
  filterByAccount, filterByFunil, filterTransacoesByFunil, tipoDaTransacao,
} from './supabase'
import { applyAdFilters, adFilterActive, filterTransacoesByAds, type AdFilter } from './funil'
import { todayBR } from './formatters'
import { liquidoHotmartTransacoes } from './hotmartFees'

export interface PeriodSummary {
  range: { from: string; to: string }
  // dinheiro
  faturamento: number          // bruto (valor_bruto) — bate com gerenciador Meta
  receitaLiquida: number       // líquido DA OPERAÇÃO = soma do líquido por transação (taxa Hotmart canônica)
  investimento: number         // já com META_TAX_RATE aplicado em sync-meta
  lucro: number
  ticketMedio: number          // baseado em frontEnd (AOV)
  // eficiência
  roas: number                 // bruto / investimento
  roasLiquido: number          // líquido / investimento — verdade econômica
  cpa: number
  cpc: number
  cpm: number
  cppvRealizado: number        // CPPV REALIZADO = investimento / landingViews (custo por page-view/visita real). 0 = sem visitas no recorte
  // funnel rates (%)
  ctr: number
  carregamento: number
  passagemPagina: number
  conversaoCheckout: number
  convPagina: number
  convClique: number
  takeRateOB: number           // (vendasOB1+OB2+OB3+OB4) / vendasFront * 100
  takeRateOB1: number          // vendasOB1 / vendasFront * 100
  takeRateOB2: number
  takeRateOB3: number
  takeRateOB4: number
  taxaUpsell: number           // vendasUpsell / vendasFront * 100
  taxaDownsell: number         // vendasDownsell / max(vendasFront - vendasUpsell, 0) * 100
  // volumes
  impressoes: number
  cliques: number
  landingViews: number
  checkouts: number
  vendas: number
  vendasFront: number
  vendasOB1: number
  vendasOB2: number
  vendasOB3: number
  vendasOB4: number
  vendasUpsell: number
  vendasDownsell: number
  // derivados
  compradoresPorDia: number
  diasNoPeriodo: number
}

const EMPTY: Omit<PeriodSummary, 'range'> = {
  faturamento: 0, receitaLiquida: 0, investimento: 0, lucro: 0, ticketMedio: 0,
  roas: 0, roasLiquido: 0, cpa: 0, cpc: 0, cpm: 0, cppvRealizado: 0,
  ctr: 0, carregamento: 0, passagemPagina: 0, conversaoCheckout: 0,
  convPagina: 0, convClique: 0,
  takeRateOB: 0, takeRateOB1: 0, takeRateOB2: 0, takeRateOB3: 0, takeRateOB4: 0,
  taxaUpsell: 0, taxaDownsell: 0,
  impressoes: 0, cliques: 0, landingViews: 0, checkouts: 0,
  vendas: 0, vendasFront: 0, vendasOB1: 0, vendasOB2: 0, vendasOB3: 0, vendasOB4: 0,
  vendasUpsell: 0, vendasDownsell: 0,
  compradoresPorDia: 0, diasNoPeriodo: 0,
}

export async function computePeriodSummary(
  de: string, ate: string, funil: string, conta: string, ad?: AdFilter
): Promise<PeriodSummary> {
  const { from, to } = getDateRange(de, ate)
  const range = { from: from ?? '', to: to ?? '' }

  if (!from || !to) return { range, ...EMPTY }

  const [allTransacoes, allMeta, funis] = await Promise.all([fetchTransacoes(), fetchMetaAds(), fetchFunisConfig()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const funilTransacoes = filterTransacoesByFunil(
    allTransacoes.filter((t) => t.data && t.data >= from && t.data <= to),
    funil, accountFiltered, funis
  ).filter((t) => (t.valor_bruto || 0) > 1)
  const funilMeta = filterByFunil(
    accountFiltered.filter((r) => r.data >= from && r.data <= to),
    funil, funis
  )
  // Recorte Campanha/Conjunto/Anúncio (se ativo): estreita o meta_ads e, junto,
  // só mantém transações das ads sobreviventes — pra o ComparisonHero do topo bater
  // com o funil filtrado.
  const metaAds = ad && adFilterActive(ad) ? applyAdFilters(funilMeta, ad) : funilMeta
  const transacoes = ad && adFilterActive(ad) ? filterTransacoesByAds(funilTransacoes, metaAds) : funilTransacoes

  const investimento = metaAds.reduce((s, r) => s + (r.investimento || 0), 0)
  const impressoes  = metaAds.reduce((s, r) => s + (r.impressoes || 0), 0)
  const cliques     = metaAds.reduce((s, r) => s + (r.cliques_link || 0), 0)
  const landingViews = metaAds.reduce((s, r) => s + (r.landing_views || 0), 0)
  const checkouts   = metaAds.reduce((s, r) => s + (r.checkouts || 0), 0)

  const faturamento = transacoes.reduce((s, t) => s + (t.valor_bruto || 0), 0)
  const vendas = transacoes.length
  // Receita líquida DA OPERAÇÃO = soma do líquido POR transação (taxa Hotmart canônica).
  // NÃO usa valor_liquido_expert (que é só a comissão do produtor, com split interno).
  const receitaLiquida = liquidoHotmartTransacoes(transacoes.map((t) => t.valor_bruto || 0))

  const tipos = transacoes.map((t) => tipoDaTransacao(t, funis))
  const vendasFront = tipos.filter((x) => x === 'frontEnd').length
  const vendasOB1 = tipos.filter((x) => x === 'ob1').length
  const vendasOB2 = tipos.filter((x) => x === 'ob2').length
  const vendasOB3 = tipos.filter((x) => x === 'ob3').length
  const vendasOB4 = tipos.filter((x) => x === 'ob4').length
  const vendasUpsell = tipos.filter((x) => x === 'upsell').length
  const vendasDownsell = tipos.filter((x) => x === 'downsell').length

  // Lucro = receita líquida da operação − investimento (mesma base do ROAS Líquido).
  const lucro = receitaLiquida - investimento
  // Ticket médio = faturamento do recorte ÷ nº de COMPRADORES únicos (não nº de
  // vendas): quem leva front + OB/upsell conta UMA vez. Chave = email (fallback
  // hotmart_id p/ compras sem email não colapsarem numa só).
  const compradores = new Set(
    transacoes.map((t) => (t.email || t.hotmart_id || '').toLowerCase().trim()).filter(Boolean)
  ).size
  const ticketMedio = compradores > 0 ? faturamento / compradores : 0

  const roas = investimento > 0 ? faturamento / investimento : 0
  const roasLiquido = investimento > 0 ? receitaLiquida / investimento : 0
  const cpa = vendasFront > 0 ? investimento / vendasFront : 0
  const cpc = cliques > 0 ? investimento / cliques : 0
  const cpm = impressoes > 0 ? (investimento / impressoes) * 1000 : 0
  // CPPV REALIZADO = quanto se pagou por page-view/visita REAL (não o projetado do
  // funilEngine). Mesmo denominador do "carregamento" e da conv. página: landing_views.
  const cppvRealizado = landingViews > 0 ? investimento / landingViews : 0

  const ctr = impressoes > 0 ? (cliques / impressoes) * 100 : 0
  const carregamento = cliques > 0 ? (landingViews / cliques) * 100 : 0
  const passagemPagina = landingViews > 0 ? (checkouts / landingViews) * 100 : 0
  const conversaoCheckout = checkouts > 0 ? (vendasFront / checkouts) * 100 : 0
  const convPagina = landingViews > 0 ? (vendasFront / landingViews) * 100 : 0
  const convClique = cliques > 0 ? (vendasFront / cliques) * 100 : 0

  // Take Rate AGREGADO = soma de OBs / vendas frontEnd (NÃO média de taxas — vendia
  // resultado errado em períodos com mix desigual entre OBs).
  const takeRateOB = vendasFront > 0
    ? ((vendasOB1 + vendasOB2 + vendasOB3 + vendasOB4) / vendasFront) * 100
    : 0
  const takeRateOB1 = vendasFront > 0 ? (vendasOB1 / vendasFront) * 100 : 0
  const takeRateOB2 = vendasFront > 0 ? (vendasOB2 / vendasFront) * 100 : 0
  const takeRateOB3 = vendasFront > 0 ? (vendasOB3 / vendasFront) * 100 : 0
  const takeRateOB4 = vendasFront > 0 ? (vendasOB4 / vendasFront) * 100 : 0

  // Upsell: oferecido pra TODA venda front → denom = vendasFront.
  // Downsell: oferecido SÓ pra quem rejeitou o upsell → denom = vendasFront − vendasUpsell.
  const taxaUpsell = vendasFront > 0 ? (vendasUpsell / vendasFront) * 100 : 0
  const elegivelDownsell = Math.max(vendasFront - vendasUpsell, 0)
  const taxaDownsell = elegivelDownsell > 0 ? (vendasDownsell / elegivelDownsell) * 100 : 0

  // dias do período (cap em hoje pra denominador não inflar)
  const today = todayBR()
  const effectiveTo = to > today ? today : to
  const diasNoPeriodo = Math.max(1, Math.round(
    (new Date(effectiveTo).getTime() - new Date(from).getTime()) / 86400000
  ) + 1)
  const compradoresPorDia = vendasFront / diasNoPeriodo

  return {
    range,
    faturamento, receitaLiquida, investimento, lucro, ticketMedio,
    roas, roasLiquido, cpa, cpc, cpm, cppvRealizado,
    ctr, carregamento, passagemPagina, conversaoCheckout, convPagina, convClique,
    takeRateOB, takeRateOB1, takeRateOB2, takeRateOB3, takeRateOB4,
    taxaUpsell, taxaDownsell,
    impressoes, cliques, landingViews, checkouts,
    vendas, vendasFront, vendasOB1, vendasOB2, vendasOB3, vendasOB4,
    vendasUpsell, vendasDownsell,
    compradoresPorDia, diasNoPeriodo,
  }
}
