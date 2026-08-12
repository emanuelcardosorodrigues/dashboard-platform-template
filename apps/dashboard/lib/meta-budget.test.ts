import { describe, test, expect } from 'vitest'
import { parseReaisToCents } from './meta-budget'

describe('parseReaisToCents — parsing estrito pt-BR (caminho de dinheiro)', () => {
  test('inteiro puro', () => {
    expect(parseReaisToCents('1500')).toBe(150000)
    expect(parseReaisToCents('1')).toBe(100)
  })

  test('milhares com ponto', () => {
    expect(parseReaisToCents('1.500')).toBe(150000)
    expect(parseReaisToCents('12.345.678')).toBe(1234567800)
  })

  test('decimal com vírgula', () => {
    expect(parseReaisToCents('1500,50')).toBe(150050)
    expect(parseReaisToCents('1.500,50')).toBe(150050)
    expect(parseReaisToCents('1,5')).toBe(150)
    expect(parseReaisToCents('0,99')).toBe(99)
  })

  test('ESPAÇOS nas pontas são tolerados', () => {
    expect(parseReaisToCents('  1.500,00 ')).toBe(150000)
  })

  // ── O bug de 100x e amigos: tudo isso DEVE virar null ──────────────────────
  test('rejeita US-style (ponto como decimal) — anti bug de 100x', () => {
    expect(parseReaisToCents('1500.50')).toBeNull()
    expect(parseReaisToCents('1.50')).toBeNull()      // ambíguo: ponto+2 dígitos
    expect(parseReaisToCents('12.34.56')).toBeNull()  // pontuação maluca
    expect(parseReaisToCents('1.5000')).toBeNull()    // grupo de milhar inválido
  })

  test('rejeita vazio / não-numérico / zero / negativo', () => {
    expect(parseReaisToCents('')).toBeNull()
    expect(parseReaisToCents('   ')).toBeNull()
    expect(parseReaisToCents('abc')).toBeNull()
    expect(parseReaisToCents('R$ 1500')).toBeNull()   // símbolo no texto
    expect(parseReaisToCents('0')).toBeNull()
    expect(parseReaisToCents('0,00')).toBeNull()
    expect(parseReaisToCents('-5')).toBeNull()
    expect(parseReaisToCents('1500,999')).toBeNull()  // 3 casas decimais
  })
})
