import { describe, expect, it } from 'vitest'
import { classifyOrigem, aggregateByOrigem, segmentoCanal } from './origem'
import type { SbTransacao } from './supabase'

function t(partial: Partial<SbTransacao>): SbTransacao {
  return {
    hotmart_id: 'h1',
    data: '2026-06-01',
    nome: 'x',
    email: 'x@x.com',
    produto: 'Protocolo Lucro Oculto',
    valor_bruto: 100,
    valor_liquido_expert: 90,
    forma_pagamento: 'pix',
    parcelas: 1,
    criativo: '',
    utm_medium_ultimo: '',
    utm_source_ultimo: '',
    utm_medium_primeiro: '',
    utm_source_primeiro: '',
    ...partial,
  }
}

describe('segmentoCanal — segmento de canal pelo utm_medium (valores reais do DEMO)', () => {
  const casos: [string, string][] = [
    ['pago-metaads', 'pago'],
    ['Instagram_Stories', 'pago'],   // placement de mídia vazado no medium
    ['instagram', 'organico'],
    ['organico-instagram', 'organico'],
    ['social', 'organico'],
    ['email__ascencao', 'ascensao'],
    ['ascencao', 'ascensao'],
    ['ascensao__ascensao', 'ascensao'],
    ['recuperacao', 'ascensao'],
    ['palestra', 'ascensao'],
    ['', 'outros'],
    ['0', 'outros'],
    ['Direto', 'outros'],
  ]
  for (const [medium, esperado] of casos) {
    it(`"${medium}" => ${esperado}`, () => {
      expect(segmentoCanal(medium)).toBe(esperado)
    })
  }
})

describe('classifyOrigem — origem determinística da venda', () => {
  it('ad_id presente => pago (sinal mais forte)', () => {
    expect(classifyOrigem(t({ ad_id: 'AD_ID_DEMO_ORGANICO', utm_medium_ultimo: 'organico' }))).toBe('pago')
  })

  it('utm_medium "pago-metaads" => pago', () => {
    expect(classifyOrigem(t({ utm_medium_ultimo: 'pago-metaads' }))).toBe('pago')
  })

  it('placement instagram_feed no source => pago', () => {
    expect(classifyOrigem(t({ utm_source_ultimo: 'IG_instagram_feed' }))).toBe('pago')
  })

  it('whatsapp no source => whatsapp', () => {
    expect(classifyOrigem(t({ utm_source_ultimo: 'whatsapp', utm_medium_ultimo: 'social' }))).toBe('whatsapp')
  })

  it('organico-instagram => organico', () => {
    expect(classifyOrigem(t({ utm_source_ultimo: 'organico', utm_medium_ultimo: 'organico-instagram' }))).toBe('organico')
  })

  it('social puro => organico', () => {
    expect(classifyOrigem(t({ utm_medium_ultimo: 'social' }))).toBe('organico')
  })

  it('direto/direct/vazio/tagassistant/hotmart.com => direto', () => {
    expect(classifyOrigem(t({}))).toBe('direto')
    expect(classifyOrigem(t({ utm_source_ultimo: 'direto' }))).toBe('direto')
    expect(classifyOrigem(t({ utm_medium_ultimo: 'direct' }))).toBe('direto')
    expect(classifyOrigem(t({ utm_source_ultimo: 'tagassistant.google.com' }))).toBe('direto')
    expect(classifyOrigem(t({ utm_source_ultimo: 'hotmart.com' }))).toBe('direto')
  })

  it('fallback pro _primeiro quando _ultimo vazio', () => {
    expect(classifyOrigem(t({ utm_medium_primeiro: 'pago-metaads' }))).toBe('pago')
  })
})

describe('aggregateByOrigem — soma por origem', () => {
  it('agrupa faturamento e conta vendas por origem, na ordem fixa', () => {
    const rows = aggregateByOrigem([
      t({ ad_id: 'a1', valor_bruto: 200 }),
      t({ utm_medium_ultimo: 'organico', valor_bruto: 50 }),
      t({ utm_source_ultimo: 'whatsapp', valor_bruto: 30 }),
      t({ valor_bruto: 20 }), // direto
      t({ ad_id: 'a2', valor_bruto: 100 }),
    ])
    expect(rows.map((r) => r.origem)).toEqual(['pago', 'organico', 'whatsapp', 'direto'])
    const pago = rows.find((r) => r.origem === 'pago')!
    expect(pago.faturamentoBruto).toBe(300)
    expect(pago.vendas).toBe(2)
  })
})
