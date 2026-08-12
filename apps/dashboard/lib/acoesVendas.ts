/**
 * Ações de Vendas — Fase 1 (só de `transacoes`): pace, melhores dias/horários,
 * melhores argumentos (criativos), breakdown por tipo de produto, take rate e
 * progresso vs metas. Cadastro define janela + produtos (front/OB/upsell/downsell).
 * Determinístico ([[feedback_hardcode_over_ai]]). Fase 2 (comparecimento/replay/grupo)
 * fica no backlog documentado — não temos as fontes (precisa Evolution/YouTube).
 */
import { createClient } from '@supabase/supabase-js'
import { produtoToTipo, type SbTransacao } from './supabase'
import { liquidoHotmartVenda, HOTMART_PCT, HOTMART_FIXA_PLANEJAMENTO } from './hotmartFees'
// NB: NÃO importar workspace-context aqui — AcoesVendasClient (client component)
// importa as constantes desta lib (ACAO_TIPO_LABEL/KPI_OPTIONS), e isso arrastaria
// workspace-context (cache do react + cookies/server) pro bundle do cliente,
// quebrando a aba na hidratação. O workspaceId vem POR ARGUMENTO (resolvido na página).

export type AcaoTipo = 'low_ticket' | 'lancamento_gratis' | 'lancamento_pago' | 'perpetuo_vsl'

// Workflow do planejador: 6 estados. Legados (ativo|encerrado) continuam aceitos
// (ações antigas) e são mapeados só na UI — nunca reescritos no banco.
export type AcaoStatusNovo = 'rascunho' | 'planejando' | 'planejado' | 'acao_andamento' | 'acao_concluida' | 'arquivado'
export type AcaoStatusLegado = 'ativo' | 'encerrado'
export type AcaoStatus = AcaoStatusNovo | AcaoStatusLegado

export const ACAO_TIPO_LABEL: Record<AcaoTipo, string> = {
  low_ticket: 'Low Ticket',
  lancamento_gratis: 'Lançamento Gratuito',
  lancamento_pago: 'Lançamento Pago',
  perpetuo_vsl: 'Perpétuo com VSL',
}

// Ordem do workflow (para badges, dropdown e progressão visual).
export const ACAO_STATUS_FLOW: AcaoStatusNovo[] = ['rascunho', 'planejando', 'planejado', 'acao_andamento', 'acao_concluida', 'arquivado']

export const ACAO_STATUS_LABEL: Record<AcaoStatus, string> = {
  rascunho: 'Rascunho',
  planejando: 'Planejando',
  planejado: 'Planejado',
  acao_andamento: 'Ação em Andamento',
  acao_concluida: 'Ação Concluída',
  arquivado: 'Arquivado',
  ativo: 'Ação em Andamento',   // legado → exibido como andamento
  encerrado: 'Ação Concluída',  // legado → exibido como concluída
}

// Whitelist de status aceitos no PATCH (novos + legados).
export const ACAO_STATUS_VALIDOS: AcaoStatus[] = [...ACAO_STATUS_FLOW, 'ativo', 'encerrado']

export const KPI_OPTIONS: { key: string; label: string; tipo: 'num' | 'brl' | 'pct' }[] = [
  { key: 'vendas', label: 'Vendas (front)', tipo: 'num' },
  { key: 'faturamento', label: 'Faturamento bruto', tipo: 'brl' },
  { key: 'receita_liquida', label: 'Receita líquida', tipo: 'brl' },
  { key: 'ticket', label: 'Ticket médio', tipo: 'brl' },
  { key: 'take_rate', label: 'Take rate OB (%)', tipo: 'pct' },
]

// ── Tipos do planejador (hub — simulador.ts/planejamento.ts importam daqui) ───

/** Impostos/taxas configuráveis do lucro. Default por workspace + override por plano. */
export interface ImpostoConfig {
  imposto_faturamento_pct: number   // 0.06 = 6% sobre faturamento
  hotmart_pct_fee: number           // default HOTMART_PCT (0.089)
  hotmart_fixed_fee: number         // default HOTMART_FIXA_PLANEJAMENTO (3.49 = 1,00 + 2,49 vídeo >97)
}

