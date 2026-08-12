import { describe, test, expect, vi, beforeEach } from 'vitest'

const upsert = vi.fn().mockResolvedValue({ error: null })
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ upsert }) }),
}))
vi.mock('@/lib/clarity', () => ({
  fetchClarityMetrics: vi.fn().mockResolvedValue([
    { metricName: 'Sessions', information: [{ totalSessionCount: '500' }] },
  ]),
  normalizeClarityRows: vi.fn().mockReturnValue([
    { data: '2026-05-11', recorte: 'total', dimensao_valor: '*', sessions: 500 },
  ]),
}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/workspace-context', () => ({ getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-demo') }))
vi.mock('@/lib/integrations/factory', () => ({ getClarityConfig: vi.fn().mockResolvedValue({ apiToken: 'tok' }) }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'segredo'
  process.env.CLARITY_API_TOKEN = 'tok'
  process.env.SUPABASE_URL = 'http://x'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
})

describe('GET /api/cron/sync-clarity', () => {
  test('401 sem auth', async () => {
    const req = new Request('http://x/api/cron/sync-clarity')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  test('200 com Bearer correto + upsert 4 recortes', async () => {
    const req = new Request('http://x/api/cron/sync-clarity', {
      headers: { authorization: 'Bearer segredo' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(4) // total + url + device + source
  })

  test('200 com x-vercel-cron header', async () => {
    const req = new Request('http://x/api/cron/sync-clarity', {
      headers: { 'x-vercel-cron': '1' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})
