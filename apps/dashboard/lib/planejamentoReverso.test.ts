import { describe, it, expect } from 'vitest'
import { computeReverso } from './planejamentoReverso'
import { calcLucroBrutoPlano } from './planejamento'
import type { ImpostoConfig, SimuladorState } from './acoesVendas'

const cfg: ImpostoConfig = { imposto_faturamento_pct: 0.06, hotmart_pct_fee: 0.084, hotmart_fixed_fee: 3.49 }

const baseState = (over: Partial<SimuladorState> = {}): SimuladorState => ({
  dadosTrafego: { cpm: 45, ctr: 1.2, connectRate: 80, txConversao: 5 },
  variacao: { variacaoCpm: 0, variacaoCtr: 0, variacaoConnectRate: 0, variacaoTxConversao: 0 },
  verbaTotal: 50000,
  metaIngressos: 0,
  distribuicaoVerba: { vendaIngressos: 100, vendaProduto: 0, distribuicaoConteudo: 0, rmktAquecimento: 0 },
  canaisVenda: { trafego: 100, organico: 0, baseInterna: 0, outrosCanais: 0 },
  diasCaptacao: 21,
  lotes: [], eventoOBs: [], produtoExtras: [],
  ofertaPrincipal: { nome: 'Principal', ticket: 2000, conversao: 5 },
  modo: 'meta',
  metaLucro: 100000,
  ...over,
})

const vpm = (ctr: number, conn: number, conv: number) => (ctr / 100) * 1000 * (conn / 100) * (conv / 100)

describe('computeReverso', () => {
  it('round-trip: o faturamento necessário gera exatamente a meta de lucro', () => {
    const r = computeReverso(baseState(), cfg)
    expect(r.viavel).toBe(true)
    // vendas exatas (sem arredondar) = faturamento / preço → valida a fórmula fechada
    const vendasExatas = r.faturamentoNecessario / r.precoPrincipal
    const { lucroBruto } = calcLucroBrutoPlano(r.faturamentoNecessario, r.investimento, vendasExatas, cfg)
    expect(lucroBruto).toBeCloseTo(100000, 2)
  })

  it('CPA máximo = investimento ÷ ingressos necessários', () => {
    const r = computeReverso(baseState(), cfg)
    expect(r.cpaMaximo).toBeCloseTo(r.investimento / r.ingressosNecessarios, 6)
    expect(r.ingressosNecessarios).toBeGreaterThan(0)
  })

  it('cada meta de métrica, segurando as outras 3, reproduz o CPA máximo', () => {
    const r = computeReverso(baseState(), cfg)
    const { ctr, connectRate, conversaoPagina, cpm } = r.metas
    // CTR meta (com connect/conv atuais)
    expect(45 / vpm(ctr.meta, connectRate.atual, conversaoPagina.atual)).toBeCloseTo(r.cpaMaximo, 4)
    // Connect meta
    expect(45 / vpm(ctr.atual, connectRate.meta, conversaoPagina.atual)).toBeCloseTo(r.cpaMaximo, 4)
    // Conversão da página meta
    expect(45 / vpm(ctr.atual, connectRate.atual, conversaoPagina.meta)).toBeCloseTo(r.cpaMaximo, 4)
    // CPM meta (máximo permitido) com funil atual
    expect(cpm.meta / vpm(ctr.atual, connectRate.atual, conversaoPagina.atual)).toBeCloseTo(r.cpaMaximo, 4)
  })

  it('marca "bate" quando o CPA projetado do funil atual <= CPA máximo', () => {
    const r = computeReverso(baseState(), cfg)
    const cpaProj = 45 / vpm(1.2, 80, 5)
    expect(r.cpaProjetado).toBeCloseTo(cpaProj, 4)
    expect(r.bate).toBe(cpaProj <= r.cpaMaximo)
  })

  it('inviável sem meta de lucro / sem principal / sem investimento', () => {
    expect(computeReverso(baseState({ metaLucro: 0 }), cfg).viavel).toBe(false)
    expect(computeReverso(baseState({ ofertaPrincipal: { nome: '', ticket: 0, conversao: 0 } }), cfg).viavel).toBe(false)
    expect(computeReverso(baseState({ verbaTotal: 0 }), cfg).viavel).toBe(false)
  })
})
