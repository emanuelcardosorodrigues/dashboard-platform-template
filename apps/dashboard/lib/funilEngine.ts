/**
 * Motor de funil UNIFICADO (v2) — porta as fórmulas de PROJEÇÃO da planilha
 * "Centro de Planejamento e Projeção Financeira e de Funis" (fonte da verdade do DEMO).
 * Um só modelo cobre os 3 tipos (Low Ticket, VSL, Lançamento Pago); o que muda é
 * quais estágios do funil aparecem. Determinístico ([[feedback_hardcode_over_ai]]).
 *
 * Cadeia (forward / Projeção):
 *   Investimento ÷ CPM → Impressões → ×CTR → Cliques → ×Carregamento → Visualizações
 *   → [VSL: ×PlayRate → Plays] → ×Passagem → Início Checkout → ×ConvCheckout → Vendas Principal
 *   → cascata de OBs/upsells (sobre vendas principal) → Ascensão (webinário/workshop)
 * NÃO usa floor (a planilha trabalha com frações em projeção); arredonda só na exibição.
 */
import type { AcaoTipo, CenarioDerivado, ImpostoConfig, SimuladorState } from './acoesVendas'
import { aplicarVariacao, safeDivide, computeCenario, normalizeEstado } from './simulador'

export type FunilTipo = AcaoTipo
type Oferta = { nome: string; ticket: number; conversao: number }

export interface FunilState {
  investimento: number            // Meta de Investimento (verba do funil)
  // Tráfego (comum)
  cpm: number
  ctr: number                     // % CTR link
  carregamento: number            // % carregamento da página (≈ connect rate)
  // VSL
  playRate: number                // % (só VSL)
  // Página de vendas / pós-play
  passagem: number                // % passagem da página → início checkout
  convCheckout: number            // % conversão do checkout → venda
  // Produto principal
  ticketPrincipal: number
  metaVendas: number              // meta de vendas do front (p/ CPA máximo vs estimado). 0 = sem meta
  // Cascata (conversão = % sobre Vendas Principal)
  orderBumps: Oferta[]
  upsells: Oferta[]
  // Ascensão (webinário/workshop): comparecimento dos compradores → conversão → ticket alto
  ascensao: { nome: string; comparecimento: number; conversao: number; ticket: number }
  // Lotes (OPCIONAL — nem sempre usado). Se usaLotes, o ticket principal vem da média ponderada.
  usaLotes: boolean
  lotes: { nome: string; ticket: number; vendas: number }[]  // vendas = % do total de vendas principal
  // Variações por cenário (chaves opcionais)
  variacao: Partial<Record<'cpm' | 'ctr' | 'carregamento' | 'playRate' | 'passagem' | 'convCheckout', number>>
}

export interface FunilDerivado {
  // Tráfego
  impressoes: number; cliques: number; cpcLink: number
  visualizacoes: number; custoPageView: number
  plays: number                    // 0 se não-VSL
  inicioCheckout: number; custoCheckout: number
  // Venda principal
  vendasPrincipal: number; faturamentoPrincipal: number
  ticketMedio: number
  cpa: number                      // investimento / vendas principal
  cpaEstimado: number              // (cpm/1000) / (produto das taxas do funil) — "seu CPA estimado"
  cpaMaximo: number                // investimento / meta de vendas — "seu CPA máximo" (0 se sem meta)
  viavel: boolean                  // cpaEstimado <= cpaMaximo (tráfego cabe na meta)
  // Cascata
  orderBumps: { nome: string; vendas: number; faturamento: number }[]
  upsells: { nome: string; vendas: number; faturamento: number }[]
  ascensao: { vendas: number; faturamento: number; pessoas: number }
  lotes: { nome: string; ingressos: number; faturamento: number }[]
  // Totais
  faturamentoTotal: number
  roas: number
}

const v = (base: number, pct: number | undefined) => aplicarVariacao(base, pct ?? 0)

/** Estágios que cada tipo usa (para a UI mostrar só o que faz sentido). */
export function estagiosDoTipo(tipo: FunilTipo): { vsl: boolean; lotes: boolean; pagina: boolean } {
  if (tipo === 'perpetuo_vsl') return { vsl: true, lotes: false, pagina: true }
  if (tipo === 'low_ticket') return { vsl: false, lotes: false, pagina: true }
  return { vsl: false, lotes: true, pagina: true } // lançamento: lotes opcional
}

