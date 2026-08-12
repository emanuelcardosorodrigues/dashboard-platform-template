import { describe, test, expect, vi, beforeEach } from 'vitest'

// Encadeamento: client.from(table).select('*').eq(...).gte(...).lte(...) → await → {data, error}.
// chain é thenable (awaitable em qualquer ponto) e todo método retorna chain, então
// funciona em qualquer ordem de filtros (.eq pode vir no meio agora — multi-tenant).
function makeChain(rows: unknown[]) {
  const result = { data: rows, error: null }
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    like: vi.fn(() => chain),
    insert: vi.fn(() => Promise.resolve({ error: null })),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve(result),
  }
  return chain
}

const fromMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: fromMock }),
}))
vi.mock('@/lib/gemini', () => ({
  generateInsight: vi.fn().mockResolvedValue({
    modelo: 'gemini-2.5-flash',
    prompt_version: 'v1',
    tldr: 'Dia normal.',
    alertas: [], oportunidades: [], recomendacoes: [],
    tokens_input: 1200, tokens_output: 400,
  }),
  generateInsightV2: vi.fn().mockResolvedValue({
    modelo: 'gemini-2.5-flash',
    prompt_version: 'v2',
    tldr: 'Período analisado.',
    alertas: [], oportunidades: [], recomendacoes: [],
    tokens_input: 5000, tokens_output: 1500,
  }),
}))

import { runInsightGeneration } from './insightsRunner'
import { generateInsight, generateInsightV2 } from './gemini'

beforeEach(() => {
  vi.clearAllMocks()
  fromMock.mockImplementation(() => makeChain([]))
  process.env.SUPABASE_URL = 'http://x'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  process.env.GEMINI_API_KEY = 'g'
})

describe('runInsightGeneration', () => {
  test('from===to usa gerateInsight (v1) e insere com periodo=daily', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    fromMock.mockImplementation((table: string) => {
      if (table === 'ai_insights') {
        return { ...makeChain([]), insert: insertSpy }
      }
      return makeChain([])
    })

    const r = await runInsightGeneration('2026-05-11', '2026-05-11', 'cron', 'ws-test')

    expect(generateInsight).toHaveBeenCalledOnce()
    expect(generateInsightV2).not.toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledOnce()
    const inserted = insertSpy.mock.calls[0][0]
    expect(inserted.workspace_id).toBe('ws-test')
    expect(inserted.data).toBe('2026-05-11')
    expect(inserted.periodo).toBe('daily')
    expect(inserted.periodo_from).toBe('2026-05-11')
    expect(inserted.periodo_to).toBe('2026-05-11')
    expect(inserted.gerado_por).toBe('cron')
    expect(inserted.modelo).toBe('gemini-2.5-flash')
    expect(r.ok).toBe(true)
    expect(r.tokens_input).toBe(1200)
  })

  test('from !== to usa generateInsightV2 e periodo=custom', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    fromMock.mockImplementation((table: string) => {
      if (table === 'ai_insights') return { ...makeChain([]), insert: insertSpy }
      return makeChain([])
    })

    await runInsightGeneration('2026-05-05', '2026-05-11', 'manual', 'ws-test')

    expect(generateInsightV2).toHaveBeenCalledOnce()
    expect(generateInsight).not.toHaveBeenCalled()
    const inserted = insertSpy.mock.calls[0][0]
    expect(inserted.periodo).toBe('custom')
    expect(inserted.periodo_from).toBe('2026-05-05')
    expect(inserted.periodo_to).toBe('2026-05-11')
    expect(inserted.gerado_por).toBe('manual')
  })

  test('faz fallback de insert quando colunas periodo_from/to não existem (42703)', async () => {
    const insertSpy = vi.fn()
      .mockResolvedValueOnce({ error: { code: '42703', message: 'column does not exist' } })
      .mockResolvedValueOnce({ error: null })
    fromMock.mockImplementation((table: string) => {
      if (table === 'ai_insights') return { ...makeChain([]), insert: insertSpy }
      return makeChain([])
    })

    const r = await runInsightGeneration('2026-05-11', '2026-05-11', 'cron', 'ws-test')

    expect(insertSpy).toHaveBeenCalledTimes(2)
    expect(r.ok).toBe(true)
  })
})
