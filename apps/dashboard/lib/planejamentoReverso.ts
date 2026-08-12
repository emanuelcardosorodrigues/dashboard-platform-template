/**
 * Calculadora REVERSA do lançamento pago: parte da meta de LUCRO e devolve o CPA
 * máximo por ingresso + as metas de funil (CPM/CTR/Connect/Conversão da página).
 * Usa SÓ ingressos + produto principal (sem upsell/order bump — esses vivem na
 * etapa de metas do simulador e entram só no planejamento consolidado).
 *
 * Inverte calcLucroBrutoPlano: como cada ingresso vendido rende `preço` no
 * principal, o nº de vendas que paga a taxa fixa Hotmart é `faturamento ÷ preço`,
 * o que torna a equação do lucro LINEAR em faturamento → solução fechada, sem iterar.
 */
import type { ImpostoConfig, SimuladorState } from './acoesVendas'

export interface MetricaMeta { atual: number; meta: number }
export interface ReversoResult {
  viavel: boolean
  motivo?: string
  metaLucro: number
  investimento: number
  precoPrincipal: number
  convPrincipal: number          // %
  receitaPorIngresso: number     // (conv/100) × preço
  faturamentoNecessario: number
  ingressosNecessarios: number
  vendasPrincipal: number
  cpaMaximo: number              // investimento ÷ ingressos necessários
  cpaProjetado: number           // do funil já preenchido (CPM ÷ vendas/mil). Infinity quando inviável.
  cpaProjetadoInviavel: boolean  // true quando CTR/Connect/Conversão zeram vendasPorMil (CPA infinito — NÃO é tráfego grátis)
  bate: boolean                  // cpaProjetado ≤ cpaMaximo
  metas: { cpm: MetricaMeta; ctr: MetricaMeta; connectRate: MetricaMeta; conversaoPagina: MetricaMeta }
}

/** vendas por mil impressões a partir de CTR/Connect/Conversão (todos em %). */
function vendasPorMil(ctr: number, connect: number, conv: number): number {
  return (ctr / 100) * 1000 * (connect / 100) * (conv / 100)
}

export function computeReverso(s: SimuladorState, cfg: ImpostoConfig): ReversoResult {
  const metaLucro = s.metaLucro ?? 0
  const investimento = s.verbaTotal ?? 0
  const precoPrincipal = s.ofertaPrincipal?.ticket ?? 0
  const convPrincipal = s.ofertaPrincipal?.conversao ?? 0
  const t = s.dadosTrafego ?? { cpm: 0, ctr: 0, connectRate: 0, txConversao: 0 }

  const receitaPorIngresso = (convPrincipal / 100) * precoPrincipal
  const vazio: Omit<ReversoResult, 'viavel' | 'motivo'> = {
    metaLucro, investimento, precoPrincipal, convPrincipal, receitaPorIngresso,
    faturamentoNecessario: 0, ingressosNecessarios: 0, vendasPrincipal: 0,
    cpaMaximo: 0, cpaProjetado: 0, cpaProjetadoInviavel: false, bate: false,
    metas: {
      cpm: { atual: t.cpm, meta: 0 }, ctr: { atual: t.ctr, meta: 0 },
      connectRate: { atual: t.connectRate, meta: 0 }, conversaoPagina: { atual: t.txConversao, meta: 0 },
    },
  }
  if (metaLucro <= 0) return { ...vazio, viavel: false, motivo: 'Defina a meta de lucro.' }
  if (precoPrincipal <= 0 || convPrincipal <= 0) return { ...vazio, viavel: false, motivo: 'Preencha preço e conversão do produto principal.' }
  if (investimento <= 0) return { ...vazio, viavel: false, motivo: 'Preencha o investimento em tráfego.' }

  // 1) Faturamento necessário (fórmula fechada): lucro = fat·(1 − impFat − hotmartPct − hotmartFixed/preço) − investimento
  const fator = 1 - cfg.imposto_faturamento_pct - cfg.hotmart_pct_fee - cfg.hotmart_fixed_fee / precoPrincipal
  if (fator <= 0) return { ...vazio, viavel: false, motivo: 'Impostos/taxas consomem o preço do principal — inviável a esse preço.' }
  const faturamentoNecessario = (metaLucro + investimento) / fator

  // 2) Ingressos necessários e CPA máximo
  const ingressosNecessarios = Math.ceil(faturamentoNecessario / receitaPorIngresso)
  const vendasPrincipal = Math.round((convPrincipal / 100) * ingressosNecessarios)
  const cpaMaximo = investimento / ingressosNecessarios

  // 3) CPA projetado pelo funil já preenchido + meta de cada métrica (segurando as outras 3)
  const vpm = vendasPorMil(t.ctr, t.connectRate, t.txConversao)
  // Se CTR/Connect/Conversão zerarem, vendasPorMil = 0 → o CPA projetado é INFINITO (tráfego
  // inviável), nunca zero. Sinalizamos via `cpaProjetadoInviavel` pra UI não mostrar "R$ 0,00".
  const cpaProjetadoInviavel = vpm <= 0
  const cpaProjetado = cpaProjetadoInviavel ? Infinity : t.cpm / vpm
  // CPA = CPM ÷ vendasPorMil. Resolve cada variável p/ CPA = cpaMaximo, fixando as outras.
  const cpmMeta = cpaMaximo * vpm // CPM máximo permitido
  const ctrMeta = t.cpm > 0 ? (t.cpm / (cpaMaximo * 1000 * (t.connectRate / 100) * (t.txConversao / 100))) * 100 : 0
  const connectMeta = t.cpm > 0 ? (t.cpm / (cpaMaximo * 1000 * (t.ctr / 100) * (t.txConversao / 100))) * 100 : 0
  const convMeta = t.cpm > 0 ? (t.cpm / (cpaMaximo * 1000 * (t.ctr / 100) * (t.connectRate / 100))) * 100 : 0

  const fin = (v: number) => (Number.isFinite(v) ? v : 0)
  return {
    viavel: true,
    metaLucro, investimento, precoPrincipal, convPrincipal, receitaPorIngresso,
    faturamentoNecessario, ingressosNecessarios, vendasPrincipal,
    cpaMaximo, cpaProjetado, cpaProjetadoInviavel,
    bate: cpaProjetado <= cpaMaximo,
    metas: {
      cpm: { atual: t.cpm, meta: fin(cpmMeta) },
      ctr: { atual: t.ctr, meta: fin(ctrMeta) },
      connectRate: { atual: t.connectRate, meta: fin(connectMeta) },
      conversaoPagina: { atual: t.txConversao, meta: fin(convMeta) },
    },
  }
}