export function computeFunil(s: FunilState, tipo: FunilTipo): FunilDerivado {
  const ehVSL = tipo === 'perpetuo_vsl'
  const cpm = v(s.cpm, s.variacao.cpm)
  const ctr = v(s.ctr, s.variacao.ctr)
  const carregamento = v(s.carregamento, s.variacao.carregamento)
  const playRate = v(s.playRate, s.variacao.playRate)
  const passagem = v(s.passagem, s.variacao.passagem)
  const convCheckout = v(s.convCheckout, s.variacao.convCheckout)

  const impressoes = cpm > 0 ? (s.investimento / cpm) * 1000 : 0
  const cliques = impressoes * (ctr / 100)
  const cpcLink = safeDivide(s.investimento, cliques)
  const visualizacoes = cliques * (carregamento / 100)
  const custoPageView = safeDivide(s.investimento, visualizacoes)
  const plays = ehVSL ? visualizacoes * (playRate / 100) : 0
  const checkoutBase = ehVSL ? plays : visualizacoes
  const inicioCheckout = checkoutBase * (passagem / 100)
  const custoCheckout = safeDivide(s.investimento, inicioCheckout)
  const vendasPrincipal = inicioCheckout * (convCheckout / 100)

  // CPA estimado pela cadeia (independe do volume) — "seu CPA estimado" da planilha
  const taxasFunil = (ctr / 100) * (carregamento / 100) * (ehVSL ? playRate / 100 : 1) * (passagem / 100) * (convCheckout / 100)
  const cpaEstimado = taxasFunil > 0 ? (cpm / 1000) / taxasFunil : 0
  const cpaMaximo = safeDivide(s.investimento, s.metaVendas)
  const viavel = cpaMaximo > 0 ? cpaEstimado <= cpaMaximo : true

  // Lotes (opcional) — ticket principal = média ponderada
  const lotes = s.usaLotes
    ? s.lotes.map((l) => ({ nome: l.nome, ingressos: vendasPrincipal * (l.vendas / 100), faturamento: vendasPrincipal * (l.vendas / 100) * l.ticket }))
    : []
  const somaPct = s.lotes.reduce((a, l) => a + l.vendas, 0)
  const ticketPrincipalEf = s.usaLotes && somaPct > 0
    ? s.lotes.reduce((a, l) => a + (l.ticket * l.vendas) / somaPct, 0)
    : s.ticketPrincipal
  const faturamentoPrincipal = vendasPrincipal * ticketPrincipalEf

  const orderBumps = s.orderBumps.map((o) => {
    const vendas = vendasPrincipal * (o.conversao / 100)
    return { nome: o.nome, vendas, faturamento: vendas * o.ticket }
  })
  const upsells = s.upsells.map((o) => {
    const vendas = vendasPrincipal * (o.conversao / 100)
    return { nome: o.nome, vendas, faturamento: vendas * o.ticket }
  })
  const pessoasAsc = vendasPrincipal * (s.ascensao.comparecimento / 100)
  const vendasAsc = pessoasAsc * (s.ascensao.conversao / 100)
  const ascensao = { pessoas: pessoasAsc, vendas: vendasAsc, faturamento: vendasAsc * s.ascensao.ticket }

  const faturamentoTotal =
    faturamentoPrincipal +
    orderBumps.reduce((a, o) => a + o.faturamento, 0) +
    upsells.reduce((a, o) => a + o.faturamento, 0) +
    ascensao.faturamento

  return {
    impressoes, cliques, cpcLink, visualizacoes, custoPageView, plays, inicioCheckout, custoCheckout,
    vendasPrincipal, faturamentoPrincipal, ticketMedio: safeDivide(faturamentoTotal, vendasPrincipal),
    cpa: safeDivide(s.investimento, vendasPrincipal), cpaEstimado, cpaMaximo, viavel,
    orderBumps, upsells, ascensao, lotes,
    faturamentoTotal, roas: safeDivide(faturamentoTotal, s.investimento),
  }
}

