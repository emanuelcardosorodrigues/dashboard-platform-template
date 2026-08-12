/**
 * RAIO-X DA ESCALA — agregador que prepara dados em 3 janelas (30d / 15d / 7d)
 * pra renderização no PDF (lib/pdfRaioX.ts) e no preview (/raio-x).
 *
 * Cada janela combina:
 *  - PeriodSummary (Meta Ads + Hotmart) → Métricas Gerais + Tráfego
 *  - vTurb agregado por N players → VSL + Engajamento
 *
 * Datas em UTC-3 (Brasília). Janelas terminam em "hoje" — usar `daysAgoBR(N-1)`
 * pra "N dias incluindo hoje" (30d = D-29 → hoje).
 */

import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from './workspace-context'
import { computePeriodSummary, type PeriodSummary } from './periodSummary'
import {
  listPlayers, sessionStats, aggregateStats,
  type VturbPlayer, type VturbSessionStats,
} from './vturb'
import { daysAgoBR, todayBR } from './formatters'

/**
 * Resolve o rótulo da conta Meta buscando o campo `rotulo` em
 * workspace_meta_accounts (lookup por PK — custo mínimo).
 * Retorna null se a conta for 'all', vazia, ou não encontrada.
 */
async function resolveContaRotulo(conta: string): Promise<string | null> {
  if (!conta || conta === 'all') return null
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  // Filtro de tenant SEMPRE (trava de isolamento): account_id do Meta é global,
  // sem o filtro um tenant leria o rótulo cadastrado por outro.
  const workspaceId = await getActiveWorkspaceId()
  const { data } = await client
    .from('workspace_meta_accounts')
    .select('rotulo')
    .eq('workspace_id', workspaceId)
    .eq('account_id', conta)
    .maybeSingle()
  return data?.rotulo ?? null
}

export const RAIO_X_WINDOWS = [
  { key: '30d', label: 'Últimos 30 Dias', days: 30 },
  { key: '15d', label: 'Últimos 15 Dias', days: 15 },
  { key: '7d',  label: 'Últimos 7 Dias',  days: 7 },
] as const

export type RaioXWindowKey = (typeof RAIO_X_WINDOWS)[number]['key']

export interface RaioXVslSnapshot {
  /** Soma das duration de TODOS players selecionados (segundos) */
  durationTotal: number
  /** Soma das pitch_time de TODOS players selecionados (segundos) */
  pitchTotal: number
  /** Média ponderada da duração — usada quando "tempo de uma VSL" não faz sentido */
  durationAvg: number
  pitchAvg: number
  /** Stats agregados (SUM absolutos + RECALC taxas) */
  stats: VturbSessionStats | null
  /** Quantos players foram somados */
  playerCount: number
}

export interface RaioXWindow {
  key: RaioXWindowKey
  label: string
  from: string
  to: string
  summary: PeriodSummary
  vsl: RaioXVslSnapshot
}

export interface RaioXReport {
  generatedAt: string         // ISO UTC
  geradoEmBR: string          // YYYY-MM-DD em UTC-3
  funil: string
  conta: string
  /** Rótulo legível da conta Meta, resolvido de workspace_meta_accounts.rotulo.
   *  null quando conta='all' ou quando o rótulo não está cadastrado. */
  contaRotulo: string | null
  playerIds: string[]
  playerNames: string[]
  windows: RaioXWindow[]
  vturbAvailable: boolean
}

interface BuildArgs {
  funil: string
  conta: string
  /** csv de player ids, "all", ou vazio (= primeiro player) */
  playersArg?: string
}

/**
 * Resolve quais players da vTurb usar baseado em `playersArg`.
 *  - undefined / '' → array vazio (sem VSL no relatório)
 *  - 'all'          → todos players
 *  - 'id1,id2,..'   → match contra a lista real
 */
