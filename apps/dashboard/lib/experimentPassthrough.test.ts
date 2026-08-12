import { describe, it, expect } from 'vitest'
import { buildHitCidsBySlug, buildHitUidsBySlug, buildGaUsersBySlug, buildUidsByExpVariant, variantHitCids, variantGaUsers, resolveVariantCheckout, resolveConnectRate, connectRateDisplay, CONNECT_RATE_MIN_CLICKS } from './experimentPassthrough'
import type { GA4PageRow } from './ga4'

const ga = (pagePath: string, totalUsers: number): GA4PageRow =>
  ({ pagePath, pageTitle: '', sessions: totalUsers, screenPageViews: totalUsers, totalUsers, averageSessionDuration: 0 })

describe('buildHitCidsBySlug', () => {
  it('conta cids DISTINTOS por slug e ignora linha sem slug/cid', () => {
    const m = buildHitCidsBySlug([
      { slug: 'lps-pv01', cid: 'a' },
      { slug: 'lps-pv01', cid: 'a' }, // mesmo clicante, outro dia
      { slug: 'LPS-PV01', cid: 'b' }, // case-insensitive
      { slug: 'lps-pv02', cid: 'c' },
      { slug: '', cid: 'd' },
      { slug: 'lps-pv01', cid: '' },
    ])
    expect(m.get('lps-pv01')?.size).toBe(2)
    expect(m.get('lps-pv02')?.size).toBe(1)
    expect(m.has('')).toBe(false)
  })
})

describe('variantHitCids', () => {
  const hits = buildHitCidsBySlug([
    { slug: 'col-pvia04', cid: 'x' },
    { slug: 'col-pvia04', cid: 'y' },
  ])

  it('casa pelo último segmento da url quando o variant.slug é rótulo de sck', () => {
    const cids = variantHitCids(
      { slug: 'col-pvia04-2906', url: 'https://example.com/p/col-pvia04/' },
      hits,
    )
    expect(cids.size).toBe(2)
  })

  it('não inventa cid quando nenhuma das duas chaves bate', () => {
    const cids = variantHitCids(
      { slug: 'col-pv02-t2006', url: 'https://example.com/col-pv02-tab/' },
      hits,
    )
    expect(cids.size).toBe(0)
  })

  it('une os cids das duas chaves sem contar o mesmo cid duas vezes', () => {
    const m = buildHitCidsBySlug([
      { slug: 'lps-pv01', cid: 'a' },
      { slug: 'lps-pv01-alt', cid: 'a' },
      { slug: 'lps-pv01-alt', cid: 'b' },
    ])
    const cids = variantHitCids({ slug: 'lps-pv01-alt', url: '/lps-pv01/' }, m)
    expect(cids.size).toBe(2)
  })
})

describe('buildGaUsersBySlug / variantGaUsers', () => {
  const users = buildGaUsersBySlug([ga('/lps-pv01/', 178), ga('/p/col-pvia04/', 90), ga('/lps-pv01/?utm=x', 0)])

  it('soma totalUsers por slug, normalizando o pagePath', () => {
    expect(users.get('lps-pv01')).toBe(178)
  })

  it('prefere o slug da URL da variante (a página que o visitante abriu)', () => {
    expect(variantGaUsers({ slug: 'col-pvia04-2906', url: 'https://x.com.br/p/col-pvia04/' }, users)).toBe(90)
  })

  it('cai pro variant.slug quando a URL não tem página no GA4', () => {
    expect(variantGaUsers({ slug: 'lps-pv01', url: 'https://x.com.br/nao-existe/' }, users)).toBe(178)
  })

  it('sem GA4 devolve 0 (→ passagem "—", nunca um número inventado)', () => {
    expect(variantGaUsers({ slug: 'zzz', url: '/zzz/' }, users)).toBe(0)
  })
})

