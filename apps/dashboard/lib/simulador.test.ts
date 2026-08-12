/**
 * Teste-oráculo do motor do simulador contra o LaunchSim Pro original.
 * O input abaixo é EXATAMENTE o dos prints de referência (Dados de Tráfego:
 * CPM 45 / CTR 1,2 / Connect 80 / Conv 5; verba 5000 90/5/5/0; canais 90/2/8/0;
 * 21 dias; OBs Gravação 197@5% e Ferramenta 19@15%; oferta Águia 6000@4%).
 * As saídas esperadas são os números RENDERIZADOS pelo app original em Base/A/B —
 * se algum floor()/fórmula divergir, o teste quebra.
 */
import { describe, it, expect } from 'vitest'
import { computeCenario, melhorCenario, safeDivide, estadoVazio, VARIACAO_CENARIO_A, VARIACAO_CENARIO_B } from './simulador'
import type { SimuladorState } from './acoesVendas'

const baseState = (variacao: SimuladorState['variacao']): SimuladorState => ({
  dadosTrafego: { cpm: 45, ctr: 1.2, connectRate: 80, txConversao: 5 },
  variacao,
  verbaTotal: 5000, metaIngressos: 0,
  distribuicaoVerba: { vendaIngressos: 90, vendaProduto: 5, distribuicaoConteudo: 5, rmktAquecimento: 0 },
  canaisVenda: { trafego: 90, organico: 2, baseInterna: 8, outrosCanais: 0 },
  diasCaptacao: 21,
  lotes: [{ nome: '', ticket: 0, vendas: 0 }],
  eventoOBs: [
    { nome: 'Gravação', ticket: 197, conversao: 5 },
    { nome: 'Ferramenta', ticket: 19, conversao: 15 },
  ],
  ofertaPrincipal: { nome: 'Programa Demonstrativo de Aceleração', ticket: 6000, conversao: 4 },
  produtoExtras: [],
})

const SEM_VARIACAO = { variacaoCpm: 0, variacaoCtr: 0, variacaoConnectRate: 0, variacaoTxConversao: 0 }

describe('computeCenario — oráculo vs LaunchSim (prints de referência)', () => {
  it('Cenário Base reproduz os números do print', () => {
    const r = computeCenario(baseState(SEM_VARIACAO))
    expect(r.vendasPorMil).toBeCloseTo(0.48, 5)
    expect(r.cpa).toBeCloseTo(93.75, 2)
    expect(r.verbaPorObjetivo.vendaIngressos).toBe(4500)
    expect(r.projecaoIngressos).toBe(48)
    expect(r.volumeCanais).toEqual({ trafego: 43, organico: 0, baseInterna: 3, outrosCanais: 0 })
    expect(r.totalIngressos).toBe(46)
    expect(r.mediaVendasDia).toBeCloseTo(2.19, 2)
    expect(r.cpaTrafego).toBeCloseTo(104.65, 2)
    expect(r.cpaGlobal).toBeCloseTo(97.83, 2)
    // eventoOBs
    expect(r.eventoOBs[0]).toEqual({ nome: 'Gravação', vendas: 2, faturamento: 394 })
    expect(r.eventoOBs[1]).toEqual({ nome: 'Ferramenta', vendas: 6, faturamento: 114 })
    expect(r.eventoSubtotal).toBe(508)
    // oferta principal
    expect(r.ofertaPrincipal).toEqual({ vendas: 1, faturamento: 6000 })
    expect(r.produtoSubtotal).toBe(6000)
    // totais
    expect(r.faturamentoTotal).toBe(6508)
    expect(r.roas).toBeCloseTo(1.3016, 4)
  })

  it('Cenário A reproduz os números do print', () => {
    const r = computeCenario(baseState(VARIACAO_CENARIO_A))
    expect(r.cpa).toBeCloseTo(66.41, 2)
    expect(r.projecaoIngressos).toBe(67)
    expect(r.totalIngressos).toBe(66)
    expect(r.eventoSubtotal).toBe(762)        // 3*197 + 9*19
    expect(r.ofertaPrincipal.faturamento).toBe(12000) // 2*6000
    expect(r.faturamentoTotal).toBe(12762)
    expect(r.roas).toBeCloseTo(2.5524, 4)
  })

  it('Cenário B reproduz os números do print', () => {
    const r = computeCenario(baseState(VARIACAO_CENARIO_B))
    expect(r.cpa).toBeCloseTo(47.35, 2)
    expect(r.projecaoIngressos).toBe(95)
    expect(r.totalIngressos).toBe(93)
    expect(r.eventoSubtotal).toBe(1035)       // 4*197 + 13*19
    expect(r.ofertaPrincipal.faturamento).toBe(18000) // 3*6000
    expect(r.faturamentoTotal).toBe(19035)
    expect(r.roas).toBeCloseTo(3.807, 3)
  })
})

describe('safeDivide e robustez', () => {
  it('divisão por zero retorna fallback', () => {
    expect(safeDivide(10, 0)).toBe(0)
    expect(safeDivide(10, 0, -1)).toBe(-1)
    expect(safeDivide(10, 2)).toBe(5)
  })

  it('estado vazio não quebra (sem Infinity/NaN)', () => {
    const r = computeCenario(estadoVazio())
    expect(r.cpa).toBe(0)
    expect(r.projecaoIngressos).toBe(0)
    expect(r.totalIngressos).toBe(0)
    expect(r.faturamentoTotal).toBe(0)
    expect(r.roas).toBe(0)
    expect(Number.isFinite(r.cpaGlobal)).toBe(true)
  })
})

describe('melhorCenario', () => {
  const mk = (id: string, kind: 'simulado' | 'real', variacao: SimuladorState['variacao']) =>
    ({ id, kind, estado: baseState(variacao) })

  it('escolhe o simulado de maior ROAS (B > A > Base)', () => {
    const cs = [mk('base', 'simulado', SEM_VARIACAO), mk('a', 'simulado', VARIACAO_CENARIO_A), mk('b', 'simulado', VARIACAO_CENARIO_B)]
    expect(melhorCenario(cs)).toBe('b')
  })

  it('ignora o cenário real (não concorre)', () => {
    const cs = [mk('base', 'simulado', SEM_VARIACAO), mk('real', 'real', VARIACAO_CENARIO_B)]
    expect(melhorCenario(cs)).toBe('base')
  })

  it('retorna null se nenhum simulado válido', () => {
    expect(melhorCenario([{ id: 'r', kind: 'real', estado: estadoVazio() }])).toBeNull()
    expect(melhorCenario([{ id: 'z', kind: 'simulado', estado: estadoVazio() }])).toBeNull() // roas 0
  })
})