/** Lucro/Margem (modelo da planilha): taxas Hotmart + imposto sobre faturamento. */
export function calcFinanceiroFunil(d: FunilDerivado, cfg: ImpostoConfig) {
  const numVendas = d.vendasPrincipal + d.orderBumps.reduce((a, o) => a + o.vendas, 0) + d.upsells.reduce((a, o) => a + o.vendas, 0) + d.ascensao.vendas
  const taxasHotmart = d.faturamentoTotal * cfg.hotmart_pct_fee + numVendas * cfg.hotmart_fixed_fee
  const imposto = d.faturamentoTotal * cfg.imposto_faturamento_pct
  const lucroBruto = d.faturamentoTotal - d.cpa * d.vendasPrincipal // investimento = cpa×vendas (≈ investimento)
  const margemContribuicao = d.faturamentoTotal - (d.cpa * d.vendasPrincipal) - taxasHotmart - imposto
  return { numVendas, taxasHotmart, imposto, lucroBruto, margemContribuicao }
}

// ─────────────────────── Seed / normalize / dispatch ──────────────────────────

const ASCENSAO_VAZIA = { nome: 'Ascensão / Webinário', comparecimento: 0, conversao: 0, ticket: 0 }

/** Estado em branco (fallback do normalize). */
export function estadoVazioFunil(): FunilState {
  return {
    investimento: 0, cpm: 0, ctr: 0, carregamento: 0, playRate: 0, passagem: 0, convCheckout: 0,
    ticketPrincipal: 0, metaVendas: 0, orderBumps: [], upsells: [], ascensao: { ...ASCENSAO_VAZIA },
    usaLotes: false, lotes: [{ nome: 'Lote 1', ticket: 0, vendas: 100 }], variacao: {},
  }
}

/** Defaults REAIS por tipo (da planilha Centro de Planejamento) — usados ao criar um plano. */
export function estadoSeedFunil(tipo: FunilTipo): FunilState {
  const base = estadoVazioFunil()
  const trafego = { cpm: 33.16, ctr: 1.9, carregamento: 78.2, passagem: 23.8, convCheckout: 22.5 }
  if (tipo === 'low_ticket') {
    return {
      ...base, ...trafego, investimento: 50000, ticketPrincipal: 67,
      orderBumps: [
        { nome: 'OB1 — Script Anti-Desconto', ticket: 29.9, conversao: 6.4 },
        { nome: 'OB2 — Lucro Tributário', ticket: 47, conversao: 5.8 },
        { nome: 'OB3 — Dentista Parceiro', ticket: 67, conversao: 4.7 },
        { nome: 'OB4 — Manual Lucro Oculto', ticket: 37, conversao: 1.7 },
      ],
      ascensao: { nome: 'Ascensão Webinário', comparecimento: 20, conversao: 3, ticket: 297 },
    }
  }
  if (tipo === 'perpetuo_vsl') {
    return {
      ...base, cpm: 35, ctr: 1.9, carregamento: 78, playRate: 40, passagem: 20, convCheckout: 40,
      investimento: 50000, ticketPrincipal: 197,
      upsells: [{ nome: 'Upsell 1', ticket: 297, conversao: 10 }],
      ascensao: { nome: 'Ascensão Webinário', comparecimento: 20, conversao: 3, ticket: 297 },
    }
  }
  // lançamento pago (quando migrado ao funil): página de vendas + lotes opcionais
  return {
    ...base, ...trafego, investimento: 50000, ticketPrincipal: 77, usaLotes: false,
    ascensao: { nome: 'Ascensão Workshop', comparecimento: 60, conversao: 5, ticket: 4000 },
  }
}

