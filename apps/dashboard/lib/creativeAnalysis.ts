/**
 * Análise por criativo: agrega Meta Ads + transações por ad_id / criativo,
 * monta matriz 2×2 (LPV × métrica de conversão) e score de saúde.
 *
 * "Sessões por criativo" = landing_page_views do Meta Ads. Decisão registrada
 * no plano v2 — sem tracking novo nas landings.
 */

import { tipoDaTransacao, type SbMetaAds, type SbTransacao } from './supabase'
import { liquidoHotmartVenda } from './hotmartFees'
import type { SemaforoColor } from '@/types'

export type QuadrantMetric = 'conv_pagina' | 'roas' | 'cpa'

export type Quadrant = 'champion' | 'hidden_gem' | 'magnet' | 'dead'

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  champion: 'Campeão',
  hidden_gem: 'Joia escondida',
  magnet: 'Ímã de tráfego',
  dead: 'Perdedor',
}

export const QUADRANT_COLOR: Record<Quadrant, string> = {
  champion: '#10B981',
  hidden_gem: '#22D3EE',
  magnet: '#F59E0B',
  dead: '#F43F5E',
}

export const QUADRANT_DESCRIPTION: Record<Quadrant, string> = {
  champion: 'Alto volume + alta conversão. Escalar.',
  hidden_gem: 'Baixo volume + alta conversão. Aumentar verba.',
  magnet: 'Alto volume + baixa conversão. Otimizar página.',
  dead: 'Baixo volume + baixa conversão. Pausar.',
}

export interface CreativeStats {
  key: string                 // ad_id ou criativo (fallback)
  ad_id: string | null
  criativo: string
  campaign_name?: string
  adset_name?: string
  preview_url?: string | null
  investimento: number
  impressoes: number
  cliques_link: number
  landing_views: number       // LPV — proxy de sessões por criativo
  checkouts: number
  compras: number
  brutoTotal: number          // soma valor_bruto de TODAS transações do criativo
  liquidoTotal: number        // soma do líquido POR transação (taxa Hotmart canônica)
  nTrans: number              // nº de transações (FE + OBs) — contagem
  receita: number             // líquido DA OPERAÇÃO = soma dos líquidos por transação
  roas: number                // LÍQUIDO: receita / investimento (0 se invest=0)
  roasBruto: number           // BRUTO: brutoTotal / investimento (casa com exibição Meta)
  cpa: number | null          // null se 0 compras
  conv_pagina: number         // compras / landing_views (0 se LPV=0)
  conv_clique: number         // compras / cliques_link
  score: number               // 0-100
  health: SemaforoColor
  contas?: number             // nº de contas Meta distintas fundidas neste nome (transparência do agrupamento)
}

/**
 * Agrupa rows do meta_ads (já filtradas por período + conta + funil) por
 * `ad_id` (preferido) ou `criativo`. Cruza com transações pra calcular
 * receita real do Hotmart (Meta tracking de compras é menos confiável).
 */
