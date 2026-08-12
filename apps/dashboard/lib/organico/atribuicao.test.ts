import { describe, test, expect } from 'vitest'
import { computeOrganicRevenue, sckForPost } from './atribuicao'

const POSTS = [
  { id: 'p1', platform: 'youtube', external_id: 'VID123' },
  { id: 'p2', platform: 'instagram', external_id: 'MEDIA456' },
]

function trans(over: Record<string, unknown>) {
  return {
    criativo: '', sck_slug: undefined, valor_bruto: 100, status: 'approved',
    utm_source_ultimo: 'organico', utm_source_primeiro: '', utm_medium_ultimo: 'youtube',
    utm_medium_primeiro: '', ad_id: null, ad_id_primeiro: null,
    ...over,
  } as Parameters<typeof computeOrganicRevenue>[0][number]
}

describe('computeOrganicRevenue', () => {
  test('match por utm_content (criativo) com origem orgânica', () => {
    const map = computeOrganicRevenue([trans({ criativo: 'VID123' })], POSTS)
    expect(map.get('p1')).toEqual({ receita: 100, vendas: 1 })
  })

  test('match por sck org_{plataforma}_{id}', () => {
    expect(sckForPost('instagram', 'MEDIA456')).toBe('org_instagram_MEDIA456')
    const map = computeOrganicRevenue([trans({ sck_slug: 'org_instagram_MEDIA456', utm_medium_ultimo: 'instagram' })], POSTS)
    expect(map.get('p2')).toEqual({ receita: 100, vendas: 1 })
  })

  test('mesmo token com origem PAGA não conta (guarda de origem)', () => {
    const map = computeOrganicRevenue([
      trans({ criativo: 'VID123', ad_id: '999', utm_source_ultimo: 'metaads' }),
    ], POSTS)
    expect(map.get('p1')).toBeUndefined()
  })

  test('refund/chargeback fora', () => {
    const map = computeOrganicRevenue([trans({ criativo: 'VID123', status: 'refunded' })], POSTS)
    expect(map.get('p1')).toBeUndefined()
  })

  test('acumula múltiplas vendas do mesmo post', () => {
    const map = computeOrganicRevenue([
      trans({ criativo: 'VID123', valor_bruto: 50 }),
      trans({ sck_slug: sckForPost('youtube', 'VID123'), valor_bruto: 70 }),
    ], POSTS)
    expect(map.get('p1')).toEqual({ receita: 120, vendas: 2 })
  })

  test('sem match → post fora do mapa (receita NULL na UI, nunca R$0 falso)', () => {
    const map = computeOrganicRevenue([trans({ criativo: 'outro-criativo' })], POSTS)
    expect(map.size).toBe(0)
  })
})
