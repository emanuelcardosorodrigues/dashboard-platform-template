/**
 * Séries diárias da aba Histórico de Performance.
 *
 * A unidade exibida é o mesmo grupo dos cards: nome do criativo. Transações
 * entram primeiro pelo `ad_id` (que é a atribuição mais precisa) e, quando ele
 * não existe/não está no recorte, pelo nome do criativo. Não há dados de
 * comprador na saída deste módulo.
 */

import { tipoDaTransacao } from './supabase'
import { convBodyFrac } from './metrics/convBody'

export const PERFORMANCE_HISTORY_METRICS = ['hook_rate', 'conv_body', 'cpc_link', 'hold_rate'] as const
export type PerformanceHistoryMetric = (typeof PERFORMANCE_HISTORY_METRICS)[number]

export interface PerformanceMetaRow {
  data: string | null
  ad_id?: string | null
  criativo?: string | null
  ad_name?: string | null
  impressoes?: number | null
  cliques_link?: number | null
  views_3seg?: number | null
  views_75pct?: number | null
  views_95pct?: number | null
  investimento?: number | null
}

export interface PerformanceTransactionRow {
  data: string | null
  ad_id?: string | null
  criativo?: string | null
  produto?: string | null
  produto_id?: string | null
}

export interface PerformanceHistoryOptions {
  /** Dias de calendário do período. Sem eles, usa os dias que possuem Meta. */
  days?: readonly string[]
  /** Cada gráfico pode ter um Top X próprio. */
  topByMetric: Record<PerformanceHistoryMetric, number>
}

export interface PerformancePoint {
  date: string
  value: number | null
}

export interface PerformanceSeries {
  /** ad_id representativo (maior gasto) — o mesmo critério dos cards. */
  adId: string
  /** Nome do criativo: a mesma chave usada pelos cards atuais. */
  name: string
  points: PerformancePoint[]
}

export interface PerformanceMetricHistory {
  series: PerformanceSeries[]
}

export interface CreativePerformanceHistory {
  metrics: Record<PerformanceHistoryMetric, PerformanceMetricHistory>
}

interface Totals {
  impressoes: number
  cliquesLink: number
  views3seg: number
  views75pct: number
  views95pct: number
  investimento: number
  vendasFront: number
}

interface CreativeAggregate {
  name: string
  total: Totals
  byDay: Map<string, Totals>
  investmentByAdId: Map<string, number>
}

function zeroTotals(): Totals {
  return {
    impressoes: 0,
    cliquesLink: 0,
    views3seg: 0,
    views75pct: 0,
    views95pct: 0,
    investimento: 0,
    vendasFront: 0,
  }
}

function addMeta(totals: Totals, row: PerformanceMetaRow) {
  totals.impressoes += Number(row.impressoes ?? 0)
  totals.cliquesLink += Number(row.cliques_link ?? 0)
  totals.views3seg += Number(row.views_3seg ?? 0)
  totals.views75pct += Number(row.views_75pct ?? 0)
  totals.views95pct += Number(row.views_95pct ?? 0)
  totals.investimento += Number(row.investimento ?? 0)
}

