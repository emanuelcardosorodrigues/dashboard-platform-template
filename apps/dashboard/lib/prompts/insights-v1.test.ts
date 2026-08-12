import { describe, test, expect } from 'vitest'
import { buildInsightsPrompt, INSIGHTS_PROMPT_VERSION } from './insights-v1'

describe('buildInsightsPrompt', () => {
  test('inclui contexto JSON, data e nome do cliente', () => {
    const p = buildInsightsPrompt({ data: '2026-05-11', contexto: { sessions: 1000 } })
    expect(p).toContain('dashboard-demo')
    expect(p).toContain('2026-05-11')
    expect(p).toContain('"sessions": 1000')
  })

  test('inclui instruções de output (4 categorias)', () => {
    const p = buildInsightsPrompt({ data: '2026-05-11', contexto: {} })
    expect(p).toMatch(/tldr/)
    expect(p).toMatch(/alertas/)
    expect(p).toMatch(/oportunidades/)
    expect(p).toMatch(/recomendacoes/)
  })

  test('versão exportada estável (v + número)', () => {
    expect(INSIGHTS_PROMPT_VERSION).toMatch(/^v\d+$/)
  })
})
