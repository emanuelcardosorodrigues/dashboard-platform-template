import { describe, test, expect, vi, beforeEach } from 'vitest'

// Mocks compartilhados (hoisted p/ o factory do vi.mock enxergar).
const { fromMock, selectMock, updateMock, updateEqMock, maybeSingleMock, checkRateLimitMock } =
  vi.hoisted(() => {
    const maybeSingleMock = vi.fn()
    // select().eq().eq().eq().maybeSingle() — eq é chainable.
    const selectChain: { eq: ReturnType<typeof vi.fn>; maybeSingle: typeof maybeSingleMock } = {
      eq: vi.fn(() => selectChain),
      maybeSingle: maybeSingleMock,
    }
    const selectMock = vi.fn(() => selectChain)
    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn(() => ({ eq: updateEqMock }))
    const fromMock = vi.fn(() => ({ select: selectMock, update: updateMock }))
    const checkRateLimitMock = vi.fn()
    return { fromMock, selectMock, updateMock, updateEqMock, maybeSingleMock, checkRateLimitMock }
  })

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ from: fromMock })) }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: checkRateLimitMock }))

import { POST } from './route'

const WS = 'faafca5a-fb53-404f-8469-499d8869944c' // 36 chars, formato aceito pelo guard
const SLUG = 'bio-link'

function post(body: unknown) {
  return POST(
    new Request('http://x/api/webhook/link-hit', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof POST>[0],
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPABASE_URL = 'http://sb'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 299, resetAt: null })
  maybeSingleMock.mockResolvedValue({ data: { id: 'l1', clicks: 5 } })
})

describe('POST /api/webhook/link-hit', () => {
  test('teto estourado → NÃO incrementa e responde 200 silencioso', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: null })
    const res = await post({ ws: WS, slug: SLUG })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    // dedup do dano: sem update quando limitado
    expect(updateMock).not.toHaveBeenCalled()
    // key por (ws, slug) — não por IP (que aqui é o edge da CF)
    expect(checkRateLimitMock).toHaveBeenCalledWith(`link-hit:${WS}:${SLUG}`, expect.any(Number), 60)
  })

  test('permitido + link existe → incrementa clicks+1', async () => {
    const res = await post({ ws: WS, slug: SLUG })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith({ clicks: 6 })
    expect(updateEqMock).toHaveBeenCalledWith('id', 'l1')
  })

  test('ws inválido → 200 sem tocar rate-limit nem banco (guard preservado)', async () => {
    const res = await post({ ws: 'nao-e-uuid', slug: SLUG })
    expect(res.status).toBe(200)
    expect(checkRateLimitMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  test('slug ausente → 200 sem tocar rate-limit nem banco', async () => {
    const res = await post({ ws: WS, slug: '' })
    expect(res.status).toBe(200)
    expect(checkRateLimitMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })
})
