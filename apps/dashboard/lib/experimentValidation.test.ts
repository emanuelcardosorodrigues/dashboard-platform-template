import { describe, expect, test } from 'vitest'
import { validatePageVariant, findDuplicateSlug } from './experimentValidation'

describe('validatePageVariant', () => {
  test('aceita URL válida independente do slug', () => {
    expect(validatePageVariant({ name: 'A', slug: 'qualquer-id', url: 'https://x.com/col-pv02/', weight: 0.5 }))
      .toEqual({ ok: true })
  })

  test('aceita URL com path /p/{x} mesmo com slug livre (teste Worker × WordPress)', () => {
    expect(validatePageVariant({ name: 'A', slug: 'variante-roxa', url: 'https://example.com/p/pcol-pvia01/', weight: 0.5 }))
      .toEqual({ ok: true })
  })

  test('rejeita URL inválida', () => {
    const r = validatePageVariant({ name: 'A', slug: 'A', url: 'not-a-url', weight: 0.5 })
    expect(r.ok).toBe(false)
  })

  test('aceita quando URL está vazia (retrocompat)', () => {
    expect(validatePageVariant({ name: 'A', slug: 'col-pv02', url: '', weight: 0.5 }))
      .toEqual({ ok: true })
  })
})

describe('findDuplicateSlug', () => {
  test('retorna null quando todos os slugs são únicos', () => {
    expect(findDuplicateSlug([{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }])).toBeNull()
  })

  test('retorna o slug duplicado', () => {
    expect(findDuplicateSlug([{ slug: 'a' }, { slug: 'b' }, { slug: 'a' }])).toBe('a')
  })

  test('ignora slugs vazios e whitespace', () => {
    expect(findDuplicateSlug([{ slug: '' }, { slug: '   ' }, { slug: 'a' }])).toBeNull()
  })

  test('trata trim ao comparar', () => {
    expect(findDuplicateSlug([{ slug: 'a' }, { slug: ' a ' }])).toBe('a')
  })
})
