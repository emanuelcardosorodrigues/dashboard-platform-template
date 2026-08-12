import { describe, expect, test } from 'vitest'
import { matchSaleToVariant, findOrphanSales, classifyOrphanSlugs, buildAllowedPageSegments } from './abAttribution'
import type { SbExperiment } from './supabase'

const pageExp: SbExperiment = {
  id: 'exp-page-1', name: 'COL page', entry_path: '/col-tp-01-2804', type: 'page',
  status: 'active', started_at: '2026-04-28T00:00:00Z', ended_at: null,
  created_at: '2026-04-28T00:00:00Z',
  variants: [
    { name: 'A', slug: 't01-col-pv02', url: 'https://example.com/col-pv02/', weight: 0 },
    { name: 'B', slug: 't01-col-pv03', url: 'https://example.com/col-pv03/', weight: 0.5 },
    { name: 'C', slug: 't01-col-pv04', url: 'https://example.com/col-pv04/', weight: 0.5 },
  ],
}

describe('matchSaleToVariant — atribuição estrita por ID via pv-marker', () => {
  test('sale sem pv-marker NÃO casa com page exp (mesmo se URL pathname bater)', () => {
    // Sale legado sem pv: ghost attribution evitada. Antes do fix essa venda
    // era atribuída à variante B pelo fallback URL pathname.
    const sckSlug = 'col-pv03_ckck-v1_obob2'
    expect(matchSaleToVariant(sckSlug, pageExp, pageExp.variants[0])).toBe(false)
    expect(matchSaleToVariant(sckSlug, pageExp, pageExp.variants[1])).toBe(false)
    expect(matchSaleToVariant(sckSlug, pageExp, pageExp.variants[2])).toBe(false)
  })

  test('mantém matching estrito em checkout (slug, não pathname)', () => {
    const ckExp: SbExperiment = { ...pageExp, type: 'checkout',
      variants: [{ name: 'A', slug: 'ck-v1', url: 'https://pay.hotmart.com/X', weight: 1 }] }
    expect(matchSaleToVariant('col-pv03_ckck-v1_obob2', ckExp, ckExp.variants[0])).toBe(true)
  })

  test('mantém matching estrito em ob (slug, não pathname)', () => {
    const obExp: SbExperiment = { ...pageExp, type: 'ob',
      variants: [{ name: 'A', slug: 'ob2', weight: 1 }] }
    expect(matchSaleToVariant('col-pv03_ckck-v1_obob2', obExp, obExp.variants[0])).toBe(true)
  })

  test('venda sem sck (string vazia) não casa com nada', () => {
    expect(matchSaleToVariant('', pageExp, pageExp.variants[0])).toBe(false)
  })

  test('variante de page sem URL e sem pv-marker no sck → não casa', () => {
    // Match agora exige pv-marker, independente de ter URL ou não na variante.
    const noUrlExp: SbExperiment = { ...pageExp,
      variants: [{ name: 'A', slug: 'col-pv02', weight: 1 }] }
    expect(matchSaleToVariant('col-pv02_ckck-v1_obob2', noUrlExp, noUrlExp.variants[0])).toBe(false)
  })

  test('variante de page sem URL casa via pv-marker com seu próprio ID', () => {
    const noUrlExp: SbExperiment = { ...pageExp,
      variants: [{ name: 'A', slug: 'col-pv02', weight: 1 }] }
    expect(matchSaleToVariant('seg_pvcol-pv02_ckck-v1', noUrlExp, noUrlExp.variants[0])).toBe(true)
  })
})

