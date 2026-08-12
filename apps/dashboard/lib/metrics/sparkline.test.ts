import { describe, test, expect } from 'vitest'
import { linearFit, diaSemanaFatores, projetarMetrica, type SeriePonto } from './sparkline'

function serie(vals: (number | null)[], startDate = '2026-05-01'): SeriePonto[] {
  return vals.map((v, i) => {
    const d = new Date(startDate + 'T12:00:00'); d.setDate(d.getDate() + i)
    return { date: d.toISOString().slice(0, 10), value: v }
  })
}

describe('linearFit', () => {
  test('reta perfeita y=2x+1', () => {
    const f = linearFit([0, 1, 2, 3], [1, 3, 5, 7])
    expect(f.slope).toBeCloseTo(2, 6)
    expect(f.intercept).toBeCloseTo(1, 6)
  })
  test('1 ponto → slope 0', () => {
    expect(linearFit([5], [10])).toEqual({ slope: 0, intercept: 10 })
  })
})

describe('diaSemanaFatores', () => {
  test('série plana → fatores ~1', () => {
    const f = diaSemanaFatores(serie(new Array(28).fill(100)))
    for (const x of f) expect(x).toBeCloseTo(1, 6)
  })
  test('vazio → neutro (todos 1)', () => {
    expect(diaSemanaFatores([])).toEqual([1, 1, 1, 1, 1, 1, 1])
  })
})

describe('projetarMetrica', () => {
  test('histórico crescente e longo → projeta subindo, confiança alta', () => {
    const h = serie([10, 12, 14, 16, 18, 20, 22]) // 7 dias subindo
    const r = projetarMetrica(h, { hoje: '2026-05-08' })
    expect(r.projection).toHaveLength(7)
    expect(r.projection[0].value).toBeGreaterThan(22) // continua subindo
    expect(r.slope).toBeCloseTo(2, 1)
    expect(r.confidence).toBeGreaterThan(0.7)
  })

  test('esparso (2 pontos) → tendência encolhida (≈plana) e confiança baixa', () => {
    const h = serie([10, 30]) // 2 pontos, slope cru = 20
    const r = projetarMetrica(h, { hoje: '2026-05-03' })
    // peso = 2/7 → slope encolhido bem abaixo do cru (20)
    expect(Math.abs(r.slope)).toBeLessThan(20 * 0.4)
    expect(r.confidence).toBeLessThan(0.4)
  })

  test('nunca projeta negativo', () => {
    const h = serie([5, 4, 3, 2, 1, 0.5, 0.2]) // despencando
    const r = projetarMetrica(h, { hoje: '2026-05-08' })
    for (const p of r.projection) expect(p.value).toBeGreaterThanOrEqual(0)
  })

  test('banda lo≤value≤hi', () => {
    const r = projetarMetrica(serie([10, 11, 9, 12, 10, 11, 10]), { hoje: '2026-05-08' })
    for (const p of r.projection) {
      expect(p.lo).toBeLessThanOrEqual(p.value)
      expect(p.hi).toBeGreaterThanOrEqual(p.value)
    }
  })

  test('série vazia não quebra', () => {
    const r = projetarMetrica([], { hoje: '2026-05-08' })
    expect(r.projection).toHaveLength(7)
    expect(r.confidence).toBe(0)
  })
})
