import { describe, it, expect } from 'vitest'
import {
  aggregateCreatives,
  buildQuadrantMatrix,
  creativeHealthScore,
  scoreToHealth,
  type CreativeStats,
} from './creativeAnalysis'
import type { SbMetaAds, SbTransacao } from './supabase'

function meta(overrides: Partial<SbMetaAds>): SbMetaAds {
  return {
    data: '2026-05-01',
    criativo: 'criativo-a',
    ad_name: 'criativo-a',
    ad_id: 'AD-A',
    account_id: '111111111111111',
    campaign_name: 'CAM1',
    adset_name: 'ADS1',
    investimento: 0,
    impressoes: 0,
    alcance: 0,
    views_3seg: 0,
    views_95pct: 0,
    cliques_link: 0,
    landing_views: 0,
    checkouts: 0,
    compras: 0,
    valor_compras: 0,
    preview_url: null,
    ...overrides,
  }
}

function trans(overrides: Partial<SbTransacao>): SbTransacao {
  return {
    hotmart_id: 'H1',
    data: '2026-05-01',
    nome: 'Foo',
    email: 'foo@x.com',
    produto: 'protocolo',
    valor_bruto: 1500,
    valor_liquido_expert: 1200,
    forma_pagamento: 'PIX',
    parcelas: 1,
    criativo: 'criativo-a',
    ad_id: 'AD-A',
    utm_medium_ultimo: 'paid_social',
    utm_source_ultimo: 'fb',
    utm_medium_primeiro: 'paid_social',
    utm_source_primeiro: 'fb',
    ...overrides,
  }
}

describe('aggregateCreatives', () => {
  it('soma por ad_id e cruza com transações pra receita real', () => {
    const m = [
      meta({ ad_id: 'A', criativo: 'a', investimento: 100, landing_views: 50, cliques_link: 80 }),
      meta({ data: '2026-05-02', ad_id: 'A', criativo: 'a', investimento: 50, landing_views: 30, cliques_link: 40 }),
      meta({ ad_id: 'B', criativo: 'b', investimento: 200, landing_views: 100, cliques_link: 150 }),
    ]
    const t = [trans({ ad_id: 'A', criativo: 'a', valor_bruto: 1000 }), trans({ ad_id: 'A', criativo: 'a', valor_bruto: 500 })]
    const out = aggregateCreatives(m, t)
    expect(out).toHaveLength(2)
    const a = out.find((c) => c.ad_id === 'A')!
    expect(a.investimento).toBe(150)
    expect(a.landing_views).toBe(80)
    expect(a.compras).toBe(2)
    // receita = líquido POR transação (modelo canônico): duas vendas >97 (vídeo 2.49).
    // 1000 → 1000 − (89 + 1 + 2.49) = 907.51 ; 500 → 500 − (44.5 + 1 + 2.49) = 452.01
    // total = 1359.52
    expect(a.receita).toBeCloseTo(1359.52, 2)
    expect(a.roas).toBeCloseTo(9.0635, 3) // 1359.52 / 150
    expect(a.cpa).toBe(75) // 150 / 2
    expect(a.conv_pagina).toBeCloseTo(2 / 80)
  })

  it('fallback de ad_id null usa criativo como chave', () => {
    const m = [
      meta({ ad_id: null as unknown as string, criativo: 'fallback-x', investimento: 50 }),
      meta({ ad_id: null as unknown as string, criativo: 'fallback-x', investimento: 30 }),
    ]
    const out = aggregateCreatives(m, [])
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('fallback-x')
    expect(out[0].investimento).toBe(80)
  })

  it('cpa null quando 0 compras, roas 0 quando 0 invest', () => {
    const out = aggregateCreatives([meta({ ad_id: 'Z', investimento: 100 })], [])
    expect(out[0].cpa).toBeNull()
    expect(out[0].roas).toBe(0)
  })

  it('transação sem ad_id casa pelo criativo (campo fallback)', () => {
    const m = [meta({ ad_id: 'XYZ', criativo: 'criativo-foo', investimento: 50, landing_views: 10 })]
    const t = [trans({ ad_id: null as unknown as string, criativo: 'criativo-foo', valor_bruto: 500 })]
    const out = aggregateCreatives(m, t)
    expect(out[0].compras).toBe(1)
    // receita = líquido canônico: 500 (>97) → 500 − (44.5 + 1 + 2.49) = 452.01
    expect(out[0].receita).toBeCloseTo(452.01, 2)
  })
})

