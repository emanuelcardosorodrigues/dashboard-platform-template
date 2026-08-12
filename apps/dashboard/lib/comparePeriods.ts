/**
 * Comparação entre períodos.
 *
 * Modos suportados:
 *   • none       — sem comparação
 *   • prev       — período imediatamente anterior, mesma duração (default quando ativo)
 *   • prev_month — mesmos dias do mês anterior
 *   • prev_year  — mesmo período no ano anterior
 *   • custom     — usuário escolhe cmpDe/cmpAte
 *
 * Todas as datas em ISO YYYY-MM-DD, timezone BRT.
 */

export type CompareMode = 'none' | 'prev' | 'prev_month' | 'prev_year' | 'custom'

export const COMPARE_MODE_LABEL: Record<CompareMode, string> = {
  none:        'Sem comparação',
  prev:        'Período anterior',
  prev_month:  'Mês anterior (mesmos dias)',
  prev_year:   'Mesmo período no ano passado',
  custom:      'Personalizado',
}

export interface ComparisonRange {
  from: string
  to: string
}

function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDaysUTC(d: Date, n: number): Date {
  const x = new Date(d.getTime())
  x.setUTCDate(x.getUTCDate() + n)
  return x
}
function diffDaysInclusive(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1
}

/**
 * Calcula o range de comparação a partir do range atual + modo.
 * Retorna null se modo === 'none' ou inputs inválidos.
 */
export function computeComparisonRange(
  de: string,
  ate: string,
  mode: CompareMode,
  customDe?: string,
  customAte?: string,
): ComparisonRange | null {
  if (mode === 'none' || !de || !ate) return null

  if (mode === 'custom') {
    if (!customDe || !customAte) return null
    return { from: customDe, to: customAte }
  }

  const from = parseISO(de)
  const to = parseISO(ate)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null

  if (mode === 'prev') {
    const dias = diffDaysInclusive(from, to)
    const cmpTo = addDaysUTC(from, -1)
    const cmpFrom = addDaysUTC(cmpTo, -(dias - 1))
    return { from: toISO(cmpFrom), to: toISO(cmpTo) }
  }

  if (mode === 'prev_month') {
    const cmpFrom = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, from.getUTCDate()))
    const cmpTo = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, to.getUTCDate()))
    return { from: toISO(cmpFrom), to: toISO(cmpTo) }
  }

  if (mode === 'prev_year') {
    const cmpFrom = new Date(Date.UTC(from.getUTCFullYear() - 1, from.getUTCMonth(), from.getUTCDate()))
    const cmpTo = new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate()))
    return { from: toISO(cmpFrom), to: toISO(cmpTo) }
  }

  return null
}

/**
 * Calcula delta percentual (current vs previous). Retorna null se previous = 0
 * (não dá pra dividir por zero — UI vai mostrar — em vez de número).
 */
export function calcDeltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/**
 * Calcula delta absoluto.
 */
export function calcDeltaAbs(current: number, previous: number): number {
  return current - previous
}

/**
 * Parse de modo da URL — fallback pra 'none'.
 */
export function parseCompareMode(v: string | null | undefined): CompareMode {
  if (v === 'prev' || v === 'prev_month' || v === 'prev_year' || v === 'custom') return v
  return 'none'
}

/**
 * Para uso em direção contrária: dado o modo, formata um label "humano".
 */
export function formatComparisonLabel(
  mode: CompareMode,
  range: ComparisonRange | null,
): string {
  if (!range || mode === 'none') return ''
  if (mode === 'prev') return 'vs. período anterior'
  if (mode === 'prev_month') return 'vs. mês anterior'
  if (mode === 'prev_year') return 'vs. ano passado'
  if (mode === 'custom') return `vs. ${range.from} a ${range.to}`
  return ''
}