function resolveSelectedPlayers(playersArg: string | undefined, all: VturbPlayer[]): VturbPlayer[] {
  if (!playersArg) return []
  if (playersArg === 'all') return all
  const ids = playersArg.split(',').map(s => s.trim()).filter(Boolean)
  return ids.map(id => all.find(p => p.id === id)).filter((p): p is VturbPlayer => Boolean(p))
}

async function buildVslSnapshot(players: VturbPlayer[], from: string, to: string): Promise<RaioXVslSnapshot> {
  if (players.length === 0) {
    return { durationTotal: 0, pitchTotal: 0, durationAvg: 0, pitchAvg: 0, stats: null, playerCount: 0 }
  }
  const settled = await Promise.allSettled(
    players.map(p => sessionStats({
      playerId: p.id, startDate: from, endDate: to,
      videoDuration: p.duration, pitchTime: p.pitch_time,
    }))
  )
  const validStats = settled
    .filter((r): r is PromiseFulfilledResult<VturbSessionStats> => r.status === 'fulfilled')
    .map(r => r.value)
  const stats = validStats.length > 0 ? aggregateStats(validStats) : null

  const durationTotal = players.reduce((s, p) => s + (p.duration || 0), 0)
  const pitchTotal    = players.reduce((s, p) => s + (p.pitch_time || 0), 0)
  const durationAvg   = durationTotal / players.length
  const pitchAvg      = pitchTotal / players.length

  return { durationTotal, pitchTotal, durationAvg, pitchAvg, stats, playerCount: players.length }
}

/**
 * Constrói o relatório completo do RAIO-X.
 *
 * Estratégia de fetch:
 *  - PeriodSummary é independente por janela (já cacheado via fetchTransacoes/fetchMetaAds em supabase.ts)
 *  - vTurb sessionStats é por (player, janela) — paralelizado via Promise.allSettled
 *  - Sem vTurb (token ausente ou playersArg vazio): retorna VSL zerado
 */
export async function buildRaioX({ funil, conta, playersArg }: BuildArgs): Promise<RaioXReport> {
  const today = todayBR()
  const vturbAvailable = Boolean(process.env.VTURB_API_TOKEN)

  let players: VturbPlayer[] = []
  let selectedPlayers: VturbPlayer[] = []
  if (vturbAvailable && playersArg) {
    try {
      players = await listPlayers()
      selectedPlayers = resolveSelectedPlayers(playersArg, players)
    } catch {
      players = []
      selectedPlayers = []
    }
  }

  // Janelas + rótulo da conta em paralelo
  const [windowsResult, contaRotulo] = await Promise.all([
    Promise.all(RAIO_X_WINDOWS.map(async (w) => {
      // "Últimos N dias incluindo hoje" → from = D-(N-1), to = hoje
      const from = daysAgoBR(w.days - 1)
      const to = today
      const [summary, vsl] = await Promise.all([
        computePeriodSummary(from, to, funil, conta),
        buildVslSnapshot(selectedPlayers, from, to),
      ])
      return { key: w.key, label: w.label, from, to, summary, vsl } as RaioXWindow
    })),
    resolveContaRotulo(conta).catch(() => null),
  ])

  return {
    generatedAt: new Date().toISOString(),
    geradoEmBR: today,
    funil,
    conta,
    contaRotulo,
    playerIds: selectedPlayers.map(p => p.id),
    playerNames: selectedPlayers.map(p => p.name),
    windows: windowsResult,
    vturbAvailable,
  }
}

// ─── Métricas calculadas pra exibição ─────────────────────────────────────────
// Mantemos a derivação aqui (não em pdfRaioX) pra poder reusar no preview da página.

