/**
 * F1 + F2 (plano mobile v2, §F — Inteligência). LÓGICA 100% DETERMINÍSTICA,
 * ZERO IA (regra do dono: máximo hard-coded, IA só analisa).
 *
 * F1 — `whatChanged`: dado a série diária do período, devolve 0-3 linhas de
 *      mudança RELEVANTE ("ROAS caiu 22% vs. o esperado"). Silêncio é informação:
 *      se nada passa dos pisos, devolve [] e o card não renderiza.
 *
 * F2 — `expectedBand`: para cada dia da série, o valor ESPERADO + a banda de
 *      incerteza (IC), calculados por projeção de um passo à frente (one-step-
 *      ahead): o que o modelo teria previsto para aquele dia vendo só os dias
 *      anteriores. É a MESMA engine da F1, então card e gráfico nunca se
 *      contradizem.
 *
 * A matemática já existe e é reusada como está:
 *   - `projetarMetrica` (tendência via `linearFit` + shrinkage) dá valor+IC.
 *   - `diaSemanaFatores` entra como `dowFatores` só nas métricas de VOLUME
 *     (faturamento/lucro), pra não disparar falso alarme de fim de semana.
 *   - `toneForDelta` (lib/metricDirection) decide bom/ruim por métrica —
 *     ROAS caindo = ruim, CPA subindo = ruim.
 */

import { projetarMetrica, type SeriePonto } from '@/lib/metrics/sparkline'
import { toneForDelta } from '@/lib/metricDirection'
import { formatCurrencyCompact } from '@/lib/formatters'

// ─── Pisos (a "régua de relevante") ───────────────────────────────────────────
// Exportados de propósito: são o contrato anti-ruído e a MobileHomeSection reusa
// o INVEST_FLOOR pra marcar o "dia fora da banda" com a mesma régua da F2.
export const WHAT_CHANGED = {
  /** Dia só conta como ativo/marcável se o gasto ≥ R$50 (mesma régua do /criativos-ia). */
  INVEST_FLOOR: 50,
  /** |Δ%| mínimo pra uma métrica virar linha: 15%. */
  DELTA_FLOOR: 0.15,
  /** Dias ATIVOS de histórico (antes do dia-alvo) exigidos pra projetar com confiança. */
  MIN_HIST_DAYS: 5,
  /** |esperado| mínimo em R$ pra faturamento/lucro — evita "300%" em cima de migalha. */
  BASE_MONEY_FLOOR: 50,
  /** Esperado mínimo de ROAS pra a linha valer. */
  ROAS_FLOOR: 0.3,
  /** Esperado mínimo de CPA (R$) pra a linha valer. */
  CPA_FLOOR: 1,
  /** Teto de linhas no card. */
  MAX_LINES: 3,
} as const

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Um dia da série do período (o que a MobileHomeSection já agrega). */
export interface WhatChangedDay {
  date: string // YYYY-MM-DD
  faturamento: number
  investimento: number
  lucro: number
  vendasFront: number // necessário pra derivar CPA/dia
}

export type WhatChangedMetric = 'roas' | 'cpa' | 'faturamento' | 'lucro'

/** Uma linha do card "o que mudou". */
export interface WhatChangedLine {
  metric: WhatChangedMetric
  label: string
  text: string // "ROAS caiu 22% vs. o esperado"
  deltaPct: number // assinado (atual − esperado) / |esperado|
  tone: 'good' | 'bad'
  atual: number
  esperado: number
}

