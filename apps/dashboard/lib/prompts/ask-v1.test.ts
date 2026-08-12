import { describe, it, expect } from 'vitest'
import { buildAskPrompt, ASK_PROMPT_VERSION } from './ask-v1'

describe('buildAskPrompt', () => {
  it('versão ask-v1', () => {
    expect(ASK_PROMPT_VERSION).toBe('ask-v1')
  })

  it('inclui pathname e filtros', () => {
    const out = buildAskPrompt({
      question: 'qual criativo é o pior?',
      pathname: '/criativos',
      searchParams: { de: '2026-05-01', ate: '2026-05-07', funil: 'col-' },
      contexto: { kpis: { roas: 3.2 } },
    })
    expect(out).toContain('/criativos')
    expect(out).toContain('de=2026-05-01')
    expect(out).toContain('funil=col-')
    expect(out).toContain('qual criativo é o pior')
    expect(out).toContain('"roas": 3.2')
  })

  it('ignora "all" e vazios nos filtros', () => {
    const out = buildAskPrompt({
      question: 'q',
      pathname: '/visao-geral',
      searchParams: { conta: 'all', funil: '' },
      contexto: {},
    })
    expect(out).toContain('Filtros ativos: (nenhum)')
  })

  it('inclui histórico recente quando há', () => {
    const out = buildAskPrompt({
      question: 'q',
      pathname: '/criativos',
      searchParams: {},
      contexto: {},
      history: [{ role: 'user', text: 'oi' }, { role: 'assistant', text: 'olá' }],
    })
    expect(out).toContain('Usuário: oi')
    expect(out).toContain('Você: olá')
  })
})
