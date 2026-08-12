import { describe, it, expect } from 'vitest'
import { diffVariants, descreverEvento } from './variantEvents'
import type { SbVariant } from './supabase'

const v = (p: Partial<SbVariant> & { name: string }): SbVariant =>
  ({ slug: `s-${p.name}`, url: `/u-${p.name}`, weight: 0.5, ...p })

describe('diffVariants', () => {
  it('sem mudança → nenhum evento', () => {
    const antes = [v({ name: 'A' }), v({ name: 'B' })]
    expect(diffVariants(antes, [...antes])).toEqual([])
  })

  it('variante nova → "criada", já com o peso (senão o histórico nasce sem saber quanto ela pegou)', () => {
    const ev = diffVariants([v({ name: 'A' })], [v({ name: 'A' }), v({ name: 'D', weight: 0.7 })])
    expect(ev).toEqual([{ variant: 'D', kind: 'criada', de: null, para: '0.7', origem: 'manual' }])
  })

  it('peso alterado → evento com de/para', () => {
    const ev = diffVariants([v({ name: 'A', weight: 0.3 })], [v({ name: 'A', weight: 0.7 })])
    expect(ev).toEqual([{ variant: 'A', kind: 'peso', de: '0.3', para: '0.7', origem: 'manual' }])
  })

  it('peso do bandit carrega origem "bandit" (pra não parecer que você mexeu)', () => {
    const ev = diffVariants([v({ name: 'A', weight: 0.5 })], [v({ name: 'A', weight: 0.62 })], 'bandit')
    expect(ev[0]).toMatchObject({ kind: 'peso', origem: 'bandit', de: '0.5', para: '0.62' })
  })

  it('ativar e desativar', () => {
    expect(diffVariants([v({ name: 'A', enabled: true })], [v({ name: 'A', enabled: false })])[0].kind).toBe('desativada')
    expect(diffVariants([v({ name: 'A', enabled: false })], [v({ name: 'A', enabled: true })])[0].kind).toBe('ativada')
  })

  it('enabled ausente conta como ativa (JSON antigo não tinha o campo) → não gera evento falso', () => {
    const antes = [{ name: 'A', slug: 's', url: '/u', weight: 0.5 } as SbVariant]
    const depois = [{ name: 'A', slug: 's', url: '/u', weight: 0.5, enabled: true } as SbVariant]
    expect(diffVariants(antes, depois)).toEqual([])
  })

  it('url e slug alterados', () => {
    const ev = diffVariants(
      [v({ name: 'A', url: '/velha', slug: 'sv' })],
      [v({ name: 'A', url: '/nova', slug: 'sn' })],
    )
    expect(ev.map((e) => e.kind).sort()).toEqual(['slug', 'url'])
  })

  it('variante removida → evento (as impressões dela continuam no banco; o card precisa explicar o sumiço)', () => {
    const ev = diffVariants([v({ name: 'A' }), v({ name: 'B' })], [v({ name: 'A' })])
    expect(ev).toEqual([{ variant: 'B', kind: 'removida', de: null, para: null, origem: 'manual' }])
  })

  it('várias mudanças de uma vez, na mesma variante', () => {
    const ev = diffVariants(
      [v({ name: 'A', weight: 0.5, enabled: true, url: '/a' })],
      [v({ name: 'A', weight: 0, enabled: false, url: '/b' })],
    )
    expect(ev.map((e) => e.kind).sort()).toEqual(['desativada', 'peso', 'url'])
  })

  // Trava de ruído de float: 0.1+0.2 não pode virar "peso 0.30000000000000004 → 0.3".
  it('ruído de ponto flutuante não vira evento fantasma', () => {
    const ev = diffVariants([v({ name: 'A', weight: 0.1 + 0.2 })], [v({ name: 'A', weight: 0.3 })])
    expect(ev).toEqual([])
  })
})

describe('descreverEvento', () => {
  it('texto humano de cada tipo', () => {
    expect(descreverEvento({ kind: 'peso', de: '0.3', para: '0.7' })).toBe('Peso 0.3 → 0.7')
    expect(descreverEvento({ kind: 'criada', de: null, para: '0.5' })).toBe('Variante criada (peso 0.5)')
    expect(descreverEvento({ kind: 'desativada', de: null, para: null })).toBe('Variante desativada')
    expect(descreverEvento({ kind: 'removida', de: null, para: null })).toBe('Variante removida do teste')
  })
})
