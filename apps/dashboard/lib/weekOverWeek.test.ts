import { describe, it, expect } from 'vitest'
import { previousRange, computeMetricsFromRows, diffMetrics } from './weekOverWeek'

describe('previousRange', () => {
  it('range de 7 dias retorna os 7 anteriores', () => {
    expect(previousRange('2026-05-05', '2026-05-11')).toEqual({
      from: '2026-04-28',
      to: '2026-05-04',
    })
  })

  it('range de 1 dia retorna o dia anterior', () => {
    expect(previousRange('2026-05-10', '2026-05-10')).toEqual({
      from: '2026-05-09',
      to: '2026-05-09',
    })
  })

  it('atravessa mudança de mês', () => {
    expect(previousRange('2026-05-01', '2026-05-07')).toEqual({
      from: '2026-04-24',
      to: '2026-04-30',
    })
  })
})

describe('computeMetricsFromRows', () => {
  it('soma básica', () => {
    const meta = [
      { investimento: 100, cliques_link: 50, landing_views: 80 },
      { investimento: 50, cliques_link: 30, landing_views: 40 },
    ]
    const trans = [{ valor_bruto: 1000 }, { valor_bruto: 500 }]
    const clarity = [{ recorte: 'total', sessions: 200, rage_clicks: 4, engagement_time_sec: 45 }]
    const m = computeMetricsFromRows(meta, trans, clarity)
    expect(m.investimento).toBe(150)
    // receita = líquido POR transação (canônico): 1000→907.51 + 500→452.01 = 1359.52
    expect(m.receita).toBeCloseTo(1359.52, 2)
    expect(m.vendas).toBe(2)
    expect(m.lpv).toBe(120)
    expect(m.roas).toBeCloseTo(9.0635, 3) // 1359.52 / 150
    expect(m.cpa).toBe(75)
    expect(m.conv_pagina).toBeCloseTo(2 / 120)
    expect(m.clarity_sessions).toBe(200)
    expect(m.clarity_rage_pct).toBeCloseTo(2)
    expect(m.clarity_engagement_sec).toBeCloseTo(45)
  })

  it('zeros e nulls não explodem', () => {
    const m = computeMetricsFromRows([], [], [])
    expect(m.investimento).toBe(0)
    expect(m.roas).toBe(0)
    expect(m.cpa).toBeNull()
    expect(m.conv_pagina).toBe(0)
    expect(m.clarity_engagement_sec).toBe(0)
  })

  it('fallback para clarity sem recorte=total usa todas as linhas', () => {
    const m = computeMetricsFromRows(
      [],
      [],
      [{ recorte: 'url', sessions: 100, rage_clicks: 5, engagement_time_sec: 30 }],
    )
    expect(m.clarity_sessions).toBe(100)
    expect(m.clarity_rage_pct).toBeCloseTo(5)
  })
})

describe('diffMetrics', () => {
  it('calcula deltas pct', () => {
    const atual = { investimento: 150, receita: 1500, vendas: 2, lpv: 120, cliques: 80, roas: 10, cpa: 75, conv_pagina: 0.0166, clarity_sessions: 200, clarity_rage_pct: 2, clarity_engagement_sec: 45 }
    const anterior = { investimento: 100, receita: 1000, vendas: 1, lpv: 60, cliques: 40, roas: 10, cpa: 100, conv_pagina: 0.0166, clarity_sessions: 100, clarity_rage_pct: 5, clarity_engagement_sec: 30 }
    const d = diffMetrics(atual, anterior)
    expect(d.investimento).toBe(50)
    expect(d.cpa).toBe(-25)
    expect(d.roas).toBe(0)
  })

  it('previous zero retorna null (sem divisão)', () => {
    const atual = { investimento: 10, receita: 0, vendas: 0, lpv: 0, cliques: 0, roas: 0, cpa: null, conv_pagina: 0, clarity_sessions: 0, clarity_rage_pct: 0, clarity_engagement_sec: 0 }
    const anterior = { investimento: 0, receita: 0, vendas: 0, lpv: 0, cliques: 0, roas: 0, cpa: null, conv_pagina: 0, clarity_sessions: 0, clarity_rage_pct: 0, clarity_engagement_sec: 0 }
    const d = diffMetrics(atual, anterior as never)
    expect(d.investimento).toBeNull()
  })
})
