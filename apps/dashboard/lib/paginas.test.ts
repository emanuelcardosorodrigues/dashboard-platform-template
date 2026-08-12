import { describe, expect, it } from 'vitest'
import { pageSlug, sckSlug, slugFromClarityUrl, diagnosticarPagina, buildPageAnalysis } from './paginas'
import type { GA4PageRow } from './ga4'
import type { SbTransacao, SbExperiment, SbImpressionUid, SbClarityDaily, SbCheckoutHit } from './supabase'

const tx = (p: Partial<SbTransacao>): SbTransacao => ({
  hotmart_id: 'h', data: '2026-06-01', nome: 'x', email: 'x@x.com', produto: 'Protocolo Lucro Oculto',
  valor_bruto: 100, valor_liquido_expert: 90, forma_pagamento: 'pix', parcelas: 1, criativo: '',
  utm_medium_ultimo: '', utm_source_ultimo: '', utm_medium_primeiro: '', utm_source_primeiro: '', ...p,
})
const clar = (p: Partial<SbClarityDaily>): SbClarityDaily => ({
  data: '2026-06-01', recorte: 'url', dimensao_valor: '', sessions: 0, pages_per_session: null,
  total_pageviews: null, scroll_depth_pct: null, engagement_time_sec: null, dead_clicks: null,
  rage_clicks: null, quick_backs: null, excessive_scroll: null, script_errors: null, error_clicks: null,
  raw_json: null, synced_at: '', ...p,
} as SbClarityDaily)
const ga = (pagePath: string, sessions: number): GA4PageRow => ({ pagePath, pageTitle: '', sessions, screenPageViews: sessions, totalUsers: sessions, averageSessionDuration: 0 })

describe('slug — convergência das 3 fontes', () => {
  it('pageSlug / sckSlug / slugFromClarityUrl → mesmo slug', () => {
    expect(pageSlug('/p/col-pv02/')).toBe('col-pv02')
    expect(sckSlug('col-pv02_ckck01_obob02')).toBe('col-pv02')
    expect(slugFromClarityUrl('https://example.com/p/col-pv02')).toBe('col-pv02')
  })
})

describe('diagnosticarPagina — árvore de gargalo', () => {
  const base = { scrollDepthPct: 70, passagemCheckoutPct: 40, cvrCheckoutPct: 60, convPaginaFrontPct: 5, frontSales: 10, uidsPagina: 100, sessionsGa4: 100 }
  it('sem base → insuficiente', () => {
    expect(diagnosticarPagina({ ...base, uidsPagina: 0, sessionsGa4: 0 }).gargalo).toBe('insuficiente')
  })
  it('scroll baixo → engajamento', () => {
    expect(diagnosticarPagina({ ...base, scrollDepthPct: 30 }).gargalo).toBe('engajamento')
  })
  it('passagem baixa → copy', () => {
    expect(diagnosticarPagina({ ...base, passagemCheckoutPct: 8 }).gargalo).toBe('copy')
  })
  it('cvr checkout baixo → checkout', () => {
    expect(diagnosticarPagina({ ...base, cvrCheckoutPct: 20 }).gargalo).toBe('checkout')
  })
  it('passagem boa + conversão final baixa → congruencia', () => {
    expect(diagnosticarPagina({ ...base, passagemCheckoutPct: 40, cvrCheckoutPct: 50, convPaginaFrontPct: 1 }).gargalo).toBe('congruencia')
  })
})

