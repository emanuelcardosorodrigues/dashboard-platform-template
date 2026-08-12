/**
 * Planejamento de Ação de Vendas — lucro configurável, Cenário Real (estende
 * analyzeAcao com investimento do meta_ads via sigla) e comparação 3-colunas
 * (Previsto × Realizado × Previsão pelo pace). Determinístico ([[feedback_hardcode_over_ai]]).
 *
 * Invariante do imposto Meta: meta_ads.investimento JÁ vem com taxRate aplicado no
 * sync — NUNCA remultiplicar aqui. O previsto usa verbaTotal como planejado (sem tax extra).
 */
import { analyzeAcao, fetchPlanejamentoConfig, type SbAcaoVenda, type SbAcaoCenario, type SbPlanejamentoConfig, type AcaoAnalise, type ImpostoConfig, type CenarioDerivado , totalTransacoesPrevistas } from './acoesVendas'
import { fetchTransacoes, fetchMetaAds, type SbMetaAds } from './supabase'
import { safeDivide } from './simulador'
import { computeDerivadoPorTipo } from './funilEngine'
import type { AcaoTipo } from './acoesVendas'
import { calcDeltaPct } from './comparePeriods'
import { getSemaforoColorForFunil, type ThresholdKey } from './thresholds'
import type { SemaforoColor } from '@/types'

// ── Lucro ─────────────────────────────────────────────────────────────────────

export interface LucroResult {
  faturamentoTotal: number
  investimentoTrafego: number   // já com imposto Meta quando vem do meta_ads
  impostoFaturamento: number
  taxasHotmart: number
  lucroBruto: number
}

/** lucro = faturamento − investimento(c/ imposto Meta) − imposto_faturamento − taxas Hotmart. */
export function calcLucroBrutoPlano(faturamentoTotal: number, investimentoTrafego: number, numVendas: number, cfg: ImpostoConfig): LucroResult {
  const impostoFaturamento = faturamentoTotal * cfg.imposto_faturamento_pct
  const taxasHotmart = faturamentoTotal * cfg.hotmart_pct_fee + numVendas * cfg.hotmart_fixed_fee
  const lucroBruto = faturamentoTotal - investimentoTrafego - impostoFaturamento - taxasHotmart
  return { faturamentoTotal, investimentoTrafego, impostoFaturamento, taxasHotmart, lucroBruto }
}

/** Merge puro: default do workspace ← override por plano (acao.config_impostos). */
export function mergeImpostoConfig(acao: SbAcaoVenda, wsCfg: SbPlanejamentoConfig): ImpostoConfig {
  const ov = acao.config_impostos ?? {}
  return {
    imposto_faturamento_pct: ov.imposto_faturamento_pct ?? wsCfg.imposto_faturamento_pct,
    hotmart_pct_fee: ov.hotmart_pct_fee ?? wsCfg.hotmart_pct_fee,
    hotmart_fixed_fee: ov.hotmart_fixed_fee ?? wsCfg.hotmart_fixed_fee,
  }
}

/** Versão async: busca o config do workspace e aplica o override do plano. */
export async function resolveImpostoConfig(acao: SbAcaoVenda, workspaceId: string): Promise<ImpostoConfig> {
  return mergeImpostoConfig(acao, await fetchPlanejamentoConfig(workspaceId))
}

/** Dias decorridos/totais da janela da ação (horizonte da projeção "Previsão"). */
export function calcHorizonte(acao: SbAcaoVenda): { diasDecorridos: number; diasTotais: number } {
  // Perpétuo: sem fim → não projeta (previsão = realizado).
  if (acao.perpetuo || !acao.data_inicio || !acao.data_fim) return { diasDecorridos: 0, diasTotais: 0 }
  const ini = Date.parse(acao.data_inicio + 'T00:00:00Z')
  const fim = Date.parse(acao.data_fim + 'T00:00:00Z')
  if (Number.isNaN(ini) || Number.isNaN(fim)) return { diasDecorridos: 0, diasTotais: 0 }
  const diasTotais = Math.max(1, Math.round((fim - ini) / 86400000) + 1)
  const decor = Math.round((Date.now() - ini) / 86400000) + 1
  return { diasDecorridos: Math.max(0, Math.min(diasTotais, decor)), diasTotais }
}

// ── Resumo de card (grid) ────────────────────────────────────────────────────

