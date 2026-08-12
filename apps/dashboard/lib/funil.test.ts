import { describe, expect, it } from 'vitest'
import { applyAdFilters, buildCascadeOptions, filterTransacoesByAds, adFilterActive, AD_ALL } from './funil'
import type { SbMetaAds, SbTransacao } from './supabase'

const meta = (p: Partial<SbMetaAds>): SbMetaAds => ({
  data: '2026-06-01', ad_name: 'ad', ad_id: 'a1', campaign_name: 'C', adset_name: 'S',
  impressoes: 0, cliques_link: 0, landing_views: 0, checkouts: 0, investimento: 0, ...p,
} as SbMetaAds)
const tx = (p: Partial<SbTransacao>): SbTransacao => ({
  data: '2026-06-01', email: 'x@x.com', produto: 'p', valor_bruto: 100, criativo: '', ...p,
} as SbTransacao)

const rows = [
  meta({ campaign_name: 'COL', adset_name: 'S1', ad_name: 'col_ad_a', ad_id: '1' }),
  meta({ campaign_name: 'COL', adset_name: 'S2', ad_name: 'col_ad_b', ad_id: '2' }),
  meta({ campaign_name: 'PLO', adset_name: 'S3', ad_name: 'plo_ad_c', ad_id: '3' }),
]

describe('adFilterActive', () => {
  it('all = inativo', () => expect(adFilterActive(AD_ALL)).toBe(false))
  it('qualquer recorte = ativo', () => expect(adFilterActive({ ...AD_ALL, campanha: 'COL' })).toBe(true))
})

describe('applyAdFilters — cascata', () => {
  it('campanha narrows', () => {
    expect(applyAdFilters(rows, { ...AD_ALL, campanha: 'COL' }).map((r) => r.ad_id)).toEqual(['1', '2'])
  })
  it('campanha+conjunto', () => {
    expect(applyAdFilters(rows, { campanha: 'COL', conjunto: 'S2', anuncio: 'all' }).map((r) => r.ad_id)).toEqual(['2'])
  })
  it('anúncio casa por ad_name OU ad_id', () => {
    expect(applyAdFilters(rows, { ...AD_ALL, anuncio: 'plo_ad_c' }).map((r) => r.ad_id)).toEqual(['3'])
    expect(applyAdFilters(rows, { ...AD_ALL, anuncio: '1' }).map((r) => r.ad_id)).toEqual(['1'])
  })
})

describe('buildCascadeOptions — dependências', () => {
  it('sem seleção: todas campanhas, todos conjuntos/anúncios', () => {
    const o = buildCascadeOptions(rows, { campanha: 'all', conjunto: 'all' })
    expect(o.campanhas).toEqual(['COL', 'PLO'])
    expect(o.conjuntos).toEqual(['S1', 'S2', 'S3'])
    expect(o.anuncios).toEqual(['col_ad_a', 'col_ad_b', 'plo_ad_c'])
  })
  it('campanha escolhida restringe conjuntos e anúncios', () => {
    const o = buildCascadeOptions(rows, { campanha: 'COL', conjunto: 'all' })
    expect(o.conjuntos).toEqual(['S1', 'S2'])
    expect(o.anuncios).toEqual(['col_ad_a', 'col_ad_b'])
  })
  it('conjunto escolhido restringe anúncios', () => {
    const o = buildCascadeOptions(rows, { campanha: 'COL', conjunto: 'S2' })
    expect(o.anuncios).toEqual(['col_ad_b'])
  })
})

describe('filterTransacoesByAds — ad_id direto + criativo fallback', () => {
  const metaFiltered = [rows[0]] // ad_id '1', ad_name 'col_ad_a'
  it('casa por ad_id', () => {
    const out = filterTransacoesByAds([tx({ ad_id: '1' }), tx({ ad_id: '2' })], metaFiltered)
    expect(out).toHaveLength(1)
    expect(out[0].ad_id).toBe('1')
  })
  it('casa por criativo == ad_name (case-insensitive) quando não tem ad_id', () => {
    const out = filterTransacoesByAds([tx({ criativo: 'COL_AD_A' }), tx({ criativo: 'outro' })], metaFiltered)
    expect(out).toHaveLength(1)
    expect(out[0].criativo).toBe('COL_AD_A')
  })
})