describe('matchSaleToVariant — pv marker (novo formato com ?pv= do Worker)', () => {
  test('atribui page pela variante via marcador pv (posição-independente)', () => {
    const sckSlug = 'col-pv03_pvt01-col-pv03_ckck-v1_obob2'
    expect(matchSaleToVariant(sckSlug, pageExp, pageExp.variants[0])).toBe(false) // A (pvt01-col-pv02)
    expect(matchSaleToVariant(sckSlug, pageExp, pageExp.variants[1])).toBe(true)  // B (pvt01-col-pv03)
    expect(matchSaleToVariant(sckSlug, pageExp, pageExp.variants[2])).toBe(false) // C (pvt01-col-pv04)
  })

  test('pv tem prioridade sobre pathname quando os dois apontam para variantes diferentes', () => {
    // pathname = col-pv03 (variante B), pv = t01-col-pv04 (variante C) — pv vence
    const sckSlug = 'col-pv03_pvt01-col-pv04_ckck-v1_obob2'
    expect(matchSaleToVariant(sckSlug, pageExp, pageExp.variants[1])).toBe(false) // B
    expect(matchSaleToVariant(sckSlug, pageExp, pageExp.variants[2])).toBe(true)  // C
  })

  test('checkout funciona com pv presente no sck (some, não índice fixo)', () => {
    const ckExp: SbExperiment = { ...pageExp, type: 'checkout',
      variants: [{ name: 'A', slug: 'ck-v1', url: 'https://pay.hotmart.com/X', weight: 1 }] }
    // pv inserido desloca ck de seg[1] para seg[2] — some() deve encontrar mesmo assim
    expect(matchSaleToVariant('col-pv03_pvt01-col-pv03_ckck-v1_obob2', ckExp, ckExp.variants[0])).toBe(true)
  })

  test('ob funciona com pv presente no sck (some, não índice fixo)', () => {
    const obExp: SbExperiment = { ...pageExp, type: 'ob',
      variants: [{ name: 'A', slug: 'ob2', weight: 1 }] }
    expect(matchSaleToVariant('col-pv03_pvt01-col-pv03_ckck-v1_obob2', obExp, obExp.variants[0])).toBe(true)
  })

  test('pv inválido (caractere especial) não causa match', () => {
    // cHtml valida /^[a-zA-Z0-9-]+$/ — mas garantir robustez na atribuição
    const sckSlug = 'col-pv03_pvt01-col-pv03_ckck-v1_obob2'
    const wrongVariant: SbExperiment = { ...pageExp,
      variants: [{ name: 'X', slug: 'outro-slug', url: 'https://example.com/outro/', weight: 1 }] }
    expect(matchSaleToVariant(sckSlug, wrongVariant, wrongVariant.variants[0])).toBe(false)
  })

  test('page slug começando com `pv` sem marker no sck → NÃO casa (fallback removido)', () => {
    const pvPageExp: SbExperiment = { ...pageExp,
      variants: [{ name: 'A', slug: 'pvideo-comp', url: 'https://example.com/pvideo-comp/', weight: 1 }],
    }
    // sale legacy sem marker pv: antes do fix, segments[0] = 'pvideo-comp' casava
    // pelo fallback de pathname. Depois do fix, só pv-marker conta → não casa.
    expect(matchSaleToVariant('pvideo-comp_ckck-v1_obob2', pvPageExp, pvPageExp.variants[0])).toBe(false)
  })

  test('page slug começando com `pv` + marker pv real casa via marker (segments.slice(1) ignora seg[0])', () => {
    const pvPageExp: SbExperiment = { ...pageExp,
      variants: [{ name: 'A', slug: 'pvideo-comp', url: 'https://example.com/pvideo-comp/', weight: 1 }],
    }
    // marker = pv${variant.slug} = 'pvpvideo-comp'
    expect(matchSaleToVariant('pvideo-comp_pvpvideo-comp_ckck-v1', pvPageExp, pvPageExp.variants[0])).toBe(true)
  })
})

