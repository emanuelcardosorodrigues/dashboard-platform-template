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

vi.mock('@/lib/integrations/credentials', () => ({
  listWorkspacesWithProvider: vi.fn().mockResolvedValue([]),
}))

import { GET } from './route'
import { runInsightGeneration } from '@/lib/insightsRunner'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'

const runMock = vi.mocked(runInsightGeneration)
const wsMock = vi.mocked(listWorkspacesWithProvider)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'segredo'
})

describe('GET /api/cron/generate-ai-insights', () => {
  test('401 sem auth', async () => {
    const req = new Request('http://x/api/cron/generate-ai-insights')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  test('200 com Bearer + chama runInsightGeneration com gerado_por=cron por workspace', async () => {
    runMock.mockResolvedValue({ ok: true, tokens_input: 1234, tokens_output: 567 })
    const req = new Request('http://x/api/cron/generate-ai-insights', {
      headers: { authorization: 'Bearer segredo' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    // dispatcher: passa o workspaceId (DEMO default, pois listWorkspacesWithProvider=[])
    expect(runMock).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'cron', 'ws-demo')
    // from === to (mesmo dia)
    expect(runMock.mock.calls[0][0]).toBe(runMock.mock.calls[0][1])
  })

  test('falha PARCIAL (1 de 2 workspaces) → 200 degraded, erro registrado por projeto', async () => {
    // 2 workspaces: ws-demo (default) ok, ws-thm falha. Um erro não derruba o cron
    // inteiro (não re-tenta o que deu certo), mas o desfecho fica visível.
    wsMock.mockResolvedValue(['ws-thm'])
    runMock
      .mockResolvedValueOnce({ ok: true, tokens_input: 10, tokens_output: 20 }) // ws-demo
      .mockResolvedValueOnce({ ok: false, tokens_input: null, tokens_output: null, error: 'boom' }) // ws-thm
    const req = new Request('http://x/api/cron/generate-ai-insights', {
      headers: { authorization: 'Bearer segredo' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; degraded: boolean; workspaces: Record<string, { ok: boolean; error?: string }> }
    expect(body.ok).toBe(true)
    expect(body.degraded).toBe(true)
    expect(body.workspaces['ws-thm'].ok).toBe(false)
    expect(body.workspaces['ws-thm'].error).toBe('boom')
  })

  test('falha TOTAL (todos os workspaces) → 500 pro monitor enxergar o pipeline morto', async () => {
    runMock.mockResolvedValue({ ok: false, tokens_input: null, tokens_output: null, error: 'boom' })
    const req = new Request('http://x/api/cron/generate-ai-insights', {
      headers: { authorization: 'Bearer segredo' },
    })
    const res = await GET(req)
    expect(res.status).toBe(500)
    const body = await res.json() as { ok: boolean; workspaces: Record<string, { ok: boolean; error?: string }> }
    expect(body.ok).toBe(false)
    expect(body.workspaces['ws-demo'].ok).toBe(false)
    expect(body.workspaces['ws-demo'].error).toBe('boom')
  })
})
