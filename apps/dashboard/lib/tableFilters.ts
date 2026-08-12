/**
 * Filtros avançados pra tabelas (Criativos / Campanhas / Conjuntos).
 *
 * Estrutura:
 *   FilterState = { groups: Group[] }   ← grupos combinados por OR
 *   Group       = { rules: Rule[] }     ← regras dentro do grupo combinadas por AND
 *
 * Operadores benchmark (`above_median`, `top_pct`) usam estatística da própria
 * base filtrada — não precisam de número absoluto.
 */

export type Op =
  | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'
  | 'between'
  | 'above_median' | 'below_median'
  | 'top_pct'   // top N% (value = N, e.g. 10 = top 10%)
  | 'bottom_pct'

export const OP_LABEL: Record<Op, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
  between: 'entre',
  above_median: 'acima da mediana',
  below_median: 'abaixo da mediana',
  top_pct: 'top % (alto)',
  bottom_pct: 'top % (baixo)',
}

export const NEEDS_VALUE: Record<Op, 'one' | 'two' | 'none'> = {
  gt: 'one', gte: 'one', lt: 'one', lte: 'one', eq: 'one', neq: 'one',
  between: 'two',
  above_median: 'none', below_median: 'none',
  top_pct: 'one', bottom_pct: 'one',
}

export interface Rule {
  id: string
  column: string
  op: Op
  value: number
  value2?: number
}

export interface Group {
  id: string
  rules: Rule[]
}

export interface FilterState {
  groups: Group[]
}

export interface FilterableColumn {
  key: string
  label: string
  /** Formatter pra exibir valor em chip / preset */
  format?: (v: number) => string
  /** Domínio: 'currency' | 'percent' | 'number' — só pra ajudar o input */
  kind?: 'currency' | 'percent' | 'number'
}

export interface Preset {
  id: string
  name: string
  state: FilterState
  builtin?: boolean
}

export const EMPTY_FILTER: FilterState = { groups: [] }

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function newRule(column: string, op: Op = 'gte', value = 0): Rule {
  return { id: makeId(), column, op, value }
}

export function newGroup(rules: Rule[] = []): Group {
  return { id: makeId(), rules }
}

// ─── Pre-calc stats por coluna ────────────────────────────────────────────────
interface ColStats {
  median: number
  sorted: number[]   // ascending, only finite > -Infinity
}

function computeStats<T extends Record<string, unknown>>(rows: T[], column: string): ColStats {
  const vals: number[] = []
  for (const r of rows) {
    const raw = r[column]
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
    if (Number.isFinite(n)) vals.push(n)
  }
  vals.sort((a, b) => a - b)
  const median = vals.length ? vals[Math.floor(vals.length / 2)] : 0
  return { median, sorted: vals }
}

function thresholdAtPct(sorted: number[], pct: number): number {
  if (!sorted.length) return 0
  const clamped = Math.min(100, Math.max(0, pct))
  // top_pct: queremos o valor que separa os top N% — index do (1 - pct/100)
  const idx = Math.floor(sorted.length * (1 - clamped / 100))
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

function bottomThresholdAtPct(sorted: number[], pct: number): number {
  if (!sorted.length) return 0
  const clamped = Math.min(100, Math.max(0, pct))
  const idx = Math.floor(sorted.length * (clamped / 100))
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

function evalRule(row: Record<string, unknown>, rule: Rule, stats: ColStats): boolean {
  const raw = row[rule.column]
  const v = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
  if (!Number.isFinite(v)) return false

  switch (rule.op) {
    case 'gt':  return v >  rule.value
    case 'gte': return v >= rule.value
    case 'lt':  return v <  rule.value
    case 'lte': return v <= rule.value
    case 'eq':  return v === rule.value
    case 'neq': return v !== rule.value
    case 'between': {
      const lo = Math.min(rule.value, rule.value2 ?? rule.value)
      const hi = Math.max(rule.value, rule.value2 ?? rule.value)
      return v >= lo && v <= hi
    }
    case 'above_median': return v >  stats.median
    case 'below_median': return v <  stats.median
    case 'top_pct':      return v >= thresholdAtPct(stats.sorted, rule.value)
    case 'bottom_pct':   return v <= bottomThresholdAtPct(stats.sorted, rule.value)
  }
}

export function applyFilter<T extends Record<string, unknown>>(rows: T[], filter: FilterState): T[] {
  if (!filter.groups.length) return rows
  if (filter.groups.every((g) => g.rules.length === 0)) return rows

  // pre-calc stats só para colunas com benchmark ops
  const needsStats = new Set<string>()
  for (const g of filter.groups) for (const r of g.rules) {
    if (NEEDS_VALUE[r.op] === 'none' || r.op === 'top_pct' || r.op === 'bottom_pct') {
      needsStats.add(r.column)
    }
  }
  const stats: Record<string, ColStats> = {}
  for (const col of needsStats) stats[col] = computeStats(rows, col)

  return rows.filter((row) => {
    return filter.groups.some((g) => {
      if (g.rules.length === 0) return true
      return g.rules.every((r) => evalRule(row, r, stats[r.column] ?? { median: 0, sorted: [] }))
    })
  })
}

// ─── URL serialization ────────────────────────────────────────────────────────
export function encodeFilter(state: FilterState): string {
  if (!state.groups.length) return ''
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(state))))
  } catch {
    return ''
  }
}