describe('matchSaleToVariant — colisão cross-experiment de slug ck/ob', () => {
  const pageA: SbExperiment = { ...pageExp, id: 'page-A', entry_path: '/col', name: 'COL page',
    variants: [{ name: 'A', slug: 'col-pv02', url: 'https://example.com/col-pv02/', weight: 1 }],
  }
  const pageB: SbExperiment = { ...pageExp, id: 'page-B', entry_path: '/dpl', name: 'DPL page',
    variants: [{ name: 'A', slug: 'dpl-pv01', url: 'https://example.com/dpl-pv01/', weight: 1 }],
  }
  // Dois checkouts diferentes com MESMO variant.slug 'v1'
  const ckA: SbExperiment = { ...pageExp, id: 'ck-A', entry_path: '/col', type: 'checkout', name: 'COL checkout',
    variants: [{ name: 'A', slug: 'v1', url: 'https://pay.hotmart.com/COL', weight: 1 }],
  }
  const ckB: SbExperiment = { ...pageExp, id: 'ck-B', entry_path: '/dpl', type: 'checkout', name: 'DPL checkout',
    variants: [{ name: 'A', slug: 'v1', url: 'https://pay.hotmart.com/DPL', weight: 1 }],
  }

  test('sem allowedPageSegments → comportamento legado (lenient, casa em ambos)', () => {
    const sale = 'col-pv02_ckv1_obob2'
    expect(matchSaleToVariant(sale, ckA, ckA.variants[0])).toBe(true)
    expect(matchSaleToVariant(sale, ckB, ckB.variants[0])).toBe(true) // bug latente reproduzido
  })

  test('com allowedPageSegments → sale do col só atribui ao checkout col', () => {
    const allowedMap = buildAllowedPageSegments([pageA, pageB, ckA, ckB])
    const sale = 'col-pv02_ckv1_obob2'
    expect(matchSaleToVariant(sale, ckA, ckA.variants[0], allowedMap.get(ckA.id))).toBe(true)
    expect(matchSaleToVariant(sale, ckB, ckB.variants[0], allowedMap.get(ckB.id))).toBe(false)
  })

  test('com allowedPageSegments → sale do dpl só atribui ao checkout dpl', () => {
    const allowedMap = buildAllowedPageSegments([pageA, pageB, ckA, ckB])
    const sale = 'dpl-pv01_ckv1_obob2'
    expect(matchSaleToVariant(sale, ckA, ckA.variants[0], allowedMap.get(ckA.id))).toBe(false)
    expect(matchSaleToVariant(sale, ckB, ckB.variants[0], allowedMap.get(ckB.id))).toBe(true)
  })

  test('checkout sem page exps roteando → set vazio → fallback lenient', () => {
    const allowedMap = buildAllowedPageSegments([ckA]) // sem nenhum page exp
    const sale = 'qualquer-pagina-pv01_ckv1_obob2'
    expect(matchSaleToVariant(sale, ckA, ckA.variants[0], allowedMap.get(ckA.id))).toBe(true)
  })

  test('page com checkout_slug aponta corretamente — sale dessa page atribui ao checkout linkado', () => {
    const pageVsl: SbExperiment = { ...pageExp, id: 'page-vsl', entry_path: '/col-vsl', name: 'COL VSL',
      checkout_slug: '/col',
      variants: [{ name: 'A', slug: 'col-vsl-pv01', url: 'https://example.com/col-vsl-pv01/', weight: 1 }],
    }
    const allowedMap = buildAllowedPageSegments([pageA, pageVsl, ckA])
    const sale = 'col-vsl-pv01_ckv1_obob2'
    expect(matchSaleToVariant(sale, ckA, ckA.variants[0], allowedMap.get(ckA.id))).toBe(true)
  })

  test('OB segue mesma regra de allowedPageSegments', () => {
    const obA: SbExperiment = { ...pageExp, id: 'ob-A', entry_path: '/col', type: 'ob', name: 'COL ob',
      variants: [{ name: 'A', slug: 'x1', weight: 1 }],
    }
    const obB: SbExperiment = { ...pageExp, id: 'ob-B', entry_path: '/dpl', type: 'ob', name: 'DPL ob',
      variants: [{ name: 'A', slug: 'x1', weight: 1 }],
    }
    const allowedMap = buildAllowedPageSegments([pageA, pageB, obA, obB])
    const sale = 'col-pv02_ckv1_obx1'
    expect(matchSaleToVariant(sale, obA, obA.variants[0], allowedMap.get(obA.id))).toBe(true)
    expect(matchSaleToVariant(sale, obB, obB.variants[0], allowedMap.get(obB.id))).toBe(false)
  })
})

