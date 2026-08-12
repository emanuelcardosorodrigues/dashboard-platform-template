/**
 * Motor do simulador de Lançamento Pago — port determinístico do LaunchSim Pro.
 * Funções PURAS, zero I/O ([[feedback_hardcode_over_ai]]). Testado contra o bundle
 * original em lib/simulador.test.ts (teste-oráculo).
 *
 * Fonte das fórmulas: bundle main.5f1dce16.js do LaunchSim Pro
 * Funções de cálculo isoladas para simulação de cenários.
 * Cada `floor()` reproduz exatamente a ordem do original — se a versão mudar, revalidar o oráculo.
 */
import type { SimuladorState, CenarioDerivado } from './acoesVendas'

/** Aplica variação percentual ao valor base (cenário Base usa pct = 0). */
export const aplicarVariacao = (base: number, pct: number): number => base * (1 + pct / 100)

/** Divisão segura — denominador 0 retorna fallback (evita Infinity/NaN). */
export const safeDivide = (n: number, d: number, fb = 0): number => (d === 0 ? fb : n / d)

/** Calcula todos os derivados de um cenário a partir do seu estado. */
export function computeCenario(s: SimuladorState): CenarioDerivado {
  // 1) Tráfego com variação aplicada (Base = variação 0)
  const cpm = aplicarVariacao(s.dadosTrafego.cpm, s.variacao.variacaoCpm)
  const ctr = aplicarVariacao(s.dadosTrafego.ctr, s.variacao.variacaoCtr)
  const connectRate = aplicarVariacao(s.dadosTrafego.connectRate, s.variacao.variacaoConnectRate)
  const txConversao = aplicarVariacao(s.dadosTrafego.txConversao, s.variacao.variacaoTxConversao)

  const vendasPorMil = (ctr / 100) * 1000 * (connectRate / 100) * (txConversao / 100)
  const cpa = safeDivide(cpm, vendasPorMil)

  // 2) Distribuição da verba (R$ por objetivo)
  const d = s.distribuicaoVerba
  const verbaPorObjetivo = {
    vendaIngressos: s.verbaTotal * (d.vendaIngressos / 100),
    vendaProduto: s.verbaTotal * (d.vendaProduto / 100),
    distribuicaoConteudo: s.verbaTotal * (d.distribuicaoConteudo / 100),
    rmktAquecimento: s.verbaTotal * (d.rmktAquecimento / 100),
  }

  // 3) Projeção de ingressos (verba de ingressos / CPA)
  const projecaoIngressos = cpa > 0 ? Math.floor(verbaPorObjetivo.vendaIngressos / cpa) : 0

  // 4) Volume por canal (floor) e total
  const c = s.canaisVenda
  const volumeCanais = {
    trafego: Math.floor(projecaoIngressos * (c.trafego / 100)),
    organico: Math.floor(projecaoIngressos * (c.organico / 100)),
    baseInterna: Math.floor(projecaoIngressos * (c.baseInterna / 100)),
    outrosCanais: Math.floor(projecaoIngressos * (c.outrosCanais / 100)),
  }
  const totalIngressos = volumeCanais.trafego + volumeCanais.organico + volumeCanais.baseInterna + volumeCanais.outrosCanais

  const mediaVendasDia = safeDivide(totalIngressos, s.diasCaptacao)
  const cpaTrafego = safeDivide(verbaPorObjetivo.vendaIngressos, volumeCanais.trafego)
  const cpaGlobal = safeDivide(verbaPorObjetivo.vendaIngressos, totalIngressos)

  // 5) Lotes (ingressos por lote = floor(total * vendas%); faturamento = ingressos * ticket)
  const lotes = s.lotes.map((l) => {
    const ingressos = Math.floor(totalIngressos * (l.vendas / 100))
    return { nome: l.nome, ingressos, faturamento: ingressos * l.ticket }
  })
  const faturamentoIngressos = lotes.reduce((acc, l) => acc + l.faturamento, 0)
  // ticketMedio = média ponderada do ticket pelos % de vendas dos lotes
  const somaVendasPct = s.lotes.reduce((acc, l) => acc + l.vendas, 0)
  const ticketMedio = somaVendasPct > 0 ? s.lotes.reduce((acc, l) => acc + (l.ticket * l.vendas) / somaVendasPct, 0) : 0

  // 6) Order bumps do evento (conversão sobre o total de ingressos)
  const eventoOBs = s.eventoOBs.map((ob) => {
    const vendas = Math.floor(totalIngressos * (ob.conversao / 100))
    return { nome: ob.nome, vendas, faturamento: vendas * ob.ticket }
  })
  const eventoSubtotal = faturamentoIngressos + eventoOBs.reduce((acc, ob) => acc + ob.faturamento, 0)

  // 7) Produto: oferta principal (conv sobre ingressos) + extras (conv sobre vendas da oferta)
  const ofVendas = Math.floor(totalIngressos * (s.ofertaPrincipal.conversao / 100))
  const ofertaPrincipal = { vendas: ofVendas, faturamento: ofVendas * s.ofertaPrincipal.ticket }
  const produtoExtras = s.produtoExtras.map((e) => {
    const vendas = Math.floor(ofVendas * (e.conversao / 100))
    return { nome: e.nome, vendas, faturamento: vendas * e.ticket }
  })
  const produtoSubtotal = ofertaPrincipal.faturamento + produtoExtras.reduce((acc, e) => acc + e.faturamento, 0)

  // 8) Totais
  const faturamentoTotal = eventoSubtotal + produtoSubtotal
  const roas = safeDivide(faturamentoTotal, s.verbaTotal)

  return {
    vendasPorMil, cpa, verbaPorObjetivo, projecaoIngressos, volumeCanais, totalIngressos,
    mediaVendasDia, cpaTrafego, cpaGlobal, lotes, ticketMedio, faturamentoIngressos,
    eventoOBs, eventoSubtotal, ofertaPrincipal, produtoExtras, produtoSubtotal,
    faturamentoTotal, roas,
  }
}

