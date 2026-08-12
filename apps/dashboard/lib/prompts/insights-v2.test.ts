import { describe, it, expect } from 'vitest'
import { buildInsightsV2Prompt, INSIGHTS_V2_PROMPT_VERSION } from './insights-v2'

describe('buildInsightsV2Prompt', () => {
  it('versão v2', () => {
    expect(INSIGHTS_V2_PROMPT_VERSION).toBe('v2')
  })

  it('formato de dia único quando from===to', () => {
    const out = buildInsightsV2Prompt({ from: '2026-05-01', to: '2026-05-01', contexto: {} })
    expect(out).toContain('Dia analisado: 2026-05-01')
    expect(out).not.toContain('Período analisado')
  })

  it('formato de range quando from !== to', () => {
    const out = buildInsightsV2Prompt({ from: '2026-05-05', to: '2026-05-11', contexto: {} })
    expect(out).toContain('Período analisado: 2026-05-05 → 2026-05-11')
  })

  it('serializa contexto como JSON', () => {
    const out = buildInsightsV2Prompt({ from: 'x', to: 'x', contexto: { foo: 'bar' } })
    expect(out).toContain('"foo": "bar"')
  })

  it('inclui instruções sobre matriz e cohort', () => {
    const out = buildInsightsV2Prompt({ from: 'x', to: 'x', contexto: {} })
    expect(out).toContain('quadrante')
    expect(out).toContain('cohort')
    expect(out).toMatch(/semana anterior|linha de base/i)
  })
})
