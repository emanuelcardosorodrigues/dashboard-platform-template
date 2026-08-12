/**
 * Mascaramento mínimo de texto livre (dores, medos, objetivos, faturamento
 * declarado de leads) antes de enviar pro Gemini. Frases ≤30 chars passam
 * inteiras; frases longas viram "primeiros 30 chars… (hash:6 chars)" pra
 * agrupar sem vazar PII integral.
 *
 * Saída sempre vem com contagem: "categoria (12x)".
 */

import { createHash } from 'crypto'

const MAX_PREFIX = 30

function maskValue(v: string): string {
  if (v.length <= MAX_PREFIX) return v
  const prefix = v.slice(0, MAX_PREFIX).replace(/\s+$/, '')
  const rest = v.slice(MAX_PREFIX)
  const hash = createHash('sha1').update(rest).digest('hex').slice(0, 6)
  return `${prefix}… (hash:${hash})`
}

export function topValoresMascarados<T>(
  rows: T[],
  pick: (r: T) => string | null | undefined,
  n = 3,
): string[] {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const v = (pick(r) ?? '').trim()
    if (!v) continue
    const key = maskValue(v)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([k, c]) => `${k} (${c}x)`)
}

export function topValoresMascaradosFromStrings(values: string[], n = 3): string[] {
  return topValoresMascarados(values.map(v => ({ v })), r => r.v, n)
}