/**
 * Id do melhor cenário SIMULADO (maior ROAS). O 'real' nunca concorre (não é projeção)
 * e cenários com roas <= 0 são ignorados. Retorna null se nenhum válido (sem throw).
 */
export function melhorCenario(cenarios: { id: string; kind: 'simulado' | 'real'; estado: SimuladorState }[]): string | null {
  let melhorId: string | null = null
  let melhorRoas = 0
  for (const c of cenarios) {
    if (c.kind !== 'simulado') continue
    const { roas } = computeCenario(c.estado)
    if (roas > melhorRoas) { melhorRoas = roas; melhorId = c.id }
  }
  return melhorId
}

/** Estado inicial em branco de um cenário (espelha o default do LaunchSim). */
export function estadoVazio(): SimuladorState {
  return {
    dadosTrafego: { cpm: 0, ctr: 0, connectRate: 0, txConversao: 0 },
    variacao: { variacaoCpm: 0, variacaoCtr: 0, variacaoConnectRate: 0, variacaoTxConversao: 0 },
    verbaTotal: 0,
    metaIngressos: 0,
    distribuicaoVerba: { vendaIngressos: 0, vendaProduto: 0, distribuicaoConteudo: 0, rmktAquecimento: 0 },
    canaisVenda: { trafego: 0, organico: 0, baseInterna: 0, outrosCanais: 0 },
    diasCaptacao: 0,
    lotes: [{ nome: '', ticket: 0, vendas: 0 }],
    eventoOBs: [],
    ofertaPrincipal: { nome: '', ticket: 0, conversao: 0 },
    produtoExtras: [],
  }
}

/** Variações default dos cenários A e B (do LaunchSim). */
export const VARIACAO_CENARIO_A = { variacaoCpm: -10, variacaoCtr: 10, variacaoConnectRate: 5, variacaoTxConversao: 10 }
export const VARIACAO_CENARIO_B = { variacaoCpm: -20, variacaoCtr: 20, variacaoConnectRate: 10, variacaoTxConversao: 20 }

/**
 * Normaliza um estado vindo do banco (jsonb que pode estar vazio/parcial) para um
 * SimuladorState completo — defende computeCenario de `estado: {}` (default da coluna).
 */
export function normalizeEstado(raw: Partial<SimuladorState> | null | undefined): SimuladorState {
  const base = estadoVazio()
  if (!raw || typeof raw !== 'object') return base
  return {
    dadosTrafego: { ...base.dadosTrafego, ...(raw.dadosTrafego ?? {}) },
    variacao: { ...base.variacao, ...(raw.variacao ?? {}) },
    verbaTotal: typeof raw.verbaTotal === 'number' ? raw.verbaTotal : 0,
    metaIngressos: typeof raw.metaIngressos === 'number' ? raw.metaIngressos : 0,
    distribuicaoVerba: { ...base.distribuicaoVerba, ...(raw.distribuicaoVerba ?? {}) },
    canaisVenda: { ...base.canaisVenda, ...(raw.canaisVenda ?? {}) },
    diasCaptacao: typeof raw.diasCaptacao === 'number' ? raw.diasCaptacao : 0,
    lotes: Array.isArray(raw.lotes) && raw.lotes.length ? raw.lotes : base.lotes,
    eventoOBs: Array.isArray(raw.eventoOBs) ? raw.eventoOBs : [],
    ofertaPrincipal: { ...base.ofertaPrincipal, ...(raw.ofertaPrincipal ?? {}) },
    produtoExtras: Array.isArray(raw.produtoExtras) ? raw.produtoExtras : [],
  }
}