export function decodeFilter(s: string | null | undefined): FilterState {
  if (!s) return EMPTY_FILTER
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(s))))
    if (obj && Array.isArray(obj.groups)) return obj as FilterState
  } catch { /* fallthrough */ }
  return EMPTY_FILTER
}

// ─── Aggregates (rodapé dos totais) ──────────────────────────────────────────
export interface AggregateSpec {
  key: string
  label: string
  kind: 'sum' | 'avg' | 'weighted_avg' | 'ratio'
  /** Para weighted_avg: peso é outra coluna (e.g. ROAS ponderado por investimento) */
  weightKey?: string
  /** Para ratio: sum(numKey) / sum(denKey) (e.g. CPA = sum(investimento) / sum(vendasFront)) */
  numKey?: string
  denKey?: string
  format?: (v: number) => string
}

export function aggregate<T extends Record<string, unknown>>(
  rows: T[],
  spec: AggregateSpec
): number {
  if (rows.length === 0) return 0
  if (spec.kind === 'sum') {
    let s = 0
    for (const r of rows) { const n = Number(r[spec.key]); if (Number.isFinite(n)) s += n }
    return s
  }
  if (spec.kind === 'avg') {
    let s = 0, c = 0
    for (const r of rows) { const n = Number(r[spec.key]); if (Number.isFinite(n)) { s += n; c++ } }
    return c ? s / c : 0
  }
  // weighted_avg: sum(value * weight) / sum(weight)
  if (spec.kind === 'weighted_avg' && spec.weightKey) {
    let num = 0, den = 0
    for (const r of rows) {
      const v = Number(r[spec.key])
      const w = Number(r[spec.weightKey])
      if (Number.isFinite(v) && Number.isFinite(w)) { num += v * w; den += w }
    }
    return den ? num / den : 0
  }
  // ratio: sum(numKey) / sum(denKey) — preserva todas as linhas no numerador
  if (spec.kind === 'ratio' && spec.numKey && spec.denKey) {
    let num = 0, den = 0
    for (const r of rows) {
      const n = Number(r[spec.numKey])
      const d = Number(r[spec.denKey])
      if (Number.isFinite(n)) num += n
      if (Number.isFinite(d)) den += d
    }
    return den ? num / den : 0
  }
  return 0
}

// ─── CSV export ──────────────────────────────────────────────────────────────
export function toCSV<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: string; label: string }[]
): string {
  const head = columns.map((c) => esc(c.label)).join(',')
  const body = rows.map((row) =>
    columns.map((c) => esc(formatCell(row[c.key]))).join(',')
  ).join('\n')
  return head + '\n' + body
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')
  }
  return String(v)
}

function esc(s: string): string {
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ─── Presets ─────────────────────────────────────────────────────────────────
export function builtinPresets(): Preset[] {
  return [
    {
      id: 'winners',
      name: '🏆 Vencedores',
      builtin: true,
      state: {
        groups: [{
          id: 'g1', rules: [
            { id: 'r1', column: 'investimento', op: 'gte', value: 50 },
            { id: 'r2', column: 'roas', op: 'gte', value: 1.5 },
          ],
        }],
      },
    },
    {
      id: 'draining',
      name: '🚨 Drenando',
      builtin: true,
      state: {
        groups: [{
          id: 'g1', rules: [
            { id: 'r1', column: 'investimento', op: 'gte', value: 200 },
            { id: 'r2', column: 'vendasFront', op: 'eq', value: 0 },
          ],
        }],
      },
    },
    {
      id: 'scale',
      name: '📈 Escalar',
      builtin: true,
      state: {
        groups: [{
          id: 'g1', rules: [
            { id: 'r1', column: 'roas', op: 'gte', value: 1.5 },
            { id: 'r2', column: 'vendasFront', op: 'gte', value: 3 },
          ],
        }],
      },
    },
    {
      id: 'tiring',
      name: '💀 Cansando',
      builtin: true,
      state: {
        groups: [{
          id: 'g1', rules: [
            { id: 'r1', column: 'investimento', op: 'gte', value: 100 },
            { id: 'r2', column: 'hookRate', op: 'lt', value: 25 },
          ],
        }],
      },
    },
    {
      id: 'testing',
      name: '🧪 Testando',
      builtin: true,
      state: {
        groups: [{
          id: 'g1', rules: [
            { id: 'r1', column: 'investimento', op: 'lt', value: 50 },
          ],
        }],
      },
    },
  ]
}
