import { describe, it, expect } from 'vitest'
import {
  taxaHotmartVenda,
  liquidoHotmartVenda,
  liquidoHotmartTransacoes,
  HOTMART_PCT,
  HOTMART_FIXA,
  HOTMART_VIDEO_ATE_97,
  HOTMART_VIDEO_ACIMA_97,
  HOTMART_LIMIAR_VIDEO,
} from './hotmartFees'

describe('constantes canônicas', () => {
  it('travam a decisão do dono do negócio (2026-07-02)', () => {
    expect(HOTMART_PCT).toBe(0.089)
    expect(HOTMART_FIXA).toBe(1.0)
    expect(HOTMART_VIDEO_ATE_97).toBe(0.3)
    expect(HOTMART_VIDEO_ACIMA_97).toBe(2.49)
    expect(HOTMART_LIMIAR_VIDEO).toBe(97)
  })
})

describe('taxaHotmartVenda', () => {
  it('v=47 → 0.089*47 + 1 + 0.30 = 5.483 (≤97 usa vídeo barato)', () => {
    expect(taxaHotmartVenda(47)).toBeCloseTo(5.483, 3)
  })
  it('v=97 → 8.633 + 1 + 0.30 = 9.933 (97 É ≤97, limiar inclusivo)', () => {
    expect(taxaHotmartVenda(97)).toBeCloseTo(9.933, 3)
  })
  it('v=297 → 26.433 + 1 + 2.49 = 29.923 (>97 usa vídeo caro)', () => {
    expect(taxaHotmartVenda(297)).toBeCloseTo(29.923, 3)
  })
  it('v=997 → 88.733 + 1 + 2.49 = 92.223', () => {
    expect(taxaHotmartVenda(997)).toBeCloseTo(92.223, 3)
  })
})

describe('liquidoHotmartVenda', () => {
  it('v=47 → líquido 41.517', () => {
    expect(liquidoHotmartVenda(47)).toBeCloseTo(41.517, 3)
  })
  it('v=97 → líquido 87.067', () => {
    expect(liquidoHotmartVenda(97)).toBeCloseTo(87.067, 3)
  })
  it('v=297 → líquido 267.077', () => {
    expect(liquidoHotmartVenda(297)).toBeCloseTo(267.077, 3)
  })
  it('v=997 → líquido 904.777', () => {
    expect(liquidoHotmartVenda(997)).toBeCloseTo(904.777, 3)
  })
})

describe('liquidoHotmartTransacoes', () => {
  it('soma o líquido POR transação (não sobre o agregado)', () => {
    // 47 (≤97, vídeo 0.30) + 297 (>97, vídeo 2.49)
    // líquidos: 41.517 + 267.077 = 308.594
    expect(liquidoHotmartTransacoes([47, 297])).toBeCloseTo(308.594, 3)
  })
  it('lista vazia → 0', () => {
    expect(liquidoHotmartTransacoes([])).toBe(0)
  })
  it('a soma por-transação difere do modelo agregado quando há mix de faixas', () => {
    // Mesmo bruto total (2 vendas de 97 = 194), mas o adicional de vídeo é por
    // transação: 2 × (≤97) → NÃO vira 1 × (>97).
    const porTransacao = liquidoHotmartTransacoes([97, 97])
    expect(porTransacao).toBeCloseTo(liquidoHotmartVenda(97) * 2, 6)
  })
})