/** Estado de um cenário do simulador (port do LaunchSim). Persistido em acao_cenarios.estado (jsonb). */
export interface SimuladorState {
  dadosTrafego: { cpm: number; ctr: number; connectRate: number; txConversao: number }
  variacao: { variacaoCpm: number; variacaoCtr: number; variacaoConnectRate: number; variacaoTxConversao: number }
  verbaTotal: number
  metaIngressos: number   // meta de ingressos (p/ CPA máximo por ingresso). 0 = sem meta
  distribuicaoVerba: { vendaIngressos: number; vendaProduto: number; distribuicaoConteudo: number; rmktAquecimento: number } // %
  canaisVenda: { trafego: number; organico: number; baseInterna: number; outrosCanais: number } // %
  diasCaptacao: number
  lotes: { nome: string; ticket: number; vendas: number }[]          // vendas = % do total de ingressos; máx 5
  eventoOBs: { nome: string; ticket: number; conversao: number }[]   // conversao em %
  ofertaPrincipal: { nome: string; ticket: number; conversao: number }
  produtoExtras: { nome: string; ticket: number; conversao: number }[]
  // ── Calculadora reversa (opcional, só lançamento pago) — NÃO altera o forward ──
  /** 'meta' = calcula CPA máximo a partir da meta de lucro (padrão); 'simulador' = forward. undefined ⇒ 'meta'. */
  modo?: 'meta' | 'simulador'
  /** Meta de lucro (R$) do modo reverso. */
  metaLucro?: number
}

/** Derivados calculados a partir de um SimuladorState (saída de computeCenario). */
export interface CenarioDerivado {
  vendasPorMil: number
  cpa: number
  verbaPorObjetivo: { vendaIngressos: number; vendaProduto: number; distribuicaoConteudo: number; rmktAquecimento: number }
  projecaoIngressos: number
  volumeCanais: { trafego: number; organico: number; baseInterna: number; outrosCanais: number }
  totalIngressos: number
  mediaVendasDia: number
  cpaTrafego: number
  cpaGlobal: number
  lotes: { nome: string; ingressos: number; faturamento: number }[]
  ticketMedio: number
  faturamentoIngressos: number
  eventoOBs: { nome: string; vendas: number; faturamento: number }[]
  eventoSubtotal: number
  ofertaPrincipal: { vendas: number; faturamento: number }
  produtoExtras: { nome: string; vendas: number; faturamento: number }[]
  produtoSubtotal: number
  faturamentoTotal: number
  roas: number
}

/** Total de TRANSAÇÕES previstas do cenário (ingressos + OBs + oferta principal
 *  + extras). Base correta da taxa fixa Hotmart, cobrada POR transação — usar só
 *  totalIngressos subestimava a taxa no Previsto e descasava do Realizado
 *  (vendasTotais). F2 #5. */
export function totalTransacoesPrevistas(d: CenarioDerivado): number {
  return d.totalIngressos
    + d.eventoOBs.reduce((s, o) => s + o.vendas, 0)
    + d.ofertaPrincipal.vendas
    + d.produtoExtras.reduce((s, o) => s + o.vendas, 0)
}

export type CenarioKind = 'simulado' | 'real'

export interface SbAcaoCenario {
  id: string
  workspace_id: string
  acao_id: string
  nome: string
  ordem: number
  kind: CenarioKind
  estado: SimuladorState
  is_melhor: boolean
  created_at: string
  updated_at: string
}

export interface SbAcaoNota {
  id: string
  workspace_id: string
  acao_id: string
  corpo: string
  autor_email: string | null
  created_at: string
  updated_at: string
}

export interface SbPlanejamentoConfig {
  workspace_id: string
  imposto_faturamento_pct: number
  hotmart_pct_fee: number
  hotmart_fixed_fee: number
  checklist_kpis_default: Record<string, boolean>
  despesas_fixas: { nome: string; valor: number }[]   // migration 0040
  pct_variavel: number                                 // migration 0040 (ex: 0.25 = 25% sobre faturamento)
  updated_at: string
}