describe('buildUidsByExpVariant', () => {
  it('agrupa uids distintos por experimento|variante', () => {
    const m = buildUidsByExpVariant([
      { experiment_id: 'e1', variant: 'A', uid: 'u1' },
      { experiment_id: 'e1', variant: 'A', uid: 'u1' }, // reload mesmo uid
      { experiment_id: 'e1', variant: 'A', uid: 'u2' },
      { experiment_id: 'e1', variant: 'B', uid: 'u3' },
    ])
    expect(m.get('e1|A')?.size).toBe(2)
    expect(m.get('e1|B')?.size).toBe(1)
  })
})

describe('resolveConnectRate — interseção uid roteado ∩ uid que viu', () => {
  const set = (...xs: string[]) => new Set(xs)

  it('página perfeita: todo uid roteado também viu = 100%', () => {
    const r = resolveConnectRate(set('a', 'b', 'c', 'd'), set('a', 'b', 'c', 'd'))
    expect(r).toEqual({ routed: 4, landed: 4, rate: 100 })
  })

  it('perde gente no salto: 3 dos 5 roteados viram = 60%', () => {
    const r = resolveConnectRate(set('a', 'b', 'c'), set('a', 'b', 'c', 'd', 'e'))
    expect(r).toEqual({ routed: 5, landed: 3, rate: 60 })
  })

  it('sem cliques na janela (antes do deploy do Worker) → rate null, nunca 0%', () => {
    expect(resolveConnectRate(set('a', 'b'), set()).rate).toBeNull()
    expect(resolveConnectRate(set(), set()).rate).toBeNull()
  })

  // A TRAVA do bug relatado: `impressions` tem semanas de views; `route_clicks` só existe
  // desde o deploy de hoje. A conta antiga (contagem de views ÷ contagem de clicks) dava
  // 66 ÷ 1 = 6600% → travado em 100% falso. Na interseção, dos uids ROTEADOS só contam os
  // que também viram — os 65 views históricos de uids nunca roteados não entram.
  it('views históricas de uid nunca roteado NÃO inflam o connect rate', () => {
    const historicos = Array.from({ length: 65 }, (_, i) => `hist${i}`)
    const viewUids = set('rc1', ...historicos)   // 66 views: 1 roteado + 65 antigos
    const clickUids = set('rc1')                  // 1 clique roteado (só desde o deploy)
    const r = resolveConnectRate(viewUids, clickUids)
    expect(r).toEqual({ routed: 1, landed: 1, rate: 100 }) // 1 de 1 roteado viu — não 6600%
  })

  it('numerador é sempre subconjunto do denominador → rate ≤ 100 sem trava artificial', () => {
    // uid que viu mas não está entre os roteados (bot filtrado no clique, p.ex.) é ignorado.
    const r = resolveConnectRate(set('a', 'b', 'x', 'y', 'z'), set('a', 'b'))
    expect(r.rate).toBeLessThanOrEqual(100)
    expect(r).toEqual({ routed: 2, landed: 2, rate: 100 })
  })
})

describe('connectRateDisplay — trava de amostra (não mostrar ruído como número)', () => {
  it('sem cliques na janela → none (UI mostra "—")', () => {
    expect(connectRateDisplay(null, 0, 0)).toEqual({ kind: 'none' })
  })

  it('poucos cliques → low-sample (UI mostra "n baixo", esconde o %)', () => {
    const r = connectRateDisplay(100, 2, 2)
    expect(r).toEqual({ kind: 'low-sample', rate: 100, routed: 2, landed: 2 })
  })

  it('logo abaixo do limite ainda é low-sample', () => {
    expect(connectRateDisplay(90, CONNECT_RATE_MIN_CLICKS - 1, 30).kind).toBe('low-sample')
  })

  it('no limite ou acima → value (o % vale como número)', () => {
    expect(connectRateDisplay(90, CONNECT_RATE_MIN_CLICKS, 32).kind).toBe('value')
    expect(connectRateDisplay(88, 200, 176)).toEqual({ kind: 'value', rate: 88, routed: 200, landed: 176 })
  })

  it('o mesmo 100% que enganava com n=2 agora sai como low-sample, não como "página perfeita"', () => {
    expect(connectRateDisplay(100, 2, 2).kind).toBe('low-sample')
  })
})