export interface RaioXMetrics {
  // Métricas Gerais
  investimento: number
  faturamento: number
  lucro: number
  roi: number             // ROAS bruto (×)
  roasLiquido: number     // ROAS líquido (após taxa Hotmart) (×)
  cpa: number
  arpu: number            // ticket médio FE
  // Tráfego
  cpm: number
  ctr: number
  cpc: number
  connectRate: number     // landing_views / cliques (%) — = "carregamento" no periodSummary
  cpv: number             // custo por visualização de página: invest / landing_views
  cpi: number             // custo por initiate checkout: invest / checkouts
  convPagina: number      // vendasFront / landing_views (%)
  // VSL (vem da vTurb se disponível)
  tempoVsl: number        // segundos — soma das duração quando multi
  tempoPitch: number      // segundos — soma dos pitch_time quando multi
  playRate: number        // % (started / viewed) = total_started / total_viewed
  // NOTA: "retenção de 1º minuto" foi removida (era idêntica ao playRate —
  // total_started / total_viewed — pois a vTurb não expõe retenção por tempo
  // em /sessions/stats. Gap honesto: não exibir dado inventado.)
  // Engajamento
  retencaoPitch: number   // % (over_pitch_rate)
  cliquesBotao: number    // total_clicked
  conversoes: number      // total_conversions
  taxaConversao: number   // % (overall_conversion_rate)
  rpv: number             // total_amount_brl / total_viewed
}

export function computeMetrics(w: RaioXWindow): RaioXMetrics {
  const s = w.summary
  const v = w.vsl.stats
  const cpv  = s.landingViews > 0 ? s.investimento / s.landingViews : 0
  const cpi  = s.checkouts    > 0 ? s.investimento / s.checkouts    : 0

  return {
    // Métricas Gerais
    investimento: s.investimento,
    faturamento:  s.faturamento,
    lucro:        s.lucro,
    roi:          s.roas,
    roasLiquido:  s.roasLiquido,
    cpa:          s.cpa,
    arpu:         s.ticketMedio,
    // Tráfego
    cpm:          s.cpm,
    ctr:          s.ctr,
    cpc:          s.cpc,
    connectRate:  s.carregamento,
    cpv,
    cpi,
    convPagina:   s.convPagina,
    // VSL
    tempoVsl:     w.vsl.durationTotal,
    tempoPitch:   w.vsl.pitchTotal,
    playRate:     v ? v.play_rate * 100 : 0,
    // Engajamento
    retencaoPitch: v ? v.over_pitch_rate * 100 : 0,
    cliquesBotao:  v?.total_clicked ?? 0,
    conversoes:    v?.total_conversions ?? 0,
    taxaConversao: v ? v.overall_conversion_rate * 100 : 0,
    rpv:           v && v.total_viewed > 0 ? v.total_amount_brl / v.total_viewed : 0,
  }
}

/** Formata segundos em "MM:SS" ou "HH:MM:SS" se ≥ 1h. */
export function formatDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '—'
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export function funilLabel(funil: string): string {
  const f = (funil || 'all').toLowerCase()
  if (f === 'all') return 'Todos os funis'
  if (f.includes('col')) return 'COL — Produto Demonstrativo'
  if (f.includes('dpl')) return 'DPL — Protocolo Dentista Parceiro'
  if (f.includes('plo')) return 'PLO — Protocolo Lucro Oculto'
  if (f.includes('lps')) return 'LPS — Imersão Lucro Clínico'
  return funil
}

/**
 * Formata o label da conta Meta pra exibição.
 *
 * @param conta    - account_id numérico, 'all', ou vazio
 * @param rotulo   - rótulo cadastrado em workspace_meta_accounts.rotulo (opcional)
 *
 * Ordem de preferência:
 *  1. `rotulo` (cadastrado no banco por tenant)
 *  2. Fallback genérico "Conta ••••XXXX" (últimos 4 dígitos do account_id)
 *
 * Não hardcodeia mais IDs de conta — qualquer tenant novo funciona sem
 * alterar código.
 */
export function contaLabel(conta: string, rotulo?: string | null): string {
  if (!conta || conta === 'all') return 'Todas as contas'
  if (rotulo) return rotulo
  // Fallback: exibe apenas os últimos 4 dígitos para identificação mínima
  const sufixo = conta.length > 4 ? conta.slice(-4) : conta
  return `Conta ••••${sufixo}`
}