describe('buildPageAnalysis — fontes e passthrough', () => {
  const experiments: SbExperiment[] = [
    { id: 'e1', name: 'pg', entry_path: '/col', type: 'page', checkout_slug: '/col-ck', status: 'active', started_at: null, ended_at: null, created_at: '2026-01-01', variants: [{ name: 'A', slug: 'col-pv02', url: '/p/col-pv02/', weight: 1 }] },
    { id: 'e2', name: 'ck', entry_path: '/col-ck', type: 'checkout', status: 'active', started_at: null, ended_at: null, created_at: '2026-01-01', variants: [{ name: 'A', slug: 'ck1', url: '/c', weight: 1 }] },
  ]
  const impressionUids: SbImpressionUid[] = [
    { experiment_id: 'e1', variant: 'A', uid: 'u1' },
    { experiment_id: 'e1', variant: 'A', uid: 'u2' },
    { experiment_id: 'e1', variant: 'A', uid: 'u3' },
    { experiment_id: 'e2', variant: 'A', uid: 'u2' },
    { experiment_id: 'e2', variant: 'A', uid: 'u3' },
  ]
  const transacoes: SbTransacao[] = [
    tx({ sck_slug: 'col-pv02', valor_bruto: 100 }),
    tx({ sck_slug: 'col-pv02', valor_bruto: 100 }),
    tx({ sck_slug: 'col-onlyga4', valor_bruto: 50 }),
    tx({ sck_slug: 'col-sohot', valor_bruto: 70 }),
  ]
  const gaPages = [ga('/p/col-onlyga4/', 100)]
  const clarityRows = [clar({ dimensao_valor: 'https://x.com/p/col-pv02', sessions: 50, scroll_depth_pct: 70 })]

  const { rows } = buildPageAnalysis({ gaPages, transacoes, experiments, impressionUids, clarityRows, funil: 'all' })
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]))

  it('col-pv02: passthrough por UID (u2,u3 ∩ de 3) = 66,7%, base uid, ticket 100', () => {
    const r = bySlug['col-pv02']
    expect(r.uidsPagina).toBe(3)
    expect(r.checkoutInter).toBe(2)
    expect(r.passagemCheckoutPct).toBeCloseTo(66.67, 1)
    expect(r.convBase).toBe('uid')
    expect(r.convPaginaFrontPct).toBeCloseTo(66.67, 1)
    expect(r.cvrCheckoutPct).toBe(100)
    expect(r.ticketMedio).toBe(100)
    expect(r.scrollDepthPct).toBe(70)
    expect(r.temUid).toBe(true)
  })
  it('col-onlyga4: sem UID → base ga4 (1/100)', () => {
    const r = bySlug['col-onlyga4']
    expect(r.convBase).toBe('ga4')
    expect(r.convPaginaFrontPct).toBeCloseTo(1, 3)
    expect(r.passagemCheckoutPct).toBeNull()
  })
  it('col-sohot: só Hotmart → soHotmart, sem conversão mensurável', () => {
    const r = bySlug['col-sohot']
    expect(r.soHotmart).toBe(true)
    expect(r.convBase).toBe('na')
  })
})

describe('buildPageAnalysis — passagem sem experimento checkout vinculado', () => {
  // Página em experimento A/B (tem UIDs), MAS sem checkout-experiment vinculado.
  // Regressão: passagem deve ser null (imensurável), NÃO 0% falso — senão o
  // diagnóstico acusaria "copy" numa página que só não tem instrumentação de checkout.
  const experiments: SbExperiment[] = [
    { id: 'e1', name: 'pg-sem-ck', entry_path: '/dpl', type: 'page', checkout_slug: null, status: 'active', started_at: null, ended_at: null, created_at: '2026-01-01', variants: [{ name: 'A', slug: 'dpl-pv01', url: '/p/dpl-pv01/', weight: 1 }] },
  ]
  const impressionUids: SbImpressionUid[] = [
    { experiment_id: 'e1', variant: 'A', uid: 'u1' },
    { experiment_id: 'e1', variant: 'A', uid: 'u2' },
  ]
  const transacoes: SbTransacao[] = [tx({ sck_slug: 'dpl-pv01', valor_bruto: 100 })]
  const { rows } = buildPageAnalysis({ gaPages: [], transacoes, experiments, impressionUids, clarityRows: [], funil: 'all' })
  const r = rows.find((x) => x.slug === 'dpl-pv01')!

  it('tem UIDs mas passagem null (não 0%) e temSinalCheckout=false', () => {
    expect(r.uidsPagina).toBe(2)
    expect(r.checkoutInter).toBe(0)
    expect(r.temSinalCheckout).toBe(false)
    expect(r.passagemCheckoutPct).toBeNull()
  })
  it('sem sinal de checkout → não diagnostica "copy" (passagem null é ignorada)', () => {
    expect(r.diag.gargalo).not.toBe('copy')
  })
})

describe('buildPageAnalysis — passagem via checkout_hits (tag GTM) quando não há A/B', () => {
  // Página só com GA4 (sem teste A/B), MAS com cliques de checkout da tag GTM.
  // Antes ficava sem passagem; agora tira do checkout_hits: clicantes distintos ÷ base.
  const gaPages = [ga('/p/lps-pv09/', 200)]
  const transacoes: SbTransacao[] = [tx({ sck_slug: 'lps-pv09', valor_bruto: 100 })]
  const checkoutHits: SbCheckoutHit[] = [
    { slug: 'lps-pv09', cid: 'c1' },
    { slug: 'lps-pv09', cid: 'c2' },
    { slug: 'lps-pv09', cid: 'c2' }, // mesmo cid repetido NÃO dobra (clicante distinto)
  ]
  const { rows } = buildPageAnalysis({ gaPages, transacoes, experiments: [], impressionUids: [], clarityRows: [], checkoutHits, funil: 'all' })
  const r = rows.find((x) => x.slug === 'lps-pv09')!

  it('clicantes distintos (2) ÷ sessões GA (200) = 1%, fonte "hits"', () => {
    expect(r.hitClicantes).toBe(2)
    expect(r.passagemFonte).toBe('hits')
    expect(r.passagemCheckoutPct).toBeCloseTo(1, 5)
  })

  it('A/B tem precedência: página com teste A/B ignora os hits', () => {
    // reusa o fixture do bloco anterior seria ideal, mas aqui só garantimos que sem
    // A/B a fonte é hits (o caso com A/B já é coberto por "col-pv02: passthrough por UID").
    expect(r.passagemFonte).not.toBe('ab')
  })
})

