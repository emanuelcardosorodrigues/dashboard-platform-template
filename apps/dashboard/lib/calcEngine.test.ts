/**
 * Testes-oráculo do motor da Calculadora contra números publicados/reais.
 * Âncoras: painel col- (referência já publicada) e a janela real COL
 * 2026-04-02→2026-07-21 (base sem imposto e base com imposto Meta ×1,1382).
 */
import { describe, it, expect } from 'vitest'
import { computeCalc, verificarIdentidades, type CalcDrivers, type CalcResult } from './calcEngine'

/** Painel col- — valores publicados. */
const ANCHOR_PAINEL: CalcDrivers = { cpm: 32.14, ctrPct: 1.72, connectPct: 80.3, convPagPct: 5.47, ticket: 69.26 }

/** Dado real, janela COL 2026-04-02→2026-07-21, base SEM imposto Meta. */
const ANCHOR_REAL_SEM_IMPOSTO: CalcDrivers = {
  cpm: 32.158,
  ctrPct: 1.7059,
  connectPct: 80.2034,
  convPagPct: 5.51345,
  ticket: 70.1871,
}

/** Mesmo dado real, base COM imposto Meta (cpm × 1,1382). */
const ANCHOR_REAL_COM_IMPOSTO: CalcDrivers = { ...ANCHOR_REAL_SEM_IMPOSTO, cpm: 36.6026 }

/** Nenhum campo numérico do resultado pode ser NaN ou Infinity (nulls são ok). */
function assertNoNanInfinity(r: CalcResult) {
  for (const [campo, valor] of Object.entries(r)) {
    if (typeof valor === 'number') {
      expect(Number.isFinite(valor), `${campo} não pode ser NaN/Infinity (valor: ${valor})`).toBe(true)
    }
  }
}

describe('computeCalc — âncora do painel col-', () => {
  it('reproduz os números publicados do painel', () => {
    const r = computeCalc(ANCHOR_PAINEL)
    expect(r.cpa).toBeCloseTo(42.54, 2)
    expect(r.roas).toBeCloseTo(1.63, 2)
    expect(r.prv).toBeCloseTo(3.79, 2)
    expect(r.lucroPorPv).toBeCloseTo(1.46, 2)
    expect(r.custoPorPv).toBeCloseTo(2.33, 2)
  })
})

describe('computeCalc — âncora do dado real (janela COL 2026-04-02→2026-07-21)', () => {
  it('base SEM imposto Meta', () => {
    const r = computeCalc(ANCHOR_REAL_SEM_IMPOSTO)
    expect(r.cpa).toBeCloseTo(42.63, 2)
    expect(r.roas).toBeCloseTo(1.646, 3)
    expect(r.prv).toBeCloseTo(3.87, 3)
    expect(r.custoPorPv).toBeCloseTo(2.35, 3)
    expect(r.lucroPorPv).toBeCloseTo(1.519, 3)
  })

  it('base COM imposto Meta (cpm × 1,1382)', () => {
    const r = computeCalc(ANCHOR_REAL_COM_IMPOSTO)
    expect(r.cpa).toBeCloseTo(48.52, 2)
    expect(r.roas).toBeCloseTo(1.446, 3)
    expect(r.custoPorPv).toBeCloseTo(2.675, 3)
    // lucroPorPv em precisão 2, não 3: o valor exato (prv − custoPorPv em precisão
    // total) é 1,1944731835..., que arredonda para 1,194 — a âncora "≈1,195" bate
    // com prv/custoPorPv já ARREDONDADOS a 3 casas (3,870 − 2,675 = 1,195), um
    // artefato de dupla-arredondagem na origem do dado, não um erro da fórmula
    // (que aqui deliberadamente não arredonda nada). Ver relato da tarefa.
    expect(r.lucroPorPv).toBeCloseTo(1.195, 2)
    // prv não depende do cpm — permanece igual ao caso sem imposto.
    expect(r.prv).toBeCloseTo(3.87, 3)
  })
})

describe('verificarIdentidades — as 3 identidades fecham nas âncoras', () => {
  it.each([
    ['painel col-', ANCHOR_PAINEL],
    ['real sem imposto', ANCHOR_REAL_SEM_IMPOSTO],
    ['real com imposto', ANCHOR_REAL_COM_IMPOSTO],
  ] as const)('%s', (_nome, drivers) => {
    const r = computeCalc(drivers)
    const check = verificarIdentidades(drivers, r)
    expect(check.falhas).toEqual([])
    expect(check.ok).toBe(true)
  })
})