function dayOf(value: string | null | undefined): string | null {
  const day = value?.slice(0, 10) ?? ''
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function creativeName(row: PerformanceMetaRow): string {
  return row.criativo || row.ad_name || '(sem nome)'
}

function getOrCreate(map: Map<string, CreativeAggregate>, name: string): CreativeAggregate {
  let aggregate = map.get(name)
  if (!aggregate) {
    aggregate = { name, total: zeroTotals(), byDay: new Map(), investmentByAdId: new Map() }
    map.set(name, aggregate)
  }
  return aggregate
}

function getDayTotals(aggregate: CreativeAggregate, day: string): Totals {
  let totals = aggregate.byDay.get(day)
  if (!totals) {
    totals = zeroTotals()
    aggregate.byDay.set(day, totals)
  }
  return totals
}

/** A métrica no agregado de um dia ou do período. */
export function performanceMetricValue(metric: PerformanceHistoryMetric, totals: Totals): number | null {
  switch (metric) {
    case 'hook_rate':
      return totals.impressoes > 0 ? totals.views3seg / totals.impressoes : null
    case 'conv_body':
      // Mantém a trava canônica: abaixo de 30 views75 é anúncio sem amostra de
      // vídeo suficiente, e não uma taxa artificialmente alta.
      return convBodyFrac(totals.vendasFront, totals.views75pct)
    case 'cpc_link':
      return totals.cliquesLink > 0 ? totals.investimento / totals.cliquesLink : null
    case 'hold_rate': {
      // Os cards usam views75 quando disponíveis e views95 somente como fallback
      // para históricos anteriores à coluna views_75pct.
      const completedViews = totals.views75pct > 0 ? totals.views75pct : totals.views95pct
      return totals.impressoes > 0 ? completedViews / totals.impressoes : null
    }
  }
}

function rankingVolume(metric: PerformanceHistoryMetric, totals: Totals): number {
  switch (metric) {
    case 'hook_rate':
    case 'hold_rate': return totals.impressoes
    case 'conv_body': return totals.views75pct
    case 'cpc_link': return totals.cliquesLink
  }
}

function isDescending(metric: PerformanceHistoryMetric): boolean {
  return metric !== 'cpc_link'
}

function orderedDays(rows: readonly PerformanceMetaRow[], supplied: readonly string[] | undefined): string[] {
  if (supplied) return [...new Set(supplied)].sort()
  return [...new Set(rows.map((row) => dayOf(row.data)).filter((day): day is string => day != null))].sort()
}

/**
 * Agrega séries para as quatro métricas e deixa em cada uma apenas os Top X
 * daquele indicador. Taxas são razão das SOMAS, nunca média das taxas diárias.
 */
export function buildCreativePerformanceHistory(
  metaRows: readonly PerformanceMetaRow[],
  transactionRows: readonly PerformanceTransactionRow[],
  { days: requestedDays, topByMetric }: PerformanceHistoryOptions,
): CreativePerformanceHistory {
  const creatives = new Map<string, CreativeAggregate>()
  const adIdToCreative = new Map<string, string>()

  for (const row of metaRows) {
    const day = dayOf(row.data)
    if (!day) continue
    const name = creativeName(row)
    const aggregate = getOrCreate(creatives, name)
    if (row.ad_id) {
      adIdToCreative.set(row.ad_id, name)
      aggregate.investmentByAdId.set(
        row.ad_id,
        (aggregate.investmentByAdId.get(row.ad_id) ?? 0) + Number(row.investimento ?? 0),
      )
    }
    addMeta(aggregate.total, row)
    addMeta(getDayTotals(aggregate, day), row)
  }

  for (const row of transactionRows) {
    const day = dayOf(row.data)
    if (!day || tipoDaTransacao(row) !== 'frontEnd') continue
    const byAdId = row.ad_id ? adIdToCreative.get(row.ad_id) : undefined
    const name = byAdId ?? row.criativo
    if (!name) continue
    const aggregate = creatives.get(name)
    // Uma transação cujo nome/ad_id não está entre os cards filtrados não pode
    // criar uma série própria nem contaminar o ranking.
    if (!aggregate) continue
    aggregate.total.vendasFront += 1
    getDayTotals(aggregate, day).vendasFront += 1
  }

  const days = orderedDays(metaRows, requestedDays)
  const representativeAdId = (creative: CreativeAggregate): string => {
    let result = creative.name
    let bestInvestment = -Infinity
    for (const [adId, investment] of creative.investmentByAdId) {
      if (investment > bestInvestment || (investment === bestInvestment && adId < result)) {
        result = adId
        bestInvestment = investment
      }
    }
    return result
  }
  const metricHistoryFor = (metric: PerformanceHistoryMetric): PerformanceMetricHistory => {
    const ranked = [...creatives.values()]
      .map((creative) => ({ creative, value: performanceMetricValue(metric, creative.total) }))
      .filter((entry): entry is { creative: CreativeAggregate; value: number } => entry.value != null)
      .sort((a, b) => {
        const valueOrder = isDescending(metric) ? b.value - a.value : a.value - b.value
        if (valueOrder !== 0) return valueOrder
        const volumeOrder = rankingVolume(metric, b.creative.total) - rankingVolume(metric, a.creative.total)
        if (volumeOrder !== 0) return volumeOrder
        return a.creative.name.localeCompare(b.creative.name, 'pt-BR')
      })
      .slice(0, Math.max(1, Math.floor(topByMetric[metric])))

    return {
      series: ranked.map(({ creative }) => ({
        adId: representativeAdId(creative),
        name: creative.name,
        points: days.map((day) => ({
          date: day,
          value: performanceMetricValue(metric, creative.byDay.get(day) ?? zeroTotals()),
        })),
      })),
    }
  }

  return {
    metrics: {
      hook_rate: metricHistoryFor('hook_rate'),
      conv_body: metricHistoryFor('conv_body'),
      cpc_link: metricHistoryFor('cpc_link'),
      hold_rate: metricHistoryFor('hold_rate'),
    },
  }
}
