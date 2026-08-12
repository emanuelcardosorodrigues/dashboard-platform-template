/**
 * Teste-oráculo do motor de funil contra a planilha "Centro de Planejamento e
 * Projeção Financeira e de Funis" (coluna Projeção do funil COL / Low Ticket).
 * Inputs e saídas conferidos célula a célula na planilha.
 */
import { describe, it, expect } from 'vitest'
import { computeFunil, calcFinanceiroFunil, type FunilState } from './funilEngine'
import type { ImpostoConfig } from './acoesVendas'

const colState: FunilState = {
  investimento: 50000,
  cpm: 33.16, ctr: 1.9, carregamento: 78.2, playRate: 0,
  passagem: 23.8, convCheckout: 22.5,
  ticketPrincipal: 67, metaVendas: 0,
  orderBumps: [
    { nome: 'OB1 Script Anti-Desconto', ticket: 29.9, conversao: 6.4 },
    { nome: 'OB2 Lucro Tributário', ticket: 47, conversao: 5.8 },
    { nome: 'OB3 Dentista Parceiro', ticket: 67, conversao: 4.7 },
    { nome: 'OB4 Manual Lucro Oculto', ticket: 37, conversao: 1.7 },
  ],
  upsells: [],
  ascensao: { nome: 'Ascensão W', comparecimento: 20, conversao: 3, ticket: 297 },
  usaLotes: false, lotes: [],
  variacao: {},
}

describe('computeFunil — oráculo vs planilha (COL / Low Ticket, coluna Projeção)', () => {
  const d = computeFunil(colState, 'low_ticket')
  it('cadeia de tráfego bate célula a célula', () => {
    expect(d.impressoes).toBeCloseTo(1507840.77, 0)
    expect(d.cliques).toBeCloseTo(28648.97, 0)
    expect(d.visualizacoes).toBeCloseTo(22403.50, 0)
    expect(d.inicioCheckout).toBeCloseTo(5332.03, 0)
  })
  it('vendas e faturamento principal batem', () => {
    expect(d.vendasPrincipal).toBeCloseTo(1199.71, 1)
    expect(d.faturamentoPrincipal).toBeCloseTo(80380.39, 0)
  })
  it('CPA do funil bate (R$ 41,68)', () => {
    expect(d.cpa).toBeCloseTo(41.68, 1)
    expect(d.cpaEstimado).toBeCloseTo(41.68, 1) // mesma cadeia → CPA estimado == CPA real
  })
  it('order bumps batem (vendas e faturamento)', () => {
    expect(d.orderBumps[0].vendas).toBeCloseTo(76.78, 0)   // 6.4% de 1199.71
    expect(d.orderBumps[0].faturamento).toBeCloseTo(2295.76, 0)
    expect(d.orderBumps[1].faturamento).toBeCloseTo(3270.40, 0)
  })
})

describe('calcFinanceiroFunil — imposto 6% + taxas Hotmart', () => {
  it('imposto = 6% do faturamento total', () => {
    const d = computeFunil(colState, 'low_ticket')
    const cfg: ImpostoConfig = { imposto_faturamento_pct: 0.06, hotmart_pct_fee: 0.084, hotmart_fixed_fee: 1.3 }
    const f = calcFinanceiroFunil(d, cfg)
    expect(f.imposto).toBeCloseTo(d.faturamentoTotal * 0.06, 4)
    expect(f.margemContribuicao).toBeLessThan(d.faturamentoTotal)
  })
})
