import { describe, it, expect } from 'vitest'
import { calcLucroBrutoPlano, aggregaInvestimentoPorSigla, snapshotPrevisto, buildComparacao, type CenarioReal } from './planejamento'
import { computeCenario } from './simulador'
import type { SbMetaAds } from './supabase'
import type { ImpostoConfig, SimuladorState, AcaoAnalise } from './acoesVendas'

const CFG: ImpostoConfig = { imposto_faturamento_pct: 0.06, hotmart_pct_fee: 0.084, hotmart_fixed_fee: 3.49 }

describe('calcLucroBrutoPlano', () => {
  it('subtrai investimento + imposto faturamento + taxas Hotmart', () => {
    const r = calcLucroBrutoPlano(10000, 3000, 50, CFG)
    expect(r.impostoFaturamento).toBeCloseTo(600, 6)          // 6% de 10000
    expect(r.taxasHotmart).toBeCloseTo(10000 * 0.084 + 50 * 3.49, 6) // 840 + 174.5 = 1014.5
    expect(r.lucroBruto).toBeCloseTo(10000 - 3000 - 600 - 1014.5, 6) // 5385.5
  })
  it('não duplica imposto Meta — investimento entra como veio (já com taxRate)', () => {
    // investimento real já vem taxado; a função NÃO remultiplica
    const r = calcLucroBrutoPlano(10000, 1138.2, 10, { ...CFG, imposto_faturamento_pct: 0 })
    expect(r.lucroBruto).toBeCloseTo(10000 - 1138.2 - (840 + 34.9), 6)
  })
})

const meta = (over: Partial<SbMetaAds>): SbMetaAds => ({
  data: '2026-06-10', criativo: '', ad_name: '', ad_id: 'a1', campaign_name: '', adset_name: '',
  investimento: 100, impressoes: 0, alcance: 0, views_3seg: 0, views_95pct: 0, cliques_link: 0,
  landing_views: 0, checkouts: 0, compras: 0, valor_compras: 0, preview_url: null, ...over,
})

describe('aggregaInvestimentoPorSigla — word-boundary', () => {
  it("'LP' NÃO casa 'HELP' (evita colisão de substring)", () => {
    const rows = [meta({ campaign_name: 'HELP Lançamento', investimento: 500, ad_id: 'x' })]
    expect(aggregaInvestimentoPorSigla(rows, 'LP', null, null).investimento).toBe(0)
  })
  it('casa a sigla isolada no nome da campanha/conjunto/anúncio', () => {
    const rows = [
      meta({ campaign_name: 'LANC2406 - frio', investimento: 300, ad_id: 'a' }),
      meta({ adset_name: 'cj lanc2406 retgt', investimento: 200, ad_id: 'b' }),
      meta({ campaign_name: 'outra campanha', investimento: 999, ad_id: 'c' }),
    ]
    const r = aggregaInvestimentoPorSigla(rows, 'LANC2406', null, null)
    expect(r.investimento).toBe(500)
    expect(r.ads).toBe(2)
    expect(r.linhas).toBe(2)
  })
  it('respeita a janela de datas', () => {
    const rows = [
      meta({ data: '2026-06-01', campaign_name: 'LANC2406', investimento: 100, ad_id: 'a' }),
      meta({ data: '2026-06-15', campaign_name: 'LANC2406', investimento: 100, ad_id: 'b' }),
    ]
    expect(aggregaInvestimentoPorSigla(rows, 'LANC2406', '2026-06-10', '2026-06-20').investimento).toBe(100)
  })
  it('sigla < 3 chars não casa nada', () => {
    expect(aggregaInvestimentoPorSigla([meta({ campaign_name: 'LP' })], 'LP', null, null).investimento).toBe(0)
  })
})

// Estado base dos prints (mesmo do simulador.test)
const baseState: SimuladorState = {
  dadosTrafego: { cpm: 45, ctr: 1.2, connectRate: 80, txConversao: 5 },
  variacao: { variacaoCpm: 0, variacaoCtr: 0, variacaoConnectRate: 0, variacaoTxConversao: 0 },
  verbaTotal: 5000, metaIngressos: 0,
  distribuicaoVerba: { vendaIngressos: 90, vendaProduto: 5, distribuicaoConteudo: 5, rmktAquecimento: 0 },
  canaisVenda: { trafego: 90, organico: 2, baseInterna: 8, outrosCanais: 0 },
  diasCaptacao: 21,
  lotes: [{ nome: 'Lote 1', ticket: 100, vendas: 100 }],
  eventoOBs: [{ nome: 'Gravação', ticket: 197, conversao: 5 }],
  ofertaPrincipal: { nome: 'Águia', ticket: 6000, conversao: 4 },
  produtoExtras: [],
}

const analiseVazia = (over: Partial<AcaoAnalise>): AcaoAnalise => ({
  vendasFront: 0, vendasTotais: 0, faturamentoFront: 0, faturamentoTotal: 0, receitaLiquida: 0,
  ticketMedio: 0, dias: 1, paceDiarioVendas: 0, paceSemanalVendas: 0, takeRateOB: 0,
  serie: [], porDiaSemana: [], porHora: [], topCriativos: [], breakdown: [], metas: [], ...over,
})

describe('snapshotPrevisto + buildComparacao (3 colunas)', () => {
  it('previsto vem do cenário Base', () => {
    const d = computeCenario(baseState)
    const snap = snapshotPrevisto(d, baseState.verbaTotal, CFG)
    expect(snap.investimento).toBe(5000)
    expect(snap.vendas).toBe(d.totalIngressos)
    expect(snap.faturamento).toBe(d.faturamentoTotal)
    expect(snap.roas).toBeCloseTo(d.roas, 6)
  })

  it('comparação respeita checklist e projeta previsão pelo pace', () => {
    const d = computeCenario(baseState)
    const previsto = snapshotPrevisto(d, baseState.verbaTotal, CFG)
    // realizado na metade do período (15 de 30 dias), faturamento = metade do previsto
    const real: CenarioReal = {
      analise: analiseVazia({ vendasFront: Math.round(previsto.vendas / 2), vendasTotais: Math.round(previsto.vendas / 2), faturamentoTotal: previsto.faturamento / 2 }),
      investimento: 2500, faturamento: previsto.faturamento / 2,
      lucro: calcLucroBrutoPlano(previsto.faturamento / 2, 2500, 1, CFG),
      roas: (previsto.faturamento / 2) / 2500, fonteInvestimento: 'sigla', matchMeta: { linhas: 3, ads: 2 },
    }
    const linhas = buildComparacao(previsto, real, CFG, { diasDecorridos: 15, diasTotais: 30 }, { investimento: false })
    // checklist ocultou 'investimento'
    expect(linhas.find((l) => l.key === 'investimento')).toBeUndefined()
    // previsão de faturamento ≈ realizado * 2 (pace linear na metade do período) ≈ previsto
    const fat = linhas.find((l) => l.key === 'faturamento')!
    expect(fat.previsao).toBeCloseTo(previsto.faturamento, 0)
    expect(fat.realizado).toBeCloseTo(previsto.faturamento / 2, 0)
    expect(fat.semaforo).toBeTruthy()
  })
})