export function aggregateCreatives(
  metaAds: SbMetaAds[],
  transacoes: SbTransacao[],
): CreativeStats[] {
  // Agrupa por NOME do criativo exatamente igual (m.criativo, fallback ad_name) —
  // o mesmo criativo rodando em vários anúncios (ad_ids diferentes) vira UMA linha.
  // `adIdToName` roteia transações com ad_id pro grupo certo; `investByAdId` escolhe
  // o ad_id representante (maior investimento) pra preview/IA/permalink no card.
  const byKey = new Map<string, CreativeStats>()
  const adIdToName = new Map<string, string>()
  const investByAdId = new Map<string, number>()
  const accountsByName = new Map<string, Set<string>>()

  for (const m of metaAds) {
    const adId = m.ad_id || null
    const name = m.criativo || m.ad_name || '(sem nome)'
    if (adId) {
      adIdToName.set(adId, name)
      investByAdId.set(adId, (investByAdId.get(adId) ?? 0) + Number(m.investimento ?? 0))
    }
    if (m.account_id) {
      if (!accountsByName.has(name)) accountsByName.set(name, new Set())
      accountsByName.get(name)!.add(m.account_id)
    }
    const existing = byKey.get(name)
    if (existing) {
      existing.investimento += Number(m.investimento ?? 0)
      existing.impressoes += Number(m.impressoes ?? 0)
      existing.cliques_link += Number(m.cliques_link ?? 0)
      existing.landing_views += Number(m.landing_views ?? 0)
      existing.checkouts += Number(m.checkouts ?? 0)
      // compras vêm de transações (mais confiável) — não somar aqui.
    } else {
      byKey.set(name, {
        key: name,
        ad_id: adId,
        criativo: name,
        campaign_name: m.campaign_name,
        adset_name: m.adset_name,
        preview_url: m.preview_url,
        investimento: Number(m.investimento ?? 0),
        impressoes: Number(m.impressoes ?? 0),
        cliques_link: Number(m.cliques_link ?? 0),
        landing_views: Number(m.landing_views ?? 0),
        checkouts: Number(m.checkouts ?? 0),
        compras: 0,
        brutoTotal: 0,
        liquidoTotal: 0,
        nTrans: 0,
        receita: 0,
        roas: 0,
        roasBruto: 0,
        cpa: null,
        conv_pagina: 0,
        conv_clique: 0,
        score: 0,
        health: 'red',
        contas: 0,
      })
    }
  }

  // ad_id representante de cada nome = o ad_id com MAIOR investimento acumulado.
  for (const c of byKey.values()) {
    let bestId = c.ad_id
    let bestInv = bestId ? (investByAdId.get(bestId) ?? 0) : -1
    for (const [adId, name] of adIdToName) {
      if (name !== c.key) continue
      const inv = investByAdId.get(adId) ?? 0
      if (inv > bestInv) { bestInv = inv; bestId = adId }
    }
    c.ad_id = bestId
    c.contas = accountsByName.get(c.key)?.size ?? 0
  }

  // Cruza transações: roteia ad_id → nome do grupo; fallback pelo nome do criativo.
  // compras conta APENAS vendas frontEnd (regra de CPA). receita soma tudo
  // (OBs legitimamente compõem a receita atribuível ao criativo).
  for (const t of transacoes) {
    const adId = t.ad_id || null
    const nameFromAd = adId ? adIdToName.get(adId) : undefined
    const stats =
      (nameFromAd ? byKey.get(nameFromAd) : null) ??
      (t.criativo ? byKey.get(t.criativo) : null)
    if (!stats) continue
    // Acumula bruto + líquido POR transação + contagem (OBs compõem a receita
    // atribuível ao criativo). Líquido por-transação = modelo Hotmart exato.
    const v = Number(t.valor_bruto ?? 0)
    stats.brutoTotal += v
    stats.liquidoTotal += liquidoHotmartVenda(v)
    stats.nTrans += 1
    if (tipoDaTransacao(t) !== 'frontEnd') continue
    stats.compras += 1
  }

  // Calcula derivadas e score.
  for (const c of byKey.values()) {
    // receita = líquido DA OPERAÇÃO = soma dos líquidos por transação (canônico).
    c.receita = c.liquidoTotal
    c.roas = c.investimento > 0 ? c.receita / c.investimento : 0
    c.roasBruto = c.investimento > 0 ? c.brutoTotal / c.investimento : 0
    c.cpa = c.compras > 0 ? c.investimento / c.compras : null
    c.conv_pagina = c.landing_views > 0 ? c.compras / c.landing_views : 0
    c.conv_clique = c.cliques_link > 0 ? c.compras / c.cliques_link : 0
  }

  // Score requer estatísticas do grupo todo — calcula em segunda passada.
  const list = Array.from(byKey.values())
  const maxRoas = Math.max(1, ...list.map((c) => c.roas))
  const maxConv = Math.max(0.01, ...list.map((c) => c.conv_pagina))
  const maxLv = Math.max(10, ...list.map((c) => c.landing_views))

  for (const c of list) {
    c.score = creativeHealthScore(c, { maxRoas, maxConv, maxLv })
    c.health = scoreToHealth(c.score)
  }

  return list.sort((a, b) => b.investimento - a.investimento)
}

interface ScoreContext {
  maxRoas: number
  maxConv: number
  /** Maior landing_views do grupo — denominador do pilar LPV (F2 #10). */
  maxLv: number
}