describe('VSL é neutro por construção', () => {
  it('play rate × conversão do VSL reproduz exatamente o caso sem VSL', () => {
    // playRatePct × vslConvPct / 100 = convPagPct do caso "real sem imposto" (5.51345).
    const vslConvPct = (ANCHOR_REAL_SEM_IMPOSTO.convPagPct * 100) / 70
    const comVsl: CalcDrivers = {
      ...ANCHOR_REAL_SEM_IMPOSTO,
      convPagPct: 0, // ignorado quando vslOn
      vslOn: true,
      playRatePct: 70,
      vslConvPct,
    }

    const semVsl = computeCalc(ANCHOR_REAL_SEM_IMPOSTO)
    const comVslResult = computeCalc(comVsl)

    expect(comVslResult.convPagEfetiva).toBeCloseTo(semVsl.convPagEfetiva, 9)
    expect(comVslResult.cpa).toBeCloseTo(semVsl.cpa!, 9)
    expect(comVslResult.roas).toBeCloseTo(semVsl.roas!, 9)
    expect(comVslResult.prv).toBeCloseTo(semVsl.prv!, 9)
    expect(comVslResult.custoPorPv).toBeCloseTo(semVsl.custoPorPv!, 9)
    expect(comVslResult.lucroPorPv).toBeCloseTo(semVsl.lucroPorPv!, 9)
    expect(comVslResult.roasBackend).toBe(semVsl.roasBackend)
  })
})

describe('Backend', () => {
  it('backend configurado eleva o roasBackend acima do roas', () => {
    const semBackend = computeCalc(ANCHOR_PAINEL)
    expect(semBackend.roasBackend).toBeNull()

    const comBackend = computeCalc({ ...ANCHOR_PAINEL, backendPct: 1.018, backendLiquido: 3642 })
    expect(comBackend.roasBackend).not.toBeNull()
    expect(comBackend.roas).toBeCloseTo(semBackend.roas!, 9) // roas não muda com backend
    expect(comBackend.roasBackend!).toBeGreaterThan(comBackend.roas!)
  })

  it('sem backendPct/backendLiquido definidos e > 0, roasBackend é null', () => {
    expect(computeCalc({ ...ANCHOR_PAINEL, backendPct: 0, backendLiquido: 3642 }).roasBackend).toBeNull()
    expect(computeCalc({ ...ANCHOR_PAINEL, backendPct: 1.018, backendLiquido: 0 }).roasBackend).toBeNull()
    expect(computeCalc({ ...ANCHOR_PAINEL, backendPct: 1.018 }).roasBackend).toBeNull()
    expect(computeCalc({ ...ANCHOR_PAINEL, backendLiquido: 3642 }).roasBackend).toBeNull()
  })
})

describe('Degenerados — nunca NaN, nunca Infinity', () => {
  it('ctrPct = 0 zera o denominador: cpa, roas, custoPorPv, lucroPorPv ficam null', () => {
    const r = computeCalc({ ...ANCHOR_PAINEL, ctrPct: 0 })
    assertNoNanInfinity(r)
    expect(r.cpa).toBeNull()
    expect(r.roas).toBeNull()
    expect(r.custoPorPv).toBeNull()
    expect(r.lucroPorPv).toBeNull()
  })

  it('connectPct = 0 zera o denominador: cpa, roas, custoPorPv, lucroPorPv ficam null', () => {
    const r = computeCalc({ ...ANCHOR_PAINEL, connectPct: 0 })
    assertNoNanInfinity(r)
    expect(r.cpa).toBeNull()
    expect(r.roas).toBeNull()
    expect(r.custoPorPv).toBeNull()
    expect(r.lucroPorPv).toBeNull()
  })

  it('convPagPct = 0 zera prv e o cpa/roas (custoPorPv não depende de conv, continua calculável)', () => {
    const r = computeCalc({ ...ANCHOR_PAINEL, convPagPct: 0 })
    assertNoNanInfinity(r)
    expect(r.convPagEfetiva).toBe(0)
    expect(r.prv).toBe(0)
    expect(r.cpa).toBeNull()
    expect(r.roas).toBeNull()
    expect(r.custoPorPv).not.toBeNull()
  })

  it('cpm = 0 zera cpa e custoPorPv (sem virar Infinity); roas fica null (divisão por cpa=0)', () => {
    const r = computeCalc({ ...ANCHOR_PAINEL, cpm: 0 })
    assertNoNanInfinity(r)
    expect(r.cpa).toBe(0)
    expect(r.custoPorPv).toBe(0)
    expect(r.roas).toBeNull()
  })
})
