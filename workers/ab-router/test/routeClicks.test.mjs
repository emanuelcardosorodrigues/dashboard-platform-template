import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/index.js'

// Experimento de página seedado no KV (camada 1) — getExperimentByType devolve
// antes de tocar o Supabase. Sem checkout/ob pra isolar o log de clique da página.
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

async function withFetchCapture(fn) {
  const calls = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return new Response('{}', { status: 200 }) }
  try { return await fn(calls) } finally { globalThis.fetch = orig }
}

const impressionPosts = (calls) => calls.filter(c => c.url.includes('/rest/v1/impressions'))
const routeClickPosts = (calls) => calls.filter(c => c.url.includes('/rest/v1/route_clicks'))
const PAGE_URL = 'https://example.com/r/col'

test('página (302) em beacon: loga route_click e NÃO loga impression', async () => {
  await withFetchCapture(async (calls) => {
    const ctx = makeCtx()
    const res = await worker.fetch(makeRequest({ url: PAGE_URL, cookie: 'uid=clk-1' }), makeEnv('beacon', makeKV()), ctx)
    await ctx.drain()
    assert.equal(res.status, 302)
    assert.equal(routeClickPosts(calls).length, 1, 'o clique roteado deve ser logado sempre')
    assert.equal(impressionPosts(calls).length, 0, 'em beacon a impressão é do beacon, não do 302')
    const body = JSON.parse(routeClickPosts(calls)[0].opts.body)
    assert.equal(body.experiment_id, 'exp-col-1')
    assert.ok(['A', 'B'].includes(body.variant))
    assert.equal(body.uid, 'clk-1')
  })
})

test('página (302) em redirect: loga route_click E impression (mesma identidade)', async () => {
  await withFetchCapture(async (calls) => {
    const ctx = makeCtx()
    const res = await worker.fetch(makeRequest({ url: PAGE_URL, cookie: 'uid=clk-2' }), makeEnv('redirect', makeKV()), ctx)
    await ctx.drain()
    assert.equal(res.status, 302)
    assert.equal(routeClickPosts(calls).length, 1)
    assert.equal(impressionPosts(calls).length, 1, 'em redirect a impressão ainda é o 302 (legado)')
    const clk = JSON.parse(routeClickPosts(calls)[0].opts.body)
    const imp = JSON.parse(impressionPosts(calls)[0].opts.body)
    assert.equal(clk.uid, imp.uid, 'click e view do 302 são a mesma identidade')
    assert.equal(clk.variant, imp.variant, 'mesma variante nos dois lados')
  })
})

test('route_click usa upsert ignore-duplicates (dedup por uid/variante/dia no DB)', async () => {
  await withFetchCapture(async (calls) => {
    const ctx = makeCtx()
    await worker.fetch(makeRequest({ url: PAGE_URL, cookie: 'uid=clk-3' }), makeEnv('beacon', makeKV()), ctx)
    await ctx.drain()
    const post = routeClickPosts(calls)[0]
    assert.match(post.url, /on_conflict=workspace_id,experiment_id,variant,uid,dia/)
    assert.match(post.opts.headers['Prefer'], /resolution=ignore-duplicates/)
  })
})

test('bot (Googlebot) não loga clique nem impressão', async () => {
  await withFetchCapture(async (calls) => {
    const ctx = makeCtx()
    await worker.fetch(makeRequest({ url: PAGE_URL, ua: 'Googlebot/2.1' }), makeEnv('beacon', makeKV()), ctx)
    await ctx.drain()
    assert.equal(routeClickPosts(calls).length, 0, 'bot não pode inflar o denominador do connect rate')
    assert.equal(impressionPosts(calls).length, 0)
  })
})
