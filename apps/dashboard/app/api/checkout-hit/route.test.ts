import { describe, test, expect, vi, beforeEach } from 'vitest'

// Captura os argumentos do upsert pra assertar o que REALMENTE vai pro banco.
const { calls } = vi.hoisted(() => ({ calls: [] as { row: Record<string, unknown>; opts: Record<string, unknown> }[] }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      // resolveWorkspaceId: .select().contains().limit().maybeSingle() e .select().eq().maybeSingle()
      select: () => ({
        contains: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'ws-1' } }) }) }),
        eq: () => ({ maybeSingle: async () => ({ data: { id: 'ws-1' } }) }),
      }),
      upsert: async (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        calls.push({ row, opts })
        return { error: null }
      },
    }),
  }),
}))

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }))

import { POST } from './route'

function req(body: unknown) {
  return new Request('http://x/api/checkout-hit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.com' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]
}

const UID = '11111111-2222-3333-4444-555555555555'
const URL_LPS = 'https://example.com/lps-pv01/'

beforeEach(() => {
  calls.length = 0
  process.env.SUPABASE_URL = 'http://sb'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
})

describe('POST /api/checkout-hit — ingestão do uid (passagem exata)', () => {
  test('uid válido é gravado e o slug sai da url', async () => {
    const res = await POST(req({ url: URL_LPS, cid: 'c1', uid: UID }))
    expect(res.status).toBe(204)
    expect(calls[0].row).toMatchObject({ slug: 'lps-pv01', cid: 'c1', uid: UID })
  })

  // A sutileza que o smoke pegou: com uid precisa ser MERGE, senão uma linha criada
  // antes (sem uid) trava aquele (cid, dia) cego pra sempre e a passagem cai no ~GA à toa.
  test('COM uid → merge (ignoreDuplicates=false), pra preencher linha que já existia sem uid', async () => {
    await POST(req({ url: URL_LPS, cid: 'c1', uid: UID }))
    expect(calls[0].opts.ignoreDuplicates).toBe(false)
  })

  test('SEM uid → ignora duplicata, pra NUNCA apagar com NULL um uid já gravado', async () => {
    await POST(req({ url: URL_LPS, cid: 'c1' }))
    expect(calls[0].opts.ignoreDuplicates).toBe(true)
    expect(calls[0].row).not.toHaveProperty('uid')
  })

  test('uid inválido (lixo/injeção) é descartado, não grava sujeira', async () => {
    await POST(req({ url: URL_LPS, cid: 'c1', uid: "'; drop table--" }))
    expect(calls[0].row).not.toHaveProperty('uid')
    expect(calls[0].opts.ignoreDuplicates).toBe(true)
  })

  test('uid curto demais é descartado (não é cookie do Worker)', async () => {
    await POST(req({ url: URL_LPS, cid: 'c1', uid: 'abc' }))
    expect(calls[0].row).not.toHaveProperty('uid')
  })

  test('sem cid, ainda grava (fingerprint) e mantém o uid', async () => {
    await POST(req({ url: URL_LPS, uid: UID }))
    expect(calls[0].row.uid).toBe(UID)
    expect(String(calls[0].row.cid)).toMatch(/^fp_/)
  })

  test('slug inválido não vira linha', async () => {
    const res = await POST(req({ url: 'https://example.com/', cid: 'c1', uid: UID }))
    expect(res.status).toBe(204)
    expect(calls).toHaveLength(0)
  })
})