export interface ResumoCard {
  investimento: number
  faturamento: number
  lucro: number
  roas: number
  melhorNome: string | null
}

/** Investimento do cenário, agnóstico ao motor (verbaTotal no LaunchSim, investimento no funil). */
function investimentoDoEstado(estado: Record<string, unknown> | null | undefined): number {
  if (!estado || typeof estado !== 'object') return 0
  const e = estado as Record<string, unknown>
  const vt = typeof e.verbaTotal === 'number' ? e.verbaTotal : 0
  const inv = typeof e.investimento === 'number' ? e.investimento : 0
  return inv || vt
}

/** Métricas do cenário SIMULADO de maior ROAS (mostradas no card do grid). Dispatch por tipo. */
export function resumoCard(cenarios: SbAcaoCenario[], cfg: ImpostoConfig, tipo: AcaoTipo): ResumoCard {
  let melhor: { derivado: CenarioDerivado; verba: number; nome: string } | null = null
  for (const c of cenarios) {
    if (c.kind !== 'simulado') continue
    const derivado = computeDerivadoPorTipo(tipo, c.estado)
    const verba = investimentoDoEstado(c.estado as unknown as Record<string, unknown>)
    if (!melhor || derivado.roas > melhor.derivado.roas) melhor = { derivado, verba, nome: c.nome }
  }
  if (!melhor) return { investimento: 0, faturamento: 0, lucro: 0, roas: 0, melhorNome: null }
  const lucro = calcLucroBrutoPlano(melhor.derivado.faturamentoTotal, melhor.verba, totalTransacoesPrevistas(melhor.derivado), cfg).lucroBruto // F2 #5
  return { investimento: melhor.verba, faturamento: melhor.derivado.faturamentoTotal, lucro, roas: melhor.derivado.roas, melhorNome: melhor.nome }
}

// ── Centro de Planejamento (consolidação P&L da operação) ─────────────────────

export interface PlanoConsolidado {
  id: string; nome: string; tipo: AcaoTipo
  faturamento: number; investimento: number; taxas: number; imposto: number; margemContribuicao: number
}
export interface Consolidacao {
  planos: PlanoConsolidado[]
  faturamentoTotal: number
  investimentoTotal: number
  somaMargens: number
  despesasFixasTotal: number
  despesasVariaveis: number   // pctVariavel × faturamentoTotal
  lucroLiquido: number
  lucroLiquidoPct: number
}

/** Soma as margens de contribuição dos planos − despesas fixas − despesas variáveis = Lucro Líquido. */
export function consolidar(planos: PlanoConsolidado[], despesasFixas: { nome: string; valor: number }[], pctVariavel: number): Consolidacao {
  const faturamentoTotal = planos.reduce((a, p) => a + p.faturamento, 0)
  const investimentoTotal = planos.reduce((a, p) => a + p.investimento, 0)
  const somaMargens = planos.reduce((a, p) => a + p.margemContribuicao, 0)
  const despesasFixasTotal = despesasFixas.reduce((a, d) => a + (Number(d.valor) || 0), 0)
  const despesasVariaveis = faturamentoTotal * pctVariavel
  const lucroLiquido = somaMargens - despesasFixasTotal - despesasVariaveis
  return {
    planos, faturamentoTotal, investimentoTotal, somaMargens, despesasFixasTotal, despesasVariaveis,
    lucroLiquido, lucroLiquidoPct: faturamentoTotal > 0 ? lucroLiquido / faturamentoTotal : 0,
  }
}

// ── Cenário Real ────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Soma o investimento (já com taxRate) das linhas de meta_ads no período cujo
 * nome de campanha/conjunto/anúncio/criativo casa a sigla com WORD-BOUNDARY
 * (case-insensitive). Word-boundary evita colisão: 'LP' NÃO casa 'HELP'.
 * Função pura — testável sem I/O.
 */