describe('creativeHealthScore + scoreToHealth', () => {
  it('zero pra criativo sem LPV e sem compras', () => {
    const c: CreativeStats = {
      key: 'k', ad_id: null, criativo: 'k',
      investimento: 10, impressoes: 100, cliques_link: 0,
      landing_views: 0, checkouts: 0, compras: 0,
      brutoTotal: 0, liquidoTotal: 0, nTrans: 0,
      receita: 0, roas: 0, roasBruto: 0, cpa: null, conv_pagina: 0, conv_clique: 0,
      score: 0, health: 'red',
    }
    expect(creativeHealthScore(c, { maxRoas: 1, maxConv: 0.05, maxLv: 1000 })).toBe(0)
  })

  it('score alto pra criativo bem normalizado', () => {
    const c: CreativeStats = {
      key: 'k', ad_id: null, criativo: 'k',
      investimento: 100, impressoes: 1000, cliques_link: 50,
      landing_views: 100, checkouts: 10, compras: 5,
      brutoTotal: 5000, liquidoTotal: 5000, nTrans: 5,
      receita: 5000, roas: 50, roasBruto: 50, cpa: 20, conv_pagina: 0.05, conv_clique: 0.1,
      score: 0, health: 'red',
    }
    const s = creativeHealthScore(c, { maxRoas: 50, maxConv: 0.05, maxLv: 1000 })
    expect(s).toBeGreaterThanOrEqual(70)
    expect(scoreToHealth(s)).toBe('green')
  })

  it('amarelo / vermelho conforme score', () => {
    expect(scoreToHealth(85)).toBe('green')
    expect(scoreToHealth(55)).toBe('yellow')
    expect(scoreToHealth(10)).toBe('red')
  })
})

describe('buildQuadrantMatrix', () => {
  function c(over: Partial<CreativeStats>): CreativeStats {
    return {
      key: over.key ?? 'k', ad_id: null, criativo: over.key ?? 'k',
      investimento: 0, impressoes: 0, cliques_link: 0,
      landing_views: 0, checkouts: 0, compras: 0,
      brutoTotal: 0, liquidoTotal: 0, nTrans: 0,
      receita: 0, roas: 0, roasBruto: 0, cpa: null, conv_pagina: 0, conv_clique: 0,
      score: 0, health: 'red',
      ...over,
    }
  }

  it('split por mediana — conv_pagina', () => {
    const creatives = [
      c({ key: 'high-hi-conv', landing_views: 100, conv_pagina: 0.08 }),
      c({ key: 'high-low-conv', landing_views: 200, conv_pagina: 0.01 }),
      c({ key: 'low-hi-conv', landing_views: 20, conv_pagina: 0.10 }),
      c({ key: 'low-low-conv', landing_views: 10, conv_pagina: 0.005 }),
    ]
    const m = buildQuadrantMatrix(creatives, 'conv_pagina')
    expect(m.cells.champion.map((x) => x.key)).toContain('high-hi-conv')
    expect(m.cells.magnet.map((x) => x.key)).toContain('high-low-conv')
    expect(m.cells.hidden_gem.map((x) => x.key)).toContain('low-hi-conv')
    expect(m.cells.dead.map((x) => x.key)).toContain('low-low-conv')
  })

  it('CPA é invertido — baixo CPA é bom', () => {
    const creatives = [
      c({ key: 'high-cheap', landing_views: 200, cpa: 30 }),
      c({ key: 'high-expensive', landing_views: 150, cpa: 200 }),
      c({ key: 'low-cheap', landing_views: 20, cpa: 25 }),
      c({ key: 'low-expensive', landing_views: 10, cpa: 300 }),
    ]
    const m = buildQuadrantMatrix(creatives, 'cpa')
    expect(m.cells.champion.map((x) => x.key)).toContain('high-cheap')
    expect(m.cells.magnet.map((x) => x.key)).toContain('high-expensive')
    expect(m.cells.hidden_gem.map((x) => x.key)).toContain('low-cheap')
    expect(m.cells.dead.map((x) => x.key)).toContain('low-expensive')
  })

  it('ignora criativos com 0 LPV', () => {
    const creatives = [
      c({ key: 'no-lpv', landing_views: 0, conv_pagina: 1 }),
      c({ key: 'has-lpv', landing_views: 50, conv_pagina: 0.05 }),
    ]
    const m = buildQuadrantMatrix(creatives, 'conv_pagina')
    const all = Object.values(m.cells).flat()
    expect(all).toHaveLength(1)
    expect(all[0].key).toBe('has-lpv')
  })

  it('lista vazia retorna medianas zero e cells vazios', () => {
    const m = buildQuadrantMatrix([], 'roas')
    expect(m.medianLpv).toBe(0)
    expect(m.cells.champion).toEqual([])
    expect(m.cells.dead).toEqual([])
  })

  it('número ímpar de criativos calcula mediana central', () => {
    const creatives = [
      c({ key: 'a', landing_views: 100, roas: 5 }),
      c({ key: 'b', landing_views: 50, roas: 3 }),
      c({ key: 'c', landing_views: 200, roas: 1 }),
    ]
    const m = buildQuadrantMatrix(creatives, 'roas')
    expect(m.medianLpv).toBe(100)
    expect(m.medianMetric).toBe(3)
  })
})