export interface SbAcaoVenda {
  id: string
  nome: string
  tipo: AcaoTipo
  data_inicio: string | null
  data_fim: string | null
  produtos_front: string[]
  produtos_ob: string[]
  produtos_upsell: string[]
  produtos_downsell: string[]
  metas: Record<string, number>
  descricao: string | null
  status: AcaoStatus
  created_at: string
  updated_at: string
  // ── campos novos da migration 0038 (opcionais p/ compat com ações legadas) ──
  workspace_id?: string
  sigla?: string | null
  thumbnail_url?: string | null
  config_impostos?: Partial<ImpostoConfig>
  comparacao_kpis?: Record<string, boolean>
  arquivada_em?: string | null
  is_planejamento?: boolean
  is_template?: boolean
  perpetuo?: boolean              // migration 0039 — janela de datas não obrigatória
  incluir_consolidacao?: boolean  // migration 0040 — entra no Centro de Planejamento
}

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

/** Fallback gracioso: sem a tabela (migration não rodada) retorna [] — não quebra o deploy. */
export async function fetchAcoesVendas(workspaceId: string): Promise<SbAcaoVenda[]> {
  try {
    const { data, error } = await supa().from('acoes_vendas').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false })
    if (error) return []
    return (data ?? []) as SbAcaoVenda[]
  } catch { return [] }
}

export async function fetchAcaoVenda(id: string, workspaceId: string): Promise<SbAcaoVenda | null> {
  try {
    const { data, error } = await supa().from('acoes_vendas').select('*').eq('id', id).eq('workspace_id', workspaceId).single()
    if (error) return null
    return (data ?? null) as SbAcaoVenda | null
  } catch { return null }
}

// ── Fetchers do planejador (fallback gracioso: sem tabela/migration → []/null) ──
// NB: sem unstable_cache — dados editados em tempo real pelo auto-save precisam de leitura fresca.

export async function fetchCenarios(acaoId: string, workspaceId: string): Promise<SbAcaoCenario[]> {
  try {
    const { data, error } = await supa().from('acao_cenarios').select('*')
      .eq('acao_id', acaoId).eq('workspace_id', workspaceId).order('ordem', { ascending: true })
    if (error) return []
    return (data ?? []) as SbAcaoCenario[]
  } catch { return [] }
}

export async function fetchNotas(acaoId: string, workspaceId: string): Promise<SbAcaoNota[]> {
  try {
    const { data, error } = await supa().from('acao_notas').select('*')
      .eq('acao_id', acaoId).eq('workspace_id', workspaceId).order('created_at', { ascending: false })
    if (error) return []
    return (data ?? []) as SbAcaoNota[]
  } catch { return [] }
}

/** Config de impostos/checklist do workspace. Retorna defaults (não-persistidos) se vazio. */
export async function fetchPlanejamentoConfig(workspaceId: string): Promise<SbPlanejamentoConfig> {
  const fallback: SbPlanejamentoConfig = {
    workspace_id: workspaceId,
    imposto_faturamento_pct: 0.06, // 6% — default do modelo financeiro real do DEMO (planilha Centro de Planejamento)
    hotmart_pct_fee: HOTMART_PCT,
    hotmart_fixed_fee: HOTMART_FIXA_PLANEJAMENTO,
    checklist_kpis_default: {},
    despesas_fixas: [],
    pct_variavel: 0,
    updated_at: '',
  }
  try {
    const { data, error } = await supa().from('workspace_planejamento_config').select('*').eq('workspace_id', workspaceId).maybeSingle()
    if (error || !data) return fallback
    const d = data as Partial<SbPlanejamentoConfig>
    return { ...fallback, ...d, despesas_fixas: Array.isArray(d.despesas_fixas) ? d.despesas_fixas : [] }
  } catch { return fallback }
}