describe('findOrphanSales', () => {
  test('lista sck_slugs que não casam com nenhuma variante de page ativo', () => {
    // sckSlugs com pv-marker: o primeiro casa com variante B (pv${t01-col-pv03}),
    // o segundo não bate com nenhuma das 3 variantes.
    const sales = {
      'col-pv03_pvt01-col-pv03_ckck-v1_obob2': { count: 1, receita: 134 },
      'col-pv99_pvt99-col-pv99_ckck-v1_obob2': { count: 2, receita: 268 },
    }
    const orphans = findOrphanSales(sales, [pageExp])
    expect(orphans).toEqual([
      { sck_slug: 'col-pv99_pvt99-col-pv99_ckck-v1_obob2', count: 2, receita: 268 },
    ])
  })

  test('retorna [] quando todos os sck_slugs casam', () => {
    const sales = { 'col-pv03_pvt01-col-pv03_ckck-v1_obob2': { count: 1, receita: 134 } }
    expect(findOrphanSales(sales, [pageExp])).toEqual([])
  })

  test('sale sem pv-marker é órfã (mesmo que pathname coincida com URL da variante)', () => {
    const sales = { 'col-pv03_ckck-v1_obob2': { count: 1, receita: 134 } }
    expect(findOrphanSales(sales, [pageExp])).toEqual([
      { sck_slug: 'col-pv03_ckck-v1_obob2', count: 1, receita: 134 },
    ])
  })

  test('multi-exp: sale que casa com qualquer um dos exps NÃO é órfã (sem duplicatas, sem falsos positivos)', () => {
    const expA: SbExperiment = { ...pageExp, id: 'exp-A', entry_path: '/col',
      variants: [
        { name: 'A', slug: 't01-col-pv02', url: 'https://example.com/col-pv02/', weight: 0.5 },
        { name: 'B', slug: 't01-col-pv03', url: 'https://example.com/col-pv03/', weight: 0.5 },
      ],
    }
    const expB: SbExperiment = { ...pageExp, id: 'exp-B', entry_path: '/dpl',
      variants: [
        { name: 'A', slug: 't02-dpl-pv01', url: 'https://example.com/dpl-pv01/', weight: 1 },
      ],
    }
    const sales = {
      'col-pv02_pvt01-col-pv02_ckck-v1_obob2': { count: 3, receita: 300 }, // casa expA via pv
      'dpl-pv01_pvt02-dpl-pv01_ckck-v1_obob2': { count: 2, receita: 134 }, // casa expB via pv
      'xpto-pv01_pvqualquer_ckck-v1_obob2': { count: 1, receita: 67 },     // casa nenhum
    }
    const orphans = findOrphanSales(sales, [expA, expB])
    expect(orphans).toEqual([
      { sck_slug: 'xpto-pv01_pvqualquer_ckck-v1_obob2', count: 1, receita: 67 },
    ])
  })
})

