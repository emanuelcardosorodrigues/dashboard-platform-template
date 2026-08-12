import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/index.js'

// Experimento de página seedado direto no KV (camada 1) — getExperimentByType
// devolve antes de tocar o Supabase.
const EXPERIMENT = {
  id: 'exp-col-1',
  name: 'COL page test',
  entry_path: '/col',
  type: 'page',
  status: 'active',
  variants: [
    { name: 'A', slug: 'col-pv01', url: 'https://example.com/col-pv01/', weight: 0.5 },
    { name: 'B', slug: 'col-pv02', url: 'https://example.com/col-pv02/', weight: 0.5 },
  ],
}

function makeKV() {
  const store = new Map()
  store.set('experiment:page:/col', JSON.stringify(EXPERIMENT))
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null },
    async put(k, v) { store.set(k, v) },
  }
}

function makeEnv(mode, kv) {
  return { IMPRESSION_MODE: mode, AB_KV: kv, SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'fake-key' }
}

function makeRequest({ url, ua = 'Mozilla/5.0 (iPhone) AppleWebKit/605 Chrome/120 Mobile Safari', cookie = 'uid=user-abc', ip = '9.9.9.9', cf = {} } = {}) {
  return {
    url,
    cf,
    headers: {
      get(name) {
        const n = name.toLowerCase()
        if (n === 'user-agent') return ua
        if (n === 'cookie') return cookie
        if (n === 'cf-connecting-ip') return ip
        if (n === 'accept-language') return 'pt-BR'
        return null
      },
    },
  }
}

function makeCtx() {
  const pending = []
  return { waitUntil(p) { pending.push(p) }, async drain() { await Promise.all(pending) } }
}

// Stub do fetch global pra capturar os POSTs de impressão (logImpression → Supabase).
async function withFetchCapture(fn) {
  const calls = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return new Response('{}', { status: 200 }) }
  try { return await fn(calls) } finally { globalThis.fetch = orig }
}

const impressionPosts = (calls) => calls.filter(c => c.url.includes('/rest/v1/impressions'))
const BEACON_URL = 'https://example.com/r/i?p=col'

test('beacon é no-op em IMPRESSION_MODE=redirect (não loga, devolve 204)', async () => {
  await withFetchCapture(async (calls) => {
    const ctx = makeCtx()
    const res = await worker.fetch(makeRequest({ url: BEACON_URL }), makeEnv('redirect', makeKV()), ctx)
    await ctx.drain()
    assert.equal(res.status, 204)
    assert.equal(impressionPosts(calls).length, 0, 'modo redirect não pode logar via beacon')
  })
})

test('beacon loga exatamente uma impressão em IMPRESSION_MODE=beacon', async () => {
  await withFetchCapture(async (calls) => {
    const ctx = makeCtx()
    const res = await worker.fetch(makeRequest({ url: BEACON_URL, cookie: 'uid=viewer-1' }), makeEnv('beacon', makeKV()), ctx)
    await ctx.drain()
    assert.equal(res.status, 204)
    const posts = impressionPosts(calls)
    assert.equal(posts.length, 1, 'deve logar exatamente uma impressão')
    const body = JSON.parse(posts[0].opts.body)
    assert.equal(body.experiment_id, 'exp-col-1')
    assert.ok(['A', 'B'].includes(body.variant), 'variante recomputada pelo uid deve ser A ou B')
  })
})

test('beacon dedup: segundo hit do mesmo uid não loga de novo', async () => {
  await withFetchCapture(async (calls) => {
    const env = makeEnv('beacon', makeKV())
    const req = makeRequest({ url: BEACON_URL, cookie: 'uid=viewer-dedup' })
    const c1 = makeCtx(); await worker.fetch(req, env, c1); await c1.drain()
    const c2 = makeCtx(); await worker.fetch(req, env, c2); await c2.drain()
    assert.equal(impressionPosts(calls).length, 1, 'dedup por uid×experimento deve impedir o segundo log')
  })
})

test('beacon ignora bot (UA Googlebot) mesmo em modo beacon', async () => {
  await withFetchCapture(async (calls) => {
    const ctx = makeCtx()
    const res = await worker.fetch(makeRequest({ url: BEACON_URL, ua: 'Googlebot/2.1' }), makeEnv('beacon', makeKV()), ctx)
    await ctx.drain()
    assert.equal(res.status, 204)
    assert.equal(impressionPosts(calls).length, 0, 'bot não pode logar impressão')
  })
})

test('beacon ignora path inválido (sem ?p=)', async () => {
  await withFetchCapture(async (calls) => {
    const ctx = makeCtx()
    const res = await worker.fetch(makeRequest({ url: 'https://example.com/r/i' }), makeEnv('beacon', makeKV()), ctx)
    await ctx.drain()
    assert.equal(res.status, 204)
    assert.equal(impressionPosts(calls).length, 0)
  })
})