// ── helpers de tempo (testáveis) ─────────────────────────────────────────────
export function diaSemana(data: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(data)) return null
  const d = new Date(data.slice(0, 10) + 'T12:00:00Z') // meio-dia UTC evita virada de fuso
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay() // 0=Dom .. 6=Sáb
}

export function horaCompra(t: { hora_compra?: string | null; created_at?: string | null }): number | null {
  const hc = (t.hora_compra || '').trim()
  const m = hc.match(/^(\d{1,2}):\d{2}/)
  if (m) { const h = Number(m[1]); return h >= 0 && h < 24 ? h : null }
  const iso = t.created_at || (hc.includes('T') ? hc : null)
  if (iso) {
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) {
      const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(d))
      return Number.isFinite(h) ? h % 24 : null
    }
  }
  return null
}

export type TipoProduto = 'front' | 'ob' | 'upsell' | 'downsell' | 'outro'

/** Classifica a transação dentro da ação. Se a ação tem produtos cadastrados, usa-os
 *  (transação fora dos produtos → null = não pertence); senão usa o classificador global. */
export function classifyNaAcao(acao: SbAcaoVenda, produto: string, produtoId = ''): TipoProduto | null {
  const temProdutos =
    acao.produtos_front.length + acao.produtos_ob.length + acao.produtos_upsell.length + acao.produtos_downsell.length > 0
  if (temProdutos) {
    if (acao.produtos_front.includes(produto)) return 'front'
    if (acao.produtos_ob.includes(produto)) return 'ob'
    if (acao.produtos_upsell.includes(produto)) return 'upsell'
    if (acao.produtos_downsell.includes(produto)) return 'downsell'
    return null
  }
  // A allowlist da ação (produtos_front/ob/...) é cadastrada por NOME na UI; só o
  // classificador global entende id. Quando a ação não tem produtos cadastrados,
  // repassa o id pra que as regras `por:'id'` do funil casem.
  const t = produtoToTipo(produto, '', undefined, produtoId)
  if (t === 'frontEnd') return 'front'
  if (t === 'ob1' || t === 'ob2' || t === 'ob3' || t === 'ob4') return 'ob'
  if (t === 'upsell') return 'upsell'
  if (t === 'downsell') return 'downsell'
  return 'outro'
}

export interface AcaoAnalise {
  vendasFront: number
  vendasTotais: number
  faturamentoFront: number
  faturamentoTotal: number
  receitaLiquida: number
  ticketMedio: number
  dias: number
  paceDiarioVendas: number
  paceSemanalVendas: number
  takeRateOB: number
  serie: { data: string; vendas: number; faturamento: number }[]
  porDiaSemana: { dia: number; vendas: number; faturamento: number }[]
  porHora: { hora: number; vendas: number }[]
  topCriativos: { criativo: string; vendas: number; receita: number }[]
  breakdown: { tipo: TipoProduto; vendas: number; faturamento: number }[]
  metas: { key: string; label: string; tipo: 'num' | 'brl' | 'pct'; meta: number; atual: number; pct: number }[]
}

