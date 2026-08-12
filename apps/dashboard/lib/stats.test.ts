import { describe, expect, test } from 'vitest'
import { zTest, requiredSampleSize, bayesianBetaBinomial } from './stats'

describe('zTest — two-proportion z-test', () => {
  test('detecta significância 95% quando diferença real é grande', () => {
    // A: 5% CR, B: 10% CR — com amostras grandes
    const r = zTest({ n1: 1000, c1: 50, n2: 1000, c2: 100 })
    expect(r.confidence).toBeGreaterThanOrEqual(95)
    expect(r.winner).toBe('B')
  })

  test('retorna insuficiente com amostras pequenas', () => {
    const r = zTest({ n1: 30, c1: 2, n2: 30, c2: 4 })
    expect(r.confidence).toBe(0)
    expect(r.winner).toBeNull()
  })

  test('retorna insuficiente quando n1 ou n2 é zero', () => {
    const r = zTest({ n1: 0, c1: 0, n2: 100, c2: 10 })
    expect(r.confidence).toBe(0)
    expect(r.winner).toBeNull()
  })

  test('detecta significância 99% com diferença muito grande', () => {
    const r = zTest({ n1: 2000, c1: 100, n2: 2000, c2: 220 })
    expect(r.confidence).toBeGreaterThanOrEqual(99)
  })

  test('identifica A como vencedor quando A tem CR maior', () => {
    const r = zTest({ n1: 1000, c1: 150, n2: 1000, c2: 80 })
    expect(r.winner).toBe('A')
  })

  test('retorna z e taxas brutas', () => {
    const r = zTest({ n1: 1000, c1: 50, n2: 1000, c2: 100 })
    expect(r.cr1).toBeCloseTo(0.05)
    expect(r.cr2).toBeCloseTo(0.10)
    expect(r.z).toBeGreaterThan(0)
  })

  // Fase 4 — sample-size gate + Bayesian
  test('meetsMinSample false em amostra pequena', () => {
    const r = zTest({ n1: 30, c1: 1, n2: 30, c2: 4, mde: 0.1 })
    expect(r.meetsMinSample).toBe(false)
    expect(r.minSampleNeeded).toBeGreaterThan(100)
  })

  test('meetsMinSample true em amostra grande', () => {
    // Detectar lift relativo de 5% sobre CR base de 10% exige ~57,8k por braço
    // (Lehr). O teste antigo usava 10k e afirmava true — matematicamente errado
    // (10k < 57,8k → gate deveria esconder o winner). Corrigido p/ amostra que
    // de fato satisfaz o gate; trava o mínimo real como regressão.
    const r = zTest({ n1: 60000, c1: 6000, n2: 60000, c2: 6600, mde: 0.05 })
    expect(r.minSampleNeeded).toBeGreaterThan(57000)
    expect(r.minSampleNeeded).toBeLessThan(59000)
    expect(r.meetsMinSample).toBe(true)
  })

  test('bayesProb concorda com Z em volume alto', () => {
    const r = zTest({ n1: 5000, c1: 500, n2: 5000, c2: 600 })
    expect(r.confidence).toBeGreaterThanOrEqual(95)
    expect(r.bayesProb).toBeGreaterThan(0.95)
  })

  test('lift calculado corretamente', () => {
    const r = zTest({ n1: 1000, c1: 100, n2: 1000, c2: 120 })
    expect(r.lift).toBeCloseTo(0.2, 1)
  })
})

describe('requiredSampleSize', () => {
  test('CR 10% MDE 2% retorna ≈ 3800', () => {
    const n = requiredSampleSize({ baselineCR: 0.10, mde: 0.2 })
    expect(n).toBeGreaterThan(3500)
    expect(n).toBeLessThan(4200)
  })

  test('baseline maior = menos amostra', () => {
    const small = requiredSampleSize({ baselineCR: 0.05, mde: 0.1 })
    const large = requiredSampleSize({ baselineCR: 0.30, mde: 0.1 })
    expect(large).toBeLessThan(small)
  })

  test('MDE menor = mais amostra', () => {
    const wide = requiredSampleSize({ baselineCR: 0.1, mde: 0.2 })
    const tight = requiredSampleSize({ baselineCR: 0.1, mde: 0.05 })
    expect(tight).toBeGreaterThan(wide * 3)
  })
})

describe('bayesianBetaBinomial', () => {
  test('retorna ~0.5 sem dados', () => {
    expect(bayesianBetaBinomial(0, 0, 0, 0)).toBeCloseTo(0.5, 1)
  })

  test('retorna alto P(B>A) quando B claramente vence', () => {
    const p = bayesianBetaBinomial(50, 1000, 100, 1000, 5000)
    expect(p).toBeGreaterThan(0.95)
  })

  test('retorna ~0.5 quando taxas são iguais', () => {
    const p = bayesianBetaBinomial(50, 1000, 50, 1000, 5000)
    expect(p).toBeGreaterThan(0.4)
    expect(p).toBeLessThan(0.6)
  })
})