describe('classifyOrphanSlugs', () => {
  const activeExp: SbExperiment = { ...pageExp, id: 'active', status: 'active', name: 'COL ativo',
    variants: [{ name: 'A', slug: 't01-col-pv02', url: 'https://example.com/col-pv02/', weight: 1 }],
  }
  const endedExpOld: SbExperiment = { ...pageExp, id: 'ended-old', status: 'ended', name: 'DPL antigo',
    started_at: '2026-01-01T00:00:00Z', ended_at: '2026-02-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
    variants: [{ name: 'A', slug: 't00-dpl-pv01', url: 'https://example.com/dpl-pv01/', weight: 1 }],
  }
  const endedExpNew: SbExperiment = { ...pageExp, id: 'ended-new', status: 'ended', name: 'DPL novo',
    started_at: '2026-03-01T00:00:00Z', ended_at: '2026-04-01T00:00:00Z', created_at: '2026-03-01T00:00:00Z',
    variants: [{ name: 'A', slug: 't01-dpl-pv01', url: 'https://example.com/dpl-pv01/', weight: 1 }],
  }

  test('sale que casa com exp ativo NÃO entra em nenhum bucket', () => {
    // sckSlug com pv-marker batendo com ID da variante ativa (t01-col-pv02)
    const sales = { 'col-pv02_pvt01-col-pv02_ckck-v1_obob2': { count: 1, receita: 100 } }
    const result = classifyOrphanSlugs(sales, [activeExp])
    expect(result.inactive).toEqual([])
    expect(result.neverTested).toEqual([])
  })

  test('sale que casa apenas com exp ended entra em inactive com nome do último experimento', () => {
    // pv-marker bate com endedExpOld (slug t00-dpl-pv01)
    const sckSlug = 'dpl-pv01_pvt00-dpl-pv01_ckck-v1_obob2'
    const sales = { [sckSlug]: { count: 2, receita: 200 } }
    const result = classifyOrphanSlugs(sales, [activeExp, endedExpOld])
    expect(result.neverTested).toEqual([])
    expect(result.inactive).toHaveLength(1)
    expect(result.inactive[0]).toEqual({
      sckSlug,
      count: 2,
      receita: 200,
      lastExperimentName: 'DPL antigo',
      lastExperimentEndedAt: '2026-02-01T00:00:00Z',
    })
  })

  test('sale sem nenhum exp casando entra em neverTested', () => {
    const sales = { 'xpto-pv01_pvqualquer_ckck-v1_obob2': { count: 1, receita: 67 } }
    const result = classifyOrphanSlugs(sales, [activeExp, endedExpOld])
    expect(result.inactive).toEqual([])
    expect(result.neverTested).toEqual([
      { sckSlug: 'xpto-pv01_pvqualquer_ckck-v1_obob2', count: 1, receita: 67 },
    ])
  })

  test('sale sem pv-marker entra em neverTested (mesmo se pathname coincidiria com exp)', () => {
    // Antes do fix, esse sale casava com activeExp via fallback URL pathname.
    // Depois do fix, vira órfão neverTested — comportamento desejado pra evitar ghost.
    const sales = { 'col-pv02_ckck-v1_obob2': { count: 1, receita: 100 } }
    const result = classifyOrphanSlugs(sales, [activeExp])
    expect(result.inactive).toEqual([])
    expect(result.neverTested).toEqual([
      { sckSlug: 'col-pv02_ckck-v1_obob2', count: 1, receita: 100 },
    ])
  })

  test('quando há múltiplos exps ended casando, lastExperiment é o mais recente', () => {
    // pv-marker bate com BOTH endedExpOld (t00-dpl-pv01) e endedExpNew (t01-dpl-pv01)
    // ... mas como pv é único, só dá pra bater com um por sckSlug. Uso o ID do novo.
    const sckSlug = 'dpl-pv01_pvt01-dpl-pv01_ckck-v1_obob2'
    const sales = { [sckSlug]: { count: 1, receita: 67 } }
    const result = classifyOrphanSlugs(sales, [endedExpOld, endedExpNew])
    expect(result.inactive).toHaveLength(1)
    expect(result.inactive[0].lastExperimentName).toBe('DPL novo')
    expect(result.inactive[0].lastExperimentEndedAt).toBe('2026-04-01T00:00:00Z')
  })

  test('ordena cada bucket por receita desc', () => {
    const sales = {
      'a-pv01_ckck-v1_obob2': { count: 1, receita: 50 },
      'b-pv01_ckck-v1_obob2': { count: 1, receita: 200 },
      'c-pv01_ckck-v1_obob2': { count: 1, receita: 100 },
    }
    const result = classifyOrphanSlugs(sales, [])
    expect(result.neverTested.map(o => o.sckSlug)).toEqual([
      'b-pv01_ckck-v1_obob2',
      'c-pv01_ckck-v1_obob2',
      'a-pv01_ckck-v1_obob2',
    ])
  })
})
