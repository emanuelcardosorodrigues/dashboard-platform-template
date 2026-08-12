import { describe, test, expect, vi, beforeEach } from 'vitest'

// Cada tabela tem dois payloads: `single` (pra .maybeSingle()) e `list` (pro await direto).
const { tbl } = vi.hoisted(() => ({
  tbl: {} as Record<string, { single?: { data: unknown; error: unknown }; list?: { data: unknown; error: unknown } }>,
}))

// Builder chainable E thenable: métodos encadeiam (retornam this); `.maybeSingle()`
// resolve o `single`; `await builder` (via then) resolve o `list`.
vi.mock('@supabase/supabase-js', () => {
  const make = (t: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'limit']) b[m] = () => b
    b.maybeSingle = async () => tbl[t]?.single ?? { data: null, error: null }
    b.then = (resolve: (v: unknown) => unknown) => resolve(tbl[t]?.list ?? { data: [], error: null })
    return b
  }
  return { createClient: () => ({ from: (t: string) => make(t) }) }
})

import { GET } from './route'

const dayAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const ontem = dayAgo(1)

function req(headers: Record<string, string> = {}) {
  return new Request('http://x/api/cron/connect-rate-health', { headers }) as unknown as Parameters<typeof GET>[0]
}
const bearer = { authorization: 'Bearer segredo' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPABASE_URL = 'http://sb'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  process.env.CRON_SECRET = 'segredo'
  tbl.route_clicks = { single: { data: { dia: dayAgo(3) }, error: null }, list: { data: [], error: null } }
  tbl.experiments = { list: { data: [{ id: 'e1', name: 'LPS' }], error: null } }
  tbl.impressions = { list: { data: [], error: null } }
})

describe('GET /api/cron/connect-rate-health', () => {
  test('401 sem auth', async () => {
    expect((await GET(req())).status).toBe(401)
  })

  test('200 aquecendo quando route_clicks ainda não cobre ontem', async () => {
    tbl.route_clicks!.single = { data: { dia: dayAgo(0) }, error: null } // começou hoje
    const res = await GET(req(bearer))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; aquecendo: boolean }
    expect(body.ok).toBe(true)
    expect(body.aquecendo).toBe(true)
  })

  test('200 ok quando os streams reconciliam', async () => {
    // 40 roteados, 38 viram (rate 95%) → saudável
    const uids = Array.from({ length: 40 }, (_, i) => ({ experiment_id: 'e1', uid: `u${i}` }))
    tbl.route_clicks!.list = { data: uids, error: null }
    tbl.impressions!.list = { data: uids.slice(0, 38), error: null }
    const res = await GET(req(bearer))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
  })

  test('503 roteamento-parado: views sem nenhum clique roteado', async () => {
    tbl.route_clicks!.list = { data: [], error: null } // 0 cliques
    tbl.impressions!.list = { data: Array.from({ length: 30 }, (_, i) => ({ experiment_id: 'e1', uid: `u${i}` })), error: null }
    const res = await GET(req(bearer))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { ok: boolean; issues: { kind: string }[] }
    expect(body.ok).toBe(false)
    expect(body.issues[0].kind).toBe('roteamento-parado')
  })

  test('503 fail-safe quando uma query falha', async () => {
    tbl.experiments = { list: { data: null, error: { message: 'boom' } } }
    const res = await GET(req(bearer))
    expect(res.status).toBe(503)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false)
  })
})