describe('buildHitUidsBySlug — identidade exata (cookie do Worker via GTM server-side)', () => {
  it('agrupa uids distintos por slug e IGNORA linha sem uid (tráfego direto, sem cookie)', () => {
    const m = buildHitUidsBySlug([
      { slug: 'lps-pv01', cid: 'c1', uid: 'u1' },
      { slug: 'lps-pv01', cid: 'c2', uid: 'u1' }, // mesmo uid outro dia → 1 clicante
      { slug: 'lps-pv01', cid: 'c3', uid: 'u2' },
      { slug: 'lps-pv01', cid: 'c4', uid: null }, // veio direto, sem passar pelo /r/
      { slug: 'lps-pv01', cid: 'c5' },            // linha antiga (pré-migration 0054)
    ])
    expect(m.get('lps-pv01')?.size).toBe(2)
  })

  it('sem nenhum uid (só cid) → mapa vazio, e a passagem cai no ~GA', () => {
    const m = buildHitUidsBySlug([{ slug: 'x', cid: 'c1' }, { slug: 'x', cid: 'c2' }])
    expect(m.size).toBe(0)
  })
})

describe('resolveVariantCheckout — tier uid (passagem EXATA)', () => {
  it('com uid nos cliques: interseção com quem VIU a variante ÷ quem viu (exato)', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1', 'u2', 'u3', 'u4']),
      linkedCheckoutUids: null,
      hitUids: new Set(['u2', 'u4']),          // 2 dos 4 que viram clicaram
      hitCids: new Set(['c1', 'c2', 'c3']),    // o ~GA existe, mas o uid tem precedência
      gaUsers: 500,
    })
    expect(r).toEqual({ checkoutViews: 2, checkoutFonte: 'uid', checkoutDenom: 4 })
  })

  it('clique de uid que NÃO viu esta variante não conta → nunca passa de 100%', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1', 'u2']),
      linkedCheckoutUids: null,
      hitUids: new Set(['u1', 'u2', 'zzz1', 'zzz2', 'zzz3']), // 3 cliques de outra variante
      hitCids: new Set(),
      gaUsers: 100,
    })
    expect(r).toEqual({ checkoutViews: 2, checkoutFonte: 'uid', checkoutDenom: 2 })
    expect(r.checkoutViews! / r.checkoutDenom).toBeLessThanOrEqual(1)
  })

  it('uid presente mas sem interseção (ninguém que viu clicou) → cai pro ~GA, não crava 0%', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1', 'u2']),
      linkedCheckoutUids: null,
      hitUids: new Set(['outro']),
      hitCids: new Set(['c1']),
      gaUsers: 50,
    })
    expect(r.checkoutFonte).toBe('hits')
  })

  it('A/B vinculado ainda tem precedência sobre o uid', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1', 'u2', 'u3']),
      linkedCheckoutUids: new Set(['u1']),
      hitUids: new Set(['u1', 'u2', 'u3']),
      hitCids: new Set(),
      gaUsers: 100,
    })
    expect(r.checkoutFonte).toBe('ab')
  })

  // TRAVA DE JANELA (caso real do COL-TP-0406, que roda desde 03/06): sem filtro de data,
  // as impressões vêm "desde sempre" (39 dias) mas os hits só dos últimos 30. Dividir os
  // cliques de 30d pelas views de 39d encolhe a passagem — e o erro CRESCE com o tempo de
  // vida do experimento. O tier 'uid' tem que dividir pelas views DA JANELA DOS HITS.
  it('tier uid divide pelas views da JANELA DOS HITS, não pelas views desde sempre', () => {
    const desdeSempre = new Set(Array.from({ length: 100 }, (_, i) => `u${i}`)) // 39 dias
    const naJanela = new Set(Array.from({ length: 40 }, (_, i) => `u${i}`))     // 30 dias
    const cliques = new Set(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'])   // 8 clicaram

    const r = resolveVariantCheckout({
      pageUids: desdeSempre,
      pageUidsJanela: naJanela,
      linkedCheckoutUids: null,
      hitUids: cliques,
      hitCids: new Set(),
      gaUsers: 500,
    })
    expect(r).toEqual({ checkoutViews: 8, checkoutFonte: 'uid', checkoutDenom: 40 }) // 20%
    expect(r.checkoutDenom).not.toBe(100) // o erro antigo: 8/100 = 8%, quase 3x menor
  })

  it('sem pageUidsJanela cai em pageUids (compat, mesma janela)', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1', 'u2', 'u3', 'u4']),
      linkedCheckoutUids: null,
      hitUids: new Set(['u1']),
      hitCids: new Set(),
      gaUsers: 100,
    })
    expect(r).toEqual({ checkoutViews: 1, checkoutFonte: 'uid', checkoutDenom: 4 })
  })

  it('sem uid (só cid) mantém o ~GA de antes — retrocompatível', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1', 'u2']),
      linkedCheckoutUids: null,
      hitUids: new Set(),
      hitCids: new Set(['c1', 'c2', 'c3']),
      gaUsers: 100,
    })
    expect(r.checkoutFonte).toBe('hits')
  })
})

