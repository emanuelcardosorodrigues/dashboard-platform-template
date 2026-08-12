import { describe, test, expect, vi, beforeEach } from 'vitest'

// Resultado por tabela, ajustável por teste.
const { results } = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown; error: unknown }>,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => results[t] ?? { data: null, error: null },
          }),
        }),
      }),
    }),
  }),
}))

import { GET } from './route'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const hojeBR = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

function req(headers: Record<string, string> = {}) {
  return new Request('http://x/api/cron/health-freshness', { headers }) as unknown as Parameters<typeof GET>[0]
}
const bearer = { authorization: 'Bearer segredo' }

/** Estado "tudo fresco" — cada teste sobrescreve o que precisa. */
function setFresh() {
  results['vturb_creative_daily'] = { data: { synced_at: hoursAgo(1) }, error: null }
  results['organic_posts'] = { data: { updated_at: hoursAgo(1) }, error: null }
  results['meta_ads'] = { data: { data: hojeBR }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPABASE_URL = 'http://sb'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  process.env.CRON_SECRET = 'segredo'
  setFresh()
})

describe('GET /api/cron/health-freshness', () => {
  test('401 sem auth', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  test('200 ok quando os 3 syncs estão frescos', async () => {
    const res = await GET(req(bearer))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; stale: string[] }
    expect(body.ok).toBe(true)
    expect(body.stale).toEqual([])
  })

  test('503 quando o vTurb passou do SLA (synced_at velho)', async () => {
    results['vturb_creative_daily'] = { data: { synced_at: hoursAgo(40) }, error: null }
    const res = await GET(req(bearer))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { ok: boolean; stale: string[] }
    expect(body.ok).toBe(false)
    expect(body.stale).toContain('vturb_creative_daily')
  })

  test('503 quando o Meta está atrasado (última data > 1 dia atrás)', async () => {
    results['meta_ads'] = { data: { data: '2020-01-01' }, error: null }
    const res = await GET(req(bearer))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { stale: string[] }
    expect(body.stale).toContain('meta_ads')
  })

  test('503 quando uma query falha (erro = trata como velho, fail-safe)', async () => {
    results['organic_posts'] = { data: null, error: { message: 'boom' } }
    const res = await GET(req(bearer))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { stale: string[] }
    expect(body.stale).toContain('organic_posts')
  })
})