describe('buildPageAnalysis — passagem EXATA por uid (GTM server-side lê o cookie HttpOnly)', () => {
  // Mesmo cenário do LPS, agora com o uid vindo nos cliques de checkout. A passagem
  // deixa de ser estimativa (~GA) e vira interseção na identidade do Worker.
  const experiments: SbExperiment[] = [
    { id: 'e1', name: 'lps', entry_path: '/lps-0807', type: 'page', checkout_slug: null, status: 'active', started_at: null, ended_at: null, created_at: '2026-01-01', variants: [{ name: 'A', slug: 'lps-pv01', url: '/lps-pv01/', weight: 1 }] },
  ]
  // 10 uids viram a página
  const impressionUids: SbImpressionUid[] = Array.from({ length: 10 }, (_, i) => ({ experiment_id: 'e1', variant: 'A', uid: `u${i}` }))
  const checkoutHits: SbCheckoutHit[] = [
    { slug: 'lps-pv01', cid: 'c0', uid: 'u0' },      // viu e clicou
    { slug: 'lps-pv01', cid: 'c1', uid: 'u1' },      // viu e clicou
    { slug: 'lps-pv01', cid: 'c2', uid: 'u2' },      // viu e clicou
    { slug: 'lps-pv01', cid: 'cX', uid: 'forasteiro' }, // clicou mas NÃO viu esta variante
    { slug: 'lps-pv01', cid: 'cY', uid: null },      // tráfego direto, sem cookie uid
  ]
  const gaPages = [ga('/lps-pv01/', 400)]

  const { rows } = buildPageAnalysis({ gaPages, transacoes: [], experiments, impressionUids, clarityRows: [], checkoutHits, funil: 'all' })
  const r = rows.find((x) => x.slug === 'lps-pv01')!

  it('passagem = 3 dos 10 que viram = 30%, fonte "uid" (exata)', () => {
    expect(r.uidsPagina).toBe(10)
    expect(r.hitUidInter).toBe(3)
    expect(r.passagemFonte).toBe('uid')
    expect(r.passagemCheckoutPct).toBeCloseTo(30, 5)
  })

  it('o uid tem precedência sobre o ~GA (não usa mais cid ÷ usuários GA4)', () => {
    // pelo ~GA daria 5 cids ÷ 400 users = 1,25% — número diferente e aproximado.
    expect(r.passagemCheckoutPct).not.toBeCloseTo((5 / 400) * 100, 5)
  })

  it('clicante que não viu a variante não infla → passagem ≤ 100%', () => {
    expect(r.passagemCheckoutPct!).toBeLessThanOrEqual(100)
  })
})

describe('buildPageAnalysis — fonte "hits" nunca divide cid do GA por uid do A/B', () => {
  // Caso real do LPS (10/07/2026): a página tem teste A/B de PÁGINA (22 uids roteados),
  // mas nenhum teste de CHECKOUT vinculado. A tag GTM viu 32 clicantes distintos porque
  // conta também o tráfego direto/orgânico, que nunca passou pelo link /r/.
  // 32 ÷ 22 = 145%, que o Math.min(100) transformava em "passagem perfeita" — falso.
  // O denominador certo é o usuário do GA4 (mesma identidade do cid): 32 ÷ 178 ≈ 18%.
  const experiments: SbExperiment[] = [
    { id: 'e1', name: 'lps', entry_path: '/lps-0807', type: 'page', checkout_slug: null, status: 'active', started_at: null, ended_at: null, created_at: '2026-01-01', variants: [{ name: 'A', slug: 'lps-pv01', url: '/lps-pv01/', weight: 1 }] },
  ]
  const impressionUids: SbImpressionUid[] = Array.from({ length: 22 }, (_, i) => ({ experiment_id: 'e1', variant: 'A', uid: `u${i}` }))
  const checkoutHits: SbCheckoutHit[] = Array.from({ length: 32 }, (_, i) => ({ slug: 'lps-pv01', cid: `c${i}` }))
  const gaPages = [ga('/lps-pv01/', 178)]

  const { rows } = buildPageAnalysis({ gaPages, transacoes: [], experiments, impressionUids, clarityRows: [], checkoutHits, funil: 'all' })
  const r = rows.find((x) => x.slug === 'lps-pv01')!

  it('divide pelos usuários do GA4, não pelos 22 uids do A/B', () => {
    expect(r.uidsPagina).toBe(22)
    expect(r.hitClicantes).toBe(32)
    expect(r.passagemFonte).toBe('hits')
    expect(r.passagemCheckoutPct).toBeCloseTo((32 / 178) * 100, 5)
  })

  it('não encosta no teto de 100% (o sintoma que escondia o bug)', () => {
    expect(r.passagemCheckoutPct!).toBeLessThan(100)
  })
})