/**
 * 0–100. Combinação:
 *   - 40% log(LPV+1) normalizado pelo log do max do grupo
 *   - 40% ROAS normalizado
 *   - 20% conv_pagina normalizada
 * Criativo zerado (sem LPV e sem compras) score 0.
 */
export function creativeHealthScore(c: CreativeStats, ctx?: ScoreContext): number {
  if (c.landing_views === 0 && c.compras === 0) return 0
  const maxRoas = ctx?.maxRoas ?? Math.max(1, c.roas)
  const maxConv = ctx?.maxConv ?? Math.max(0.01, c.conv_pagina)
  // F2 #10 — log(LPV) normalizado pelo log do MAX DO GRUPO: a versão anterior
  // saturava em 1.0 pra qualquer criativo com ≥10 landing views (pilar de 40%
  // do score virava constante e não rankeava nada).
  const maxLv = ctx?.maxLv ?? Math.max(10, c.landing_views)
  const lpvNorm = c.landing_views > 0 ? Math.log10(c.landing_views + 1) / Math.log10(maxLv + 1) : 0
  const roasNorm = maxRoas > 0 ? Math.min(1, c.roas / maxRoas) : 0
  const convNorm = maxConv > 0 ? Math.min(1, c.conv_pagina / maxConv) : 0
  const raw = 0.4 * lpvNorm + 0.4 * roasNorm + 0.2 * convNorm
  return Math.round(Math.max(0, Math.min(1, raw)) * 100)
}

export function scoreToHealth(score: number): SemaforoColor {
  if (score >= 70) return 'green'
  if (score >= 40) return 'yellow'
  return 'red'
}

/**
 * Matriz 2×2: eixo X = LPV (volume), eixo Y = métrica escolhida.
 * Split pela mediana de cada eixo entre os criativos com dados (LPV > 0).
 * Para CPA: invertido — low CPA = "good".
 */
export interface QuadrantMatrixResult {
  metric: QuadrantMetric
  medianLpv: number
  medianMetric: number
  cells: Record<Quadrant, CreativeStats[]>
}

export function buildQuadrantMatrix(
  creatives: CreativeStats[],
  metric: QuadrantMetric,
): QuadrantMatrixResult {
  const withVolume = creatives.filter((c) => c.landing_views > 0)
  const medianLpv = median(withVolume.map((c) => c.landing_views))
  const metricValues = withVolume
    .map((c) => metricValue(c, metric))
    .filter((v): v is number => v != null)
  const medianMetric = median(metricValues)

  const cells: Record<Quadrant, CreativeStats[]> = {
    champion: [],
    hidden_gem: [],
    magnet: [],
    dead: [],
  }
  for (const c of withVolume) {
    const mv = metricValue(c, metric)
    const highVolume = c.landing_views >= medianLpv
    const goodMetric = isMetricGood(mv, medianMetric, metric)

    let q: Quadrant
    if (highVolume && goodMetric) q = 'champion'
    else if (!highVolume && goodMetric) q = 'hidden_gem'
    else if (highVolume && !goodMetric) q = 'magnet'
    else q = 'dead'

    cells[q].push(c)
  }
  return { metric, medianLpv, medianMetric, cells }
}

function metricValue(c: CreativeStats, metric: QuadrantMetric): number | null {
  if (metric === 'conv_pagina') return c.conv_pagina
  if (metric === 'roas') return c.roas
  if (metric === 'cpa') return c.cpa
  return null
}

function isMetricGood(value: number | null, median: number, metric: QuadrantMetric): boolean {
  if (value == null) return false
  if (metric === 'cpa') {
    // Sem compras (cpa null) tratado como ruim; cpa > 0 abaixo da mediana é bom.
    return value > 0 && value <= median
  }
  return value >= median
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function quadrantFor(
  c: CreativeStats,
  metric: QuadrantMetric,
  matrix: QuadrantMatrixResult,
): Quadrant | null {
  if (c.landing_views <= 0) return null
  const mv = metricValue(c, metric)
  const highVolume = c.landing_views >= matrix.medianLpv
  const goodMetric = isMetricGood(mv, matrix.medianMetric, metric)
  if (highVolume && goodMetric) return 'champion'
  if (!highVolume && goodMetric) return 'hidden_gem'
  if (highVolume && !goodMetric) return 'magnet'
  return 'dead'
}