describe('resolveVariantCheckout', () => {
  it('A/B vinculado vence: interseção de UIDs sobre os UIDs da variante', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1', 'u2', 'u3']),
      linkedCheckoutUids: new Set(['u2', 'u3', 'u9']),
      hitUids: new Set(),
      hitCids: new Set(['c1', 'c2', 'c3', 'c4']),
      gaUsers: 100,
    })
    expect(r).toEqual({ checkoutViews: 2, checkoutFonte: 'ab', checkoutDenom: 3 })
  })

  it('sem checkout vinculado, cai pros cliques da tag GTM sobre usuários GA4', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1', 'u2']),
      linkedCheckoutUids: null,
      hitUids: new Set(),
      hitCids: new Set(['c1', 'c2', 'c3']),
      gaUsers: 100,
    })
    expect(r).toEqual({ checkoutViews: 3, checkoutFonte: 'hits', checkoutDenom: 100 })
  })

  // A trava desta rodada: o denominador NUNCA é o uid do A/B quando o numerador é cid do GA.
  // Cenário real do LPS — 32 cids do GA contra 22 uids roteados daria 145% (travado em 100%).
  it('fonte hits jamais usa o uid do A/B como denominador', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(Array.from({ length: 22 }, (_, i) => `u${i}`)),
      linkedCheckoutUids: null,
      hitUids: new Set(),
      hitCids: new Set(Array.from({ length: 32 }, (_, i) => `c${i}`)),
      gaUsers: 178,
    })
    expect(r.checkoutDenom).toBe(178)
    expect(r.checkoutViews! / r.checkoutDenom).toBeLessThan(1)
  })

  it('checkout vinculado mas SEM impressões não zera: cai pros hits', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1']),
      linkedCheckoutUids: new Set(),
      hitUids: new Set(),
      hitCids: new Set(['c1']),
      gaUsers: 50,
    })
    expect(r).toEqual({ checkoutViews: 1, checkoutFonte: 'hits', checkoutDenom: 50 })
  })

  // A trava do bug original: sem instrumentação nenhuma é `undefined` (→ "—"),
  // nunca 0 (que a UI leria como "ninguém passou" e o diagnóstico como gargalo).
  it('sem A/B e sem hits devolve undefined, não 0', () => {
    const r = resolveVariantCheckout({
      pageUids: new Set(['u1', 'u2']),
      linkedCheckoutUids: null,
      hitUids: new Set(),
      hitCids: new Set(),
      gaUsers: 100,
    })
    expect(r).toEqual({ checkoutViews: undefined, checkoutFonte: null, checkoutDenom: 0 })
  })
})