export function normalizeFunilState(raw: Partial<FunilState> | null | undefined): FunilState {
  const b = estadoVazioFunil()
  if (!raw || typeof raw !== 'object') return b
  // Fallback: planos antigos do motor LaunchSim (estado.dadosTrafego/verbaTotal/ofertaPrincipal) — resgata o que dá.
  const ls = raw as Record<string, unknown>
  const dt = (ls.dadosTrafego ?? {}) as Record<string, unknown>
  const oferta = (ls.ofertaPrincipal ?? {}) as Record<string, unknown>
  const pick = (a: unknown, ...fallbacks: unknown[]): number => {
    for (const x of [a, ...fallbacks]) if (typeof x === 'number' && Number.isFinite(x)) return x
    return 0
  }
  return {
    investimento: pick(raw.investimento, ls.verbaTotal),
    cpm: pick(raw.cpm, dt.cpm),
    ctr: pick(raw.ctr, dt.ctr),
    carregamento: pick(raw.carregamento, dt.connectRate),
    playRate: num(raw.playRate),
    passagem: pick(raw.passagem, 100),
    convCheckout: pick(raw.convCheckout, dt.txConversao),
    ticketPrincipal: pick(raw.ticketPrincipal, oferta.ticket),
    metaVendas: num(raw.metaVendas),
    orderBumps: Array.isArray(raw.orderBumps) ? raw.orderBumps : [],
    upsells: Array.isArray(raw.upsells) ? raw.upsells : [],
    ascensao: { ...ASCENSAO_VAZIA, ...(raw.ascensao ?? {}) },
    usaLotes: raw.usaLotes === true,
    lotes: Array.isArray(raw.lotes) && raw.lotes.length ? raw.lotes : b.lotes,
    variacao: raw.variacao && typeof raw.variacao === 'object' ? raw.variacao : {},
  }
}
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

export const VARIACAO_FUNIL_A = { cpm: -10, ctr: 10, carregamento: 5, playRate: 5, passagem: 5, convCheckout: 10 }
export const VARIACAO_FUNIL_B = { cpm: -20, ctr: 20, carregamento: 10, playRate: 10, passagem: 10, convCheckout: 20 }

/** Lançamento Pago = motor LaunchSim (referência); Low Ticket e VSL = motor de funil. */
export function usaFunilEngine(tipo: AcaoTipo): boolean {
  return tipo !== 'lancamento_pago'
}

/** Dispatch de cálculo por tipo → sempre CenarioDerivado (reusa toda a UI existente). */
export function computeDerivadoPorTipo(tipo: AcaoTipo, estado: unknown): CenarioDerivado {
  if (!usaFunilEngine(tipo)) return computeCenario(normalizeEstado(estado as Partial<SimuladorState>))
  const s = normalizeFunilState(estado as Partial<FunilState>)
  return funilToCenarioDerivado(s, computeFunil(s, tipo))
}

/** Mapeia para o CenarioDerivado legado (reusa Dashboard/Cenários/Comparação/PDF existentes). */
export function funilToCenarioDerivado(s: FunilState, d: FunilDerivado): CenarioDerivado {
  const eventoSubtotal = d.faturamentoPrincipal + d.orderBumps.reduce((a, o) => a + o.faturamento, 0)
  const produtoSubtotal = d.upsells.reduce((a, o) => a + o.faturamento, 0) + d.ascensao.faturamento
  return {
    vendasPorMil: d.impressoes > 0 ? (d.vendasPrincipal / d.impressoes) * 1000 : 0,
    cpa: d.cpa,
    verbaPorObjetivo: { vendaIngressos: s.investimento, vendaProduto: 0, distribuicaoConteudo: 0, rmktAquecimento: 0 },
    projecaoIngressos: d.vendasPrincipal,
    volumeCanais: { trafego: d.vendasPrincipal, organico: 0, baseInterna: 0, outrosCanais: 0 },
    totalIngressos: d.vendasPrincipal,
    mediaVendasDia: 0, cpaTrafego: d.cpa, cpaGlobal: d.cpa,
    lotes: d.lotes.map((l) => ({ nome: l.nome, ingressos: l.ingressos, faturamento: l.faturamento })),
    ticketMedio: d.ticketMedio,
    faturamentoIngressos: d.faturamentoPrincipal,
    eventoOBs: d.orderBumps,
    eventoSubtotal,
    ofertaPrincipal: d.upsells[0] ? { vendas: d.upsells[0].vendas, faturamento: d.upsells[0].faturamento } : { vendas: 0, faturamento: 0 },
    produtoExtras: [...d.upsells.slice(1), { nome: 'Ascensão', vendas: d.ascensao.vendas, faturamento: d.ascensao.faturamento }].filter((x) => x.faturamento > 0),
    produtoSubtotal,
    faturamentoTotal: d.faturamentoTotal,
    roas: d.roas,
  }
}
