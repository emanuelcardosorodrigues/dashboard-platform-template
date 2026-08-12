import { describe, test, expect } from 'vitest'
import { parseIsoDuration, formatFromDuration } from './youtube'

describe('parseIsoDuration', () => {
  test('horas+minutos+segundos', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723)
  })
  test('só minutos', () => {
    expect(parseIsoDuration('PT15M')).toBe(900)
  })
  test('só segundos (Short)', () => {
    expect(parseIsoDuration('PT58S')).toBe(58)
  })
  test('inválido → null (gap honesto, não 0)', () => {
    expect(parseIsoDuration('P1D')).toBeNull()
    expect(parseIsoDuration(undefined)).toBeNull()
    expect(parseIsoDuration('')).toBeNull()
  })
})

describe('formatFromDuration', () => {
  test('≤183s = short (Shorts vão até 3min desde out/2024)', () => {
    expect(formatFromDuration(58)).toBe('short')
    expect(formatFromDuration(183)).toBe('short')
  })
  test('>183s = long', () => {
    expect(formatFromDuration(184)).toBe('long')
    expect(formatFromDuration(1200)).toBe('long')
  })
  test('duração desconhecida = long (não chutar short)', () => {
    expect(formatFromDuration(null)).toBe('long')
  })
})
