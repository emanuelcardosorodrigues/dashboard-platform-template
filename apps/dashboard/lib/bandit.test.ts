import { describe, it, expect } from 'vitest'
import { thompsonSample } from './bandit'

describe('thompsonSample', () => {
  it('uniformiza quando min_conv não atingido', () => {
    const r = thompsonSample(
      [
        { slug: 'A', conv: 5, imp: 100 },
        { slug: 'B', conv: 15, imp: 100 },
      ],
      { minConv: 30 }
    )
    expect(r.weights.A).toBeCloseTo(0.5, 1)
    expect(r.weights.B).toBeCloseTo(0.5, 1)
    expect(r.reason).toContain('min_conv_not_met')
  })

  it('B vence em volume suficiente', () => {
    const r = thompsonSample(
      [
        { slug: 'A', conv: 50, imp: 1000 },  // CR 5%
        { slug: 'B', conv: 100, imp: 1000 }, // CR 10%
      ],
      { minConv: 30, draws: 5000 }
    )
    expect(r.weights.B).toBeGreaterThan(0.7)
    expect(r.weights.A).toBeLessThan(0.3)
  })

  it('todas variantes recebem >= 5% (explore floor)', () => {
    const r = thompsonSample(
      [
        { slug: 'A', conv: 10, imp: 1000 },   // CR 1%
        { slug: 'B', conv: 100, imp: 1000 },  // CR 10%
        { slug: 'C', conv: 200, imp: 1000 },  // CR 20%
      ],
      { minConv: 5, draws: 5000 }
    )
    expect(r.weights.A).toBeGreaterThanOrEqual(0.05)
    expect(r.weights.B).toBeGreaterThanOrEqual(0.05)
    expect(r.weights.C).toBeGreaterThanOrEqual(0.05)
  })

  it('champion lock garante >= 60% mesmo perdendo', () => {
    const r = thompsonSample(
      [
        { slug: 'champion', conv: 30, imp: 1000 },  // CR 3%
        { slug: 'challenger', conv: 80, imp: 1000 }, // CR 8% (vence)
      ],
      { minConv: 30, championSlug: 'champion', championMinWeight: 0.6, draws: 5000 }
    )
    expect(r.weights.champion).toBeGreaterThanOrEqual(0.6)
    expect(r.weights.challenger).toBeLessThanOrEqual(0.4)
  })

  it('pesos somam ~1', () => {
    const r = thompsonSample(
      [
        { slug: 'A', conv: 40, imp: 500 },
        { slug: 'B', conv: 60, imp: 500 },
        { slug: 'C', conv: 50, imp: 500 },
      ],
      { minConv: 30, draws: 3000 }
    )
    const sum = Object.values(r.weights).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 1)
  })
})