export function analyzeAcao(acao: SbAcaoVenda, transacoes: SbTransacao[]): AcaoAnalise {
  const from = acao.data_inicio
  const to = acao.data_fim
  const rows = transacoes.filter((t) => {
    if ((t.valor_bruto || 0) <= 1) return false
    const d = (t.data || '').slice(0, 10)
    if ((from || to) && !d) return false
    if (from && d < from) return false
    if (to && d > to) return false
    return classifyNaAcao(acao, t.produto || '', t.produto_id || '') !== null
  })

  const serieMap = new Map<string, { vendas: number; faturamento: number }>()
  const dowMap = new Map<number, { vendas: number; faturamento: number }>()
  const horaMap = new Map<number, number>()
  const criMap = new Map<string, { vendas: number; liquido: number }>()
  const tipoMap = new Map<TipoProduto, { vendas: number; faturamento: number }>()

  let vendasFront = 0, faturamentoFront = 0, faturamentoTotal = 0, liquidoTotal = 0
  let vendasOB = 0

  for (const t of rows) {
    const tipo = classifyNaAcao(acao, t.produto || '', t.produto_id || '') as TipoProduto
    const v = t.valor_bruto || 0
    const liq = liquidoHotmartVenda(v) // líquido POR transação (modelo Hotmart exato)
    const d = (t.data || '').slice(0, 10)
    faturamentoTotal += v
    liquidoTotal += liq

    const tp = tipoMap.get(tipo) ?? { vendas: 0, faturamento: 0 }
    tp.vendas += 1; tp.faturamento += v; tipoMap.set(tipo, tp)

    if (tipo === 'front') { vendasFront += 1; faturamentoFront += v }
    if (tipo === 'ob') vendasOB += 1

    if (d) {
      const s = serieMap.get(d) ?? { vendas: 0, faturamento: 0 }
      if (tipo === 'front') s.vendas += 1
      s.faturamento += v; serieMap.set(d, s)
      const dow = diaSemana(d)
      if (dow != null && tipo === 'front') {
        const dd = dowMap.get(dow) ?? { vendas: 0, faturamento: 0 }
        dd.vendas += 1; dd.faturamento += v; dowMap.set(dow, dd)
      }
    }
    if (tipo === 'front') {
      const h = horaCompra(t)
      if (h != null) horaMap.set(h, (horaMap.get(h) ?? 0) + 1)
      const cri = (t.criativo || '(sem criativo)').trim() || '(sem criativo)'
      const cm = criMap.get(cri) ?? { vendas: 0, liquido: 0 }
      cm.vendas += 1; cm.liquido += liq; criMap.set(cri, cm)
    }
  }

  const receitaLiquida = liquidoTotal // soma dos líquidos por transação (canônico)
  const ticketMedio = vendasFront > 0 ? faturamentoFront / vendasFront : 0
  const takeRateOB = vendasFront > 0 ? (vendasOB / vendasFront) * 100 : 0

  const serie = Array.from(serieMap.entries()).map(([data, v]) => ({ data, ...v })).sort((a, b) => a.data.localeCompare(b.data))
  const dias = serie.length || (from && to ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1) : 1)
  const porDiaSemana = Array.from({ length: 7 }, (_, i) => ({ dia: i, ...(dowMap.get(i) ?? { vendas: 0, faturamento: 0 }) }))
  const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, vendas: horaMap.get(h) ?? 0 }))
  const topCriativos = Array.from(criMap.entries())
    .map(([criativo, v]) => ({ criativo, vendas: v.vendas, receita: v.liquido }))
    .sort((a, b) => b.vendas - a.vendas)
  const breakdown = (['front', 'ob', 'upsell', 'downsell', 'outro'] as TipoProduto[])
    .map((tipo) => ({ tipo, ...(tipoMap.get(tipo) ?? { vendas: 0, faturamento: 0 }) }))
    .filter((b) => b.vendas > 0)

  const atualDe = (key: string): number => {
    switch (key) {
      case 'vendas': return vendasFront
      case 'faturamento': return faturamentoFront
      case 'receita_liquida': return receitaLiquida
      case 'ticket': return ticketMedio
      case 'take_rate': return takeRateOB
      default: return 0
    }
  }
  const metas = Object.entries(acao.metas || {})
    .filter(([, meta]) => Number(meta) > 0)
    .map(([key, meta]) => {
      const opt = KPI_OPTIONS.find((o) => o.key === key)
      const atual = atualDe(key)
      return { key, label: opt?.label ?? key, tipo: opt?.tipo ?? 'num', meta: Number(meta), atual, pct: meta > 0 ? (atual / Number(meta)) * 100 : 0 }
    })

  return {
    vendasFront, vendasTotais: rows.length, faturamentoFront, faturamentoTotal, receitaLiquida, ticketMedio, dias,
    paceDiarioVendas: dias > 0 ? vendasFront / dias : 0,
    paceSemanalVendas: dias > 0 ? (vendasFront / dias) * 7 : 0,
    takeRateOB, serie, porDiaSemana, porHora, topCriativos, breakdown, metas,
  }
}