export function aggregaInvestimentoPorSigla(
  rows: SbMetaAds[],
  sigla: string,
  from: string | null,
  to: string | null,
): { investimento: number; linhas: number; ads: number } {
  const s = (sigla || '').trim()
  if (s.length < 3) return { investimento: 0, linhas: 0, ads: 0 }
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(s.toLowerCase())}([^a-z0-9]|$)`, 'i')
  let investimento = 0
  let linhas = 0
  const adSet = new Set<string>()
  for (const r of rows) {
    const d = (r.data || '').slice(0, 10)
    if (from && d < from) continue
    if (to && d > to) continue
    const hay = `${r.campaign_name || ''} ${r.adset_name || ''} ${r.ad_name || ''} ${r.criativo || ''}`
    if (re.test(hay)) {
      investimento += r.investimento || 0
      linhas++
      if (r.ad_id) adSet.add(r.ad_id)
    }
  }
  return { investimento, linhas, ads: adSet.size }
}

export interface CenarioReal {
  analise: AcaoAnalise          // vendas/faturamento/pace/criativos (de analyzeAcao)
  investimento: number          // soma meta_ads no período cuja campanha/conj/anúncio casa a sigla (já com taxRate)
  faturamento: number
  lucro: LucroResult
  roas: number
  fonteInvestimento: 'sigla' | 'sem_sigla'
  matchMeta: { linhas: number; ads: number }  // p/ widget de debug de casamento
}

/**
 * Casa os dados reais com a ação: vendas via analyzeAcao (período+produtos) e
 * investimento via meta_ads filtrado por período + sigla (word-boundary, case-insensitive).
 * Sem sigla (ou < 3 chars) → investimento 0 + fonteInvestimento 'sem_sigla' (banner honesto).
 */
export async function computeCenarioReal(acao: SbAcaoVenda, workspaceId: string): Promise<CenarioReal> {
  const [transacoes, metaAds] = await Promise.all([fetchTransacoes(workspaceId), fetchMetaAds(workspaceId)])
  const analise = analyzeAcao(acao, transacoes)

  const sigla = (acao.sigla || '').trim()
  const fonte: 'sigla' | 'sem_sigla' = sigla.length >= 3 ? 'sigla' : 'sem_sigla'
  const { investimento, linhas, ads } = aggregaInvestimentoPorSigla(metaAds, sigla, acao.data_inicio, acao.data_fim)

  const cfg = await resolveImpostoConfig(acao, workspaceId)
  const lucro = calcLucroBrutoPlano(analise.faturamentoTotal, investimento, analise.vendasTotais, cfg)
  return {
    analise,
    investimento,
    faturamento: analise.faturamentoTotal,
    lucro,
    roas: safeDivide(analise.faturamentoTotal, investimento),
    fonteInvestimento: fonte,
    matchMeta: { linhas, ads },
  }
}

// ── Snapshots de métricas e comparação 3-colunas ──────────────────────────────

export interface MetricasSnapshot {
  investimento: number
  faturamento: number
  vendas: number
  ticketMedio: number
  roas: number
  lucro: number
  cpa: number
}

/** Métricas do PREVISTO a partir do cenário Base (derivado) + verbaTotal + impostos. */
export function snapshotPrevisto(derivado: CenarioDerivado, verbaTotal: number, cfg: ImpostoConfig): MetricasSnapshot {
  const vendas = derivado.totalIngressos
  const faturamento = derivado.faturamentoTotal
  // F2 #5 — taxa fixa incide POR TRANSAÇÃO (front + OBs + extras), não só ingressos
  const lucro = calcLucroBrutoPlano(faturamento, verbaTotal, totalTransacoesPrevistas(derivado), cfg).lucroBruto
  return {
    investimento: verbaTotal,
    faturamento,
    vendas,
    ticketMedio: derivado.ticketMedio || safeDivide(faturamento, vendas),
    roas: derivado.roas,
    lucro,
    cpa: derivado.cpaGlobal,
  }
}

/** Métricas do REALIZADO a partir do Cenário Real. */
export function snapshotRealizado(real: CenarioReal): MetricasSnapshot {
  const vendas = real.analise.vendasFront
  return {
    investimento: real.investimento,
    faturamento: real.faturamento,
    vendas,
    ticketMedio: real.analise.ticketMedio,
    roas: real.roas,
    lucro: real.lucro.lucroBruto,
    cpa: safeDivide(real.investimento, vendas),
  }
}

export interface ComparacaoLinha {
  key: string
  label: string
  tipo: 'num' | 'brl' | 'pct' | 'x'
  previsto: number
  realizado: number
  previsao: number
  deltaReal: number | null      // % realizado vs previsto
  deltaPrevisao: number | null  // % previsão vs previsto
  semaforo: SemaforoColor | null
}

const LINHAS: { key: keyof MetricasSnapshot; label: string; tipo: ComparacaoLinha['tipo']; threshold?: ThresholdKey; maiorMelhor: boolean }[] = [
  { key: 'investimento', label: 'Investimento', tipo: 'brl', maiorMelhor: false },
  { key: 'faturamento', label: 'Faturamento', tipo: 'brl', maiorMelhor: true },
  { key: 'vendas', label: 'Vendas (front)', tipo: 'num', maiorMelhor: true },
  { key: 'ticketMedio', label: 'Ticket médio', tipo: 'brl', maiorMelhor: true },
  { key: 'roas', label: 'ROAS', tipo: 'x', threshold: 'roasLiquido', maiorMelhor: true },
  { key: 'lucro', label: 'Lucro bruto', tipo: 'brl', maiorMelhor: true },
  { key: 'cpa', label: 'CPA', tipo: 'brl', threshold: 'cpa', maiorMelhor: false },
]

/** Métricas da comparação (para o checklist na UI). */
export const COMPARACAO_METRICAS: { key: string; label: string }[] = LINHAS.map((l) => ({ key: l.key, label: l.label }))

/** Semáforo de uma linha: métricas com threshold absoluto usam-no; demais comparam realizado vs previsto. */
function semaforoLinha(key: keyof MetricasSnapshot, realizado: number, previsto: number, threshold: ThresholdKey | undefined, maiorMelhor: boolean, ticketFE: number): SemaforoColor | null {
  if (threshold) return getSemaforoColorForFunil(threshold, realizado, undefined, ticketFE)
  if (key === 'investimento') return null // investir mais/menos que o plano não é bom/ruim por si
  if (previsto <= 0) return null
  const ratio = realizado / previsto
  const r = maiorMelhor ? ratio : 2 - ratio // inverte p/ "menor é melhor"
  if (r >= 1) return 'green'
  if (r >= 0.9) return 'yellow'
  return 'red'
}

/**
 * Monta a comparação 3-colunas. `checklist[key] !== false` → linha incluída (default-on).
 * Previsão projeta o fim do período: volumes por pace diário; ROAS/ticket/CPA/lucro
 * recompostos a partir dos volumes projetados (não extrapolação linear de razão).
 */
export function buildComparacao(
  previsto: MetricasSnapshot,
  real: CenarioReal,
  cfg: ImpostoConfig,
  horizonte: { diasDecorridos: number; diasTotais: number },
  checklist: Record<string, boolean>,
): ComparacaoLinha[] {
  const realizado = snapshotRealizado(real)
  const diasDecorridos = Math.max(1, horizonte.diasDecorridos)
  const diasRestantes = Math.max(0, horizonte.diasTotais - horizonte.diasDecorridos)

  // Projeção de volumes pelo pace
  const projVendas = realizado.vendas + (realizado.vendas / diasDecorridos) * diasRestantes
  const projFaturamento = realizado.faturamento + (realizado.faturamento / diasDecorridos) * diasRestantes
  const projInvestimento = realizado.investimento + (realizado.investimento / diasDecorridos) * diasRestantes
  // F2 #5 — taxa fixa por TRANSAÇÃO: projeta vendasTotais (front+OB+extras) pelo
  // mesmo pace, em vez de usar só as vendas front (subestimava a taxa projetada)
  const projTransacoes = Math.round(real.analise.vendasTotais * (1 + diasRestantes / diasDecorridos))
  const projLucro = calcLucroBrutoPlano(projFaturamento, projInvestimento, projTransacoes, cfg).lucroBruto
  const previsao: MetricasSnapshot = {
    investimento: projInvestimento,
    faturamento: projFaturamento,
    vendas: projVendas,
    ticketMedio: safeDivide(projFaturamento, projVendas),
    roas: safeDivide(projFaturamento, projInvestimento),
    lucro: projLucro,
    cpa: safeDivide(projInvestimento, projVendas),
  }

  const ticketFE = previsto.ticketMedio || realizado.ticketMedio
  return LINHAS
    .filter((l) => checklist[l.key] !== false)
    .map((l) => ({
      key: l.key,
      label: l.label,
      tipo: l.tipo,
      previsto: previsto[l.key],
      realizado: realizado[l.key],
      previsao: previsao[l.key],
      deltaReal: calcDeltaPct(realizado[l.key], previsto[l.key]),
      deltaPrevisao: calcDeltaPct(previsao[l.key], previsto[l.key]),
      semaforo: semaforoLinha(l.key, realizado[l.key], previsto[l.key], l.threshold, l.maiorMelhor, ticketFE),
    }))
}
