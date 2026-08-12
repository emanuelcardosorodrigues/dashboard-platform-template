import { describe, test, expect } from 'vitest'
import { getClarityColor, getSemaforoColorForFunil } from './thresholds'

describe('getClarityColor', () => {
  test('rage_clicks 0.5% = verde', () => {
    expect(getClarityColor('rage_clicks_pct', 0.5)).toBe('green')
  })
  test('rage_clicks 2% = amarelo', () => {
    expect(getClarityColor('rage_clicks_pct', 2)).toBe('yellow')
  })
  test('rage_clicks 10% = vermelho', () => {
    expect(getClarityColor('rage_clicks_pct', 10)).toBe('red')
  })

  test('scroll_depth 80% = verde (invertido)', () => {
    expect(getClarityColor('scroll_depth_pct', 80)).toBe('green')
  })
  test('scroll_depth 55% = amarelo', () => {
    expect(getClarityColor('scroll_depth_pct', 55)).toBe('yellow')
  })
  test('scroll_depth 20% = vermelho', () => {
    expect(getClarityColor('scroll_depth_pct', 20)).toBe('red')
  })

  test('engagement_sec 90s = verde', () => {
    expect(getClarityColor('engagement_sec', 90)).toBe('green')
  })
  test('engagement_sec 10s = vermelho', () => {
    expect(getClarityColor('engagement_sec', 10)).toBe('red')
  })
})

describe('getSemaforoColorForFunil — CPA relativo ao ticket FE', () => {
  // Ticket FE de R$ 250 → verde ≤ R$ 100 (40%), amarelo R$ 100-175 (40-70%), vermelho ≥ R$ 175 (70%)
  test('CPA = 40% do ticket → verde (borda)', () => {
    expect(getSemaforoColorForFunil('cpa', 100, undefined, 250)).toBe('green')
  })
  test('CPA = 25% do ticket → verde', () => {
    expect(getSemaforoColorForFunil('cpa', 62.5, undefined, 250)).toBe('green')
  })
  test('CPA = 50% do ticket → amarelo', () => {
    expect(getSemaforoColorForFunil('cpa', 125, undefined, 250)).toBe('yellow')
  })
  test('CPA = 70% do ticket → vermelho (borda)', () => {
    expect(getSemaforoColorForFunil('cpa', 175, undefined, 250)).toBe('red')
  })
  test('CPA > 70% do ticket → vermelho', () => {
    expect(getSemaforoColorForFunil('cpa', 200, undefined, 250)).toBe('red')
  })
  test('CPA = 0 → vermelho (sem dados)', () => {
    expect(getSemaforoColorForFunil('cpa', 0, undefined, 250)).toBe('red')
  })
  test('ticketFE = 0 cai no fallback absoluto (CPA 30 ≤ 50 → verde)', () => {
    expect(getSemaforoColorForFunil('cpa', 30, undefined, 0)).toBe('green')
  })
  test('ticketFE undefined cai no fallback absoluto (CPA 80 → amarelo)', () => {
    expect(getSemaforoColorForFunil('cpa', 80)).toBe('yellow')
  })
  test('funil informado não influencia mais o CPA (usa o ticket)', () => {
    expect(getSemaforoColorForFunil('cpa', 80, 'col-', 250)).toBe('green')
  })
})

describe('getSemaforoColorForFunil — métricas não-CPA', () => {
  test('ROAS 2.0 = verde', () => {
    expect(getSemaforoColorForFunil('roasLiquido', 2.0)).toBe('green')
  })
  test('ROAS 1.2 = amarelo', () => {
    expect(getSemaforoColorForFunil('roasLiquido', 1.2)).toBe('yellow')
  })
  test('ROAS 0.5 = vermelho', () => {
    expect(getSemaforoColorForFunil('roasLiquido', 0.5)).toBe('red')
  })
  test('CTR 2.0 = verde', () => {
    expect(getSemaforoColorForFunil('ctr', 2.0)).toBe('green')
  })
})
