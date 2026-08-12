import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/insightsRunner', () => ({
  runInsightGeneration: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/workspace-context', () => ({
  getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-demo'),
}))

const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }))
vi.mock('@supabase/supabase-js', () => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle,
  }
  return { createClient: () => ({ from: () => chain }) }
})

import { POST } from './route'
import { runInsightGeneration } from '@/lib/insightsRunner'
import { brazilDateStr } from '@/lib/brazilDate'

const runMock = vi.mocked(runInsightGeneration)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPABASE_URL = 'http://sb'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv'
  maybeSingle.mockResolvedValue({ data: null, error: null })
})

describe('POST /api/ai/regenerate', () => {
  test('200 chama runInsightGeneration com gerado_por=manual usando ontem como default', async () => {
    runMock.mockResolvedValue({ ok: true, tokens_input: 100, tokens_output: 50 })
    const req = new Request('http://x/api/ai/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(runMock).toHaveBeenCalledWith(brazilDateStr(1), brazilDateStr(1), 'manual', 'ws-demo')
  })

  test('200 usa data do body quando fornecida', async () => {
    runMock.mockResolvedValue({ ok: true, tokens_input: 1, tokens_output: 1 })
    const req = new Request('http://x/api/ai/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: '2026-05-09' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(runMock).toHaveBeenCalledWith('2026-05-09', '2026-05-09', 'manual', 'ws-demo')
  })

  test('200 usa from/to do body quando fornecidos', async () => {
    runMock.mockResolvedValue({ ok: true, tokens_input: 1, tokens_output: 1 })
    const req = new Request('http://x/api/ai/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '2026-05-05', to: '2026-05-11' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(runMock).toHaveBeenCalledWith('2026-05-05', '2026-05-11', 'manual', 'ws-demo')
  })

  test('400 quando to < from', async () => {
    const req = new Request('http://x/api/ai/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '2026-05-11', to: '2026-05-05' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  test('400 quando range > 30 dias', async () => {
    const req = new Request('http://x/api/ai/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '2026-01-01', to: '2026-02-10' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  test('429 quando ja houve regeneracao manual < 5 min atras', async () => {
    const recent = new Date(Date.now() - 60 * 1000).toISOString()
    maybeSingle.mockResolvedValue({ data: { gerado_at: recent }, error: null })
    const req = new Request('http://x/api/ai/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(429)
    expect(runMock).not.toHaveBeenCalled()
  })

  test('500 quando runInsightGeneration falha', async () => {
    runMock.mockResolvedValue({
      ok: false,
      tokens_input: null,
      tokens_output: null,
      error: 'gemini timeout',
    })
    const req = new Request('http://x/api/ai/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
  })
})