/** Ponto da banda de esperado (F2). `null` onde não há histórico suficiente. */
export interface BandPoint {
  date: string
  esperado: number | null
  lo: number | null
  hi: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Texto da linha. Razões (ROAS/CPA) não cruzam zero → "% vs. o esperado" é seguro.
 * Dinheiro (faturamento/lucro) CRUZA zero (lucro pode virar prejuízo) → "% de
 * variação" mente ("caiu 252%"); usa valor ABSOLUTO em R$, mais honesto e acionável.
 */
function buildText(metric: WhatChangedMetric, label: string, atual: number, esperado: number): string {
  const delta = atual - esperado
  if (metric === 'faturamento' || metric === 'lucro') {
    // Sinal virou pro vermelho: o "%" seria absurdo — nomeia o que aconteceu.
    if (metric === 'lucro' && atual < 0 && esperado >= 0) {
      return `Lucro virou prejuízo (esperava ${formatCurrencyCompact(esperado)})`
    }
    const dir = delta >= 0 ? 'acima' : 'abaixo'
    return `${label} ${formatCurrencyCompact(Math.abs(delta))} ${dir} do esperado`
  }
  const pct = Math.round(Math.abs(delta / Math.abs(esperado)) * 100)
  return `${label} ${delta >= 0 ? 'subiu' : 'caiu'} ${pct}% vs. o esperado`
}

/**
 * Projeção de um passo à frente para o dia em `series[idx]`, vendo só os dias
 * ANTERIORES (`series[0..idx-1]`). Devolve o esperado e o IC daquele dia, ou
 * `null` se não há histórico ativo suficiente / a projeção não é de histórico.
 */
function oneStepAhead(
  series: SeriePonto[],
  idx: number,
  dowFatores: number[] | undefined,
): { value: number; lo: number; hi: number } | null {
  const before = series.slice(0, idx)
  const ativos = before.filter((p) => p.value != null && Number.isFinite(p.value))
  if (ativos.length < WHAT_CHANGED.MIN_HIST_DAYS) return null
  const proj = projetarMetrica(before, { hoje: series[idx].date, horizon: 1, dowFatores })
  if (proj.basis !== 'historico') return null
  const p0 = proj.projection[0]
  if (!p0 || !Number.isFinite(p0.value)) return null
  return { value: p0.value, lo: p0.lo, hi: p0.hi }
}

// ─── F1 — card "o que mudou" ──────────────────────────────────────────────────

/**
 * Regra EXATA de "relevante" (todas as condições precisam valer):
 *  1. Existe um dia-alvo = ÚLTIMO dia com gasto ≥ INVEST_FLOOR (R$50). Senão → [].
 *  2. A métrica tem ≥ MIN_HIST_DAYS (5) dias ativos ANTES do dia-alvo, e a
 *     projeção é de base 'historico' (não fallback).
 *  3. |esperado| ≥ piso da métrica (faturamento/lucro R$50; ROAS 0,3; CPA R$1).
 *  4. |Δ%| = |atual − esperado| / |esperado| ≥ DELTA_FLOOR (15%).
 *  5. O valor real caiu FORA do IC [lo, hi] do esperado — corta o ruído de
 *     métrica volátil (um 16% dentro da banda normal NÃO vira linha).
 *  6. O tom não é neutro (delta ≠ 0).
 * Devolve no máx. MAX_LINES (3), ordenadas por magnitude do desvio (maior 1º).
 */
export function whatChanged(
  days: WhatChangedDay[],
  opts: { dowFatores?: number[] } = {},
): WhatChangedLine[] {
  const F = WHAT_CHANGED
  if (days.length < F.MIN_HIST_DAYS + 1) return []

  // (1) dia-alvo = último dia com gasto ≥ piso.
  let targetIdx = -1
  for (let i = days.length - 1; i >= 0; i--) {
    if ((days[i].investimento || 0) >= F.INVEST_FLOOR) {
      targetIdx = i
      break
    }
  }
  if (targetIdx < 0) return []
  const target = days[targetIdx]

  const seriesOf = (pick: (d: WhatChangedDay) => number | null): SeriePonto[] =>
    days.map((d) => ({ date: d.date, value: pick(d) }))

  const specs: {
    metric: WhatChangedMetric
    label: string
    pick: (d: WhatChangedDay) => number | null
    floor: number
    useDow: boolean
  }[] = [
    // Ratio metrics: dow NEUTRO (o fator vem do volume de faturamento e não
    // descreve a sazonalidade de uma razão).
    { metric: 'roas', label: 'ROAS', floor: F.ROAS_FLOOR, useDow: false,
      pick: (d) => (d.investimento > 0 ? d.faturamento / d.investimento : null) },
    { metric: 'cpa', label: 'CPA', floor: F.CPA_FLOOR, useDow: false,
      pick: (d) => (d.vendasFront > 0 && d.investimento > 0 ? d.investimento / d.vendasFront : null) },
    // Volume metrics: dow ATIVO (evita falso alarme de fim de semana).
    { metric: 'faturamento', label: 'Faturamento', floor: F.BASE_MONEY_FLOOR, useDow: true,
      pick: (d) => d.faturamento },
    { metric: 'lucro', label: 'Lucro', floor: F.BASE_MONEY_FLOOR, useDow: true,
      pick: (d) => d.lucro },
  ]

  const lines: WhatChangedLine[] = []
  for (const s of specs) {
    const atual = s.pick(target)
    if (atual == null || !Number.isFinite(atual)) continue // (2) dia-alvo sem valor
    const series = seriesOf(s.pick)
    const exp = oneStepAhead(series, targetIdx, s.useDow ? opts.dowFatores : undefined)
    if (!exp) continue // (2) histórico insuficiente
    if (Math.abs(exp.value) < s.floor) continue // (3) base não-trivial
    const delta = atual - exp.value
    const deltaPct = delta / Math.abs(exp.value)
    if (!Number.isFinite(deltaPct) || Math.abs(deltaPct) < F.DELTA_FLOOR) continue // (4) piso 15%
    if (atual >= exp.lo && atual <= exp.hi) continue // (5) dentro do IC = ruído
    const tone = toneForDelta(s.metric, delta)
    if (tone === 'neutral') continue // (6)
    lines.push({
      metric: s.metric,
      label: s.label,
      text: buildText(s.metric, s.label, atual, exp.value),
      deltaPct,
      tone,
      atual,
      esperado: exp.value,
    })
  }

  // Maior surpresa primeiro; empate → 'bad' antes de 'good' (o que pede ação).
  lines.sort((a, b) => {
    const d = Math.abs(b.deltaPct) - Math.abs(a.deltaPct)
    if (Math.abs(d) > 1e-9) return d
    return a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1
  })
  return lines.slice(0, F.MAX_LINES)
}

// ─── F2 — banda de esperado por dia ───────────────────────────────────────────

/**
 * Para cada dia da série, o valor esperado + banda [lo, hi] via projeção de um
 * passo à frente. Os primeiros MIN_HIST_DAYS dias voltam `null` (sem histórico)
 * e a UI não desenha banda/linha ali. Valores arredondados (moeda).
 */
export function expectedBand(
  series: SeriePonto[],
  opts: { dowFatores?: number[] } = {},
): BandPoint[] {
  return series.map((p, i) => {
    const exp = oneStepAhead(series, i, opts.dowFatores)
    if (!exp) return { date: p.date, esperado: null, lo: null, hi: null }
    return {
      date: p.date,
      esperado: Math.round(exp.value),
      lo: Math.round(exp.lo),
      hi: Math.round(exp.hi),
    }
  })
}

/**
 * Um dia está "fora da banda" (merece destaque no gráfico) se: a banda é válida,
 * o gasto do dia ≥ INVEST_FLOOR (mesma régua anti-ruído da F1/§F2) e o valor real
 * ficou abaixo de `lo` ou acima de `hi`.
 */
export function isOutsideBand(
  real: number,
  investimento: number,
  band: Pick<BandPoint, 'lo' | 'hi'>,
): boolean {
  if (band.lo == null || band.hi == null) return false
  if (investimento < WHAT_CHANGED.INVEST_FLOOR) return false
  return real < band.lo || real > band.hi
}
