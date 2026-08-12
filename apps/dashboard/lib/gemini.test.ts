import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const generateContent = vi.fn()

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    getGenerativeModel() { return { generateContent } }
  }
  return {
    SchemaType: { OBJECT: 'object', ARRAY: 'array', STRING: 'string' },
    GoogleGenerativeAI,
  }
})

import { generateInsight } from './gemini'

beforeEach(() => {
  generateContent.mockReset()
  process.env.GEMINI_API_KEY = 'k'
  delete process.env.GEMINI_MODEL
})
afterEach(() => { vi.restoreAllMocks() })

describe('generateInsight', () => {
  test('retorna estrutura parseada + tokens', async () => {
    generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          tldr: 'Dia tranquilo, 12 vendas.',
          alertas: [{ titulo: 'CPA criativo X', severidade: 'media', metrica: 'CPA', descricao: 'subiu 30%' }],
          oportunidades: [],
          recomendacoes: [],
        }),
        usageMetadata: { promptTokenCount: 1234, candidatesTokenCount: 567 },
      },
    })

    const r = await generateInsight({ data: '2026-05-11', contexto: { foo: 1 } })

    expect(r.tldr).toBe('Dia tranquilo, 12 vendas.')
    expect(r.alertas).toHaveLength(1)
    expect(r.tokens_input).toBe(1234)
    expect(r.tokens_output).toBe(567)
    expect(r.modelo).toBe('gemini-2.5-flash')
    expect(r.prompt_version).toMatch(/^v\d+$/)
  })

  test('respeita GEMINI_MODEL override', async () => {
    process.env.GEMINI_MODEL = 'gemini-2.5-pro'
    generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({ tldr: '', alertas: [], oportunidades: [], recomendacoes: [] }),
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
      },
    })
    const r = await generateInsight({ data: '2026-05-11', contexto: {} })
    expect(r.modelo).toBe('gemini-2.5-pro')
  })

  test('lança se GEMINI_API_KEY ausente', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(generateInsight({ data: '2026-05-11', contexto: {} })).rejects.toThrow(/GEMINI_API_KEY/)
  })
})
