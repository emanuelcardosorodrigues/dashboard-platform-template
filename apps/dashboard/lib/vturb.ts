/**
 * vTurb Analytics API client.
 *
 * Docs: https://vturb.gitbook.io/analytics-api/pt
 * Base: https://analytics.vturb.net
 *
 * Headers obrigatórios em todas requests:
 *  - X-Api-Token
 *  - X-Api-Version: v1
 *  - Content-Type: application/json
 *
 * Rate limit Pro: 120 req/min. Cache via Next data cache (revalidate=300).
 */

const VTURB_BASE = 'https://analytics.vturb.net'
const REVALIDATE_SECONDS = 300

function token(): string {
  const t = process.env.VTURB_API_TOKEN
  if (!t) throw new Error('VTURB_API_TOKEN não configurada')
  return t
}

/**
 * vTurb exige datetime com hour/min/sec em /sessions/stats e similares.
 * Aceita 'YYYY-MM-DD' ou já-formatado. Normaliza pra 'YYYY-MM-DD HH:MM:SS'.
 *  - bound='start' → 00:00:00
 *  - bound='end'   → 23:59:59
 */
function toDateTime(d: string, bound: 'start' | 'end'): string {
  if (!d) return d
  // já tem hora? não mexe.
  if (d.includes(':') || d.includes('T')) return d
  return `${d} ${bound === 'start' ? '00:00:00' : '23:59:59'}`
}

interface FetchOptions {
  revalidate?: number
  tag?: string
}

async function vturbGet<T>(path: string, opts: FetchOptions = {}, apiToken?: string): Promise<T> {
  const url = `${VTURB_BASE}${path}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Api-Token': apiToken ?? token(),
      'X-Api-Version': 'v1',
      'Content-Type': 'application/json',
    },
    next: { revalidate: opts.revalidate ?? REVALIDATE_SECONDS, tags: opts.tag ? [opts.tag] : undefined },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`vTurb GET ${path} → ${res.status} ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export async function vturbPost<T>(path: string, body: unknown, opts: FetchOptions = {}, apiToken?: string): Promise<T> {
  const url = `${VTURB_BASE}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Api-Token': apiToken ?? token(),
      'X-Api-Version': 'v1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    next: { revalidate: opts.revalidate ?? REVALIDATE_SECONDS, tags: opts.tag ? [opts.tag] : undefined },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`vTurb POST ${path} → ${res.status} ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface VturbPlayer {
  id: string
  name: string
  pitch_time: number
  duration: number
  created_at: string
}

export interface VturbSessionStats {
  total_viewed: number
  total_started: number
  total_finished: number
  total_clicked: number
  total_conversions: number
  engagement_rate: number
  play_rate: number
  overall_conversion_rate: number
  total_amount_usd: number
  total_amount_brl: number
  total_amount_eur: number
  total_over_pitch: number
  total_under_pitch: number
  over_pitch_rate: number
}

export interface VturbDailyStat extends VturbSessionStats {
  day: string
}

export interface VturbTrafficStat {
  value: string
  total_viewed: number
  total_started: number
  total_finished: number
  total_clicked: number
  total_conversions: number
  engagement_rate: number
  play_rate: number
  overall_conversion_rate: number
  total_amount_brl: number
  total_amount_usd: number
  // over/under pitch são garantidos só no nível player (VturbSessionStats). Por UTM
  // a doc não promete — capturamos defensivamente: se a API mandar, alimenta as
  // métricas de pitch; se não, fica 0 (colunas mostram "n/d", sem regressão).
  total_over_pitch?: number
  total_under_pitch?: number
}

export interface VturbLeaderboardEntry {
  player_id: string
  total_plays: number
  uniq_plays: number
  uniq_device_plays: number
}

export interface VturbLeaderboardGroup {
  leaderboard_name: string
  event: string
  leaderboards: VturbLeaderboardEntry[]
}

// ─── API surface ──────────────────────────────────────────────────────────

export async function listPlayers(opts?: { startDate?: string; endDate?: string; apiToken?: string }): Promise<VturbPlayer[]> {
  const qs = new URLSearchParams()
  // vTurb exige datetime completo (hora:min:seg) — date-only devolve 400.
  // Mesma normalização das demais funções (toDateTime).
  if (opts?.startDate) qs.set('start_date', toDateTime(opts.startDate, 'start'))
  if (opts?.endDate) qs.set('end_date', toDateTime(opts.endDate, 'end'))
  qs.set('timezone', 'America/Sao_Paulo')
  const path = `/players/list${qs.toString() ? `?${qs}` : ''}`
  return vturbGet<VturbPlayer[]>(path, { tag: 'vturb-players' }, opts?.apiToken)
}

export interface PlayerStatsArgs {
  playerId: string
  startDate: string
  endDate: string
  videoDuration?: number
  pitchTime?: number
}

/**
 * Normaliza números do vTurb: os valores monetários vêm em CENTAVOS
 * (ex: 396818 = R$ 3.968,18 → ~R$248/venda em 16 conversões), então dividimos
 * por 100. Também coage taxas que às vezes vêm como string ("22.95").
 */
function fixVturbNums<T extends Record<string, unknown>>(o: T): T {
  const num = (v: unknown) => Number(v) || 0
  return {
    ...o,
    total_amount_brl: num(o.total_amount_brl) / 100,
    total_amount_usd: num(o.total_amount_usd) / 100,
    total_amount_eur: num(o.total_amount_eur) / 100,
    engagement_rate: num(o.engagement_rate),
    play_rate: num(o.play_rate),
    over_pitch_rate: num(o.over_pitch_rate),
    overall_conversion_rate: num(o.overall_conversion_rate),
  } as unknown as T
}

export async function sessionStats(args: PlayerStatsArgs): Promise<VturbSessionStats> {
  const raw = await vturbPost<Record<string, unknown>>('/sessions/stats', {
    player_id: args.playerId,
    start_date: toDateTime(args.startDate, 'start'),
    end_date: toDateTime(args.endDate, 'end'),
    video_duration: args.videoDuration,
    pitch_time: args.pitchTime,
    timezone: 'America/Sao_Paulo',
  }, { tag: `vturb-stats-${args.playerId}` })
  return fixVturbNums(raw) as unknown as VturbSessionStats
}

export async function sessionStatsByDay(args: PlayerStatsArgs): Promise<VturbDailyStat[]> {
  // A API retorna o dia em `date_key` (não `day`). Normalizamos pra `day` que os
  // consumidores (gráfico de Evolução diária) esperam — senão o eixo fica vazio.
  const raw = await vturbPost<Array<Record<string, unknown>>>('/sessions/stats_by_day', {
    player_id: args.playerId,
    start_date: toDateTime(args.startDate, 'start'),
    end_date: toDateTime(args.endDate, 'end'),
    video_duration: args.videoDuration,
    pitch_time: args.pitchTime,
    timezone: 'America/Sao_Paulo',
  }, { tag: `vturb-daily-${args.playerId}` })
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    ...fixVturbNums(r),
    day: String(r.day ?? r.date_key ?? ''),
  })) as unknown as VturbDailyStat[]
}

export interface TrafficStatsArgs extends PlayerStatsArgs {
  queryKey: string // utm_source, utm_campaign, utm_content, utm_term, utm_medium ou custom
  apiToken?: string // multi-tenant: token do projeto (default = env do DEMO)
}

export async function trafficStats(args: TrafficStatsArgs): Promise<VturbTrafficStat[]> {
  // A API retorna o valor do UTM em `grouped_field` (não `value`). Normalizamos
  // pra `value` na fonte, mantendo os consumidores (cron + /vsl/aggregateTraffic)
  // funcionando sem mudança. Aceita `value` também por robustez.
  const raw = await vturbPost<Array<Record<string, unknown>>>('/traffic_origin/stats', {
    player_id: args.playerId,
    start_date: toDateTime(args.startDate, 'start'),
    end_date: toDateTime(args.endDate, 'end'),
    query_key: args.queryKey,
    video_duration: args.videoDuration,
    pitch_time: args.pitchTime,
    timezone: 'America/Sao_Paulo',
  }, { tag: `vturb-traffic-${args.playerId}-${args.queryKey}` }, args.apiToken)
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    ...fixVturbNums(r),
    value: (r.value ?? r.grouped_field ?? '') as string,
  })) as VturbTrafficStat[]
}

export interface ValidUtmsArgs {
  playerId: string
  startDate: string
  endDate: string
  apiToken?: string // multi-tenant: token do projeto (default = env do DEMO)
}

/**
 * Lista quais query keys (UTMs ou parâmetros customizados) têm dados pro player
 * no período. Resposta: objeto com chaves dinâmicas e contagem de ocorrências.
 *  ex: { utm_source: 1250, utm_id: 980, sck: 85 }
 */
export async function validUtms(args: ValidUtmsArgs): Promise<Record<string, number>> {
  // A API devolve um ARRAY de objetos de uma chave cada — [{utm_id:233},{sck:105},...]
  // (a doc descreve um objeto plano, mas o real é array). Normalizamos pro
  // Record<chave,contagem> que os consumidores (cron + /vsl) esperam. Aceita
  // ambos os formatos por robustez.
  const raw = await vturbPost<unknown>('/traffic_origin/valid_utms', {
    player_id: args.playerId,
    start_date: toDateTime(args.startDate, 'start'),
    end_date: toDateTime(args.endDate, 'end'),
    timezone: 'America/Sao_Paulo',
  }, { tag: `vturb-valid-utms-${args.playerId}` }, args.apiToken)
  const out: Record<string, number> = {}
  const absorb = (o: unknown) => {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'number') out[k] = (out[k] ?? 0) + v
    }
  }
  if (Array.isArray(raw)) raw.forEach(absorb)
  else absorb(raw)
  return out
}

export interface LeaderboardArgs {
  companyId: string
  startDate: string
  endDate: string
  events?: Array<'started' | 'finished' | 'viewed' | 'clicked' | 'paused'>
  limit?: number
}

export async function eventsLeaderboard(args: LeaderboardArgs): Promise<VturbLeaderboardGroup[]> {
  const events = args.events ?? ['started', 'finished', 'clicked']
  return vturbPost<VturbLeaderboardGroup[]>('/events/leaderboard', {
    company_id: args.companyId,
    leaderboards: events.map(event => ({
      leaderboard_limit: args.limit ?? 10,
      start_date: toDateTime(args.startDate, 'start'),
      end_date: toDateTime(args.endDate, 'end'),
      event,
    })),
    timezone: 'America/Sao_Paulo',
  }, { tag: 'vturb-leaderboard' })
}

export async function userEngagement(args: PlayerStatsArgs): Promise<{
  average_watched_time: number
  engagement_rate: number
  grouped_timed: Array<{ timed: number; total_users: number }>
}> {
  if (!args.videoDuration) throw new Error('userEngagement requires videoDuration')
  return vturbPost('/times/user_engagement', {
    player_id: args.playerId,
    start_date: toDateTime(args.startDate, 'start'),
    end_date: toDateTime(args.endDate, 'end'),
    video_duration: args.videoDuration,
    timezone: 'America/Sao_Paulo',
  }, { tag: `vturb-engagement-${args.playerId}` })
}

export interface VturbEngagementByOrigin {
  group_key: string
  // A API real devolve `totalUsers` (camelCase); aceito total_users por robustez.
  group_values: Array<{ timed: number; totalUsers?: number; total_users?: number }>
}

/**
 * Retenção por segundo AGRUPADA por query_key (utm) — é o endpoint que dá
 * retenção por TEMPO segmentada por CRIATIVO (o /times/user_engagement comum
 * ignora utm). Usado pra "1º minuto por criativo".
 */
export async function userEngagementByTrafficOrigin(args: {
  playerId: string; queryKey: string; values: string[]; startDate: string; endDate: string; videoDuration?: number; apiToken?: string
}): Promise<VturbEngagementByOrigin[]> {
  const raw = await vturbPost<unknown>('/times/user_engagement_by_traffic_origin', {
    player_id: args.playerId,
    query_key: args.queryKey,
    values: args.values,
    start_date: toDateTime(args.startDate, 'start'),
    end_date: toDateTime(args.endDate, 'end'),
    video_duration: args.videoDuration,
    timezone: 'America/Sao_Paulo',
  }, { tag: `vturb-engage-origin-${args.playerId}-${args.queryKey}` }, args.apiToken)
  const obj = raw as { data?: VturbEngagementByOrigin[] }
  const arr = Array.isArray(raw) ? (raw as VturbEngagementByOrigin[]) : (obj?.data ?? [])
  return Array.isArray(arr) ? arr : []
}

/**
 * Usuários que alcançaram >= `sec` segundos. `group_values` é um HISTOGRAMA de
 * drop-off (cada usuário contado uma vez no segundo MÁXIMO que alcançou — a soma
 * dos buckets = total de plays). Então "alcançaram 60s" = SOMA dos buckets com
 * timed >= sec. Campo real = `totalUsers` (camelCase).
 */
export function usersReachedSecond(groupValues: Array<{ timed: number; totalUsers?: number; total_users?: number }>, sec: number): number {
  let sum = 0
  for (const g of groupValues || []) {
    if (g.timed >= sec) sum += (g.totalUsers ?? g.total_users ?? 0)
  }
  return sum
}

export interface QuotaUsage {
  quotas: Array<{
    interval_seconds: number
    interval_starts_at: string
    interval_ends_at: string
    queries: { used: number; limit: number; remaining: number }
    read_bytes: { used: number; limit: number | null; remaining: number | null }
  }>
}

export async function quotaUsage(): Promise<QuotaUsage> {
  return vturbGet<QuotaUsage>('/quota/usage', { revalidate: 0 })
}

// ─── Multi-player aggregation ─────────────────────────────────────────────
// Soma direta dos campos absolutos; taxas (play_rate, engagement_rate, conversion_rate, over_pitch_rate)
// são RECALCULADAS a partir dos totais — média de taxas dá número errado quando os players têm
// volume desigual (mesmo bug que motivou Take Rate agregado em Verdade Cristalina).

const ABS_KEYS = [
  'total_viewed', 'total_started', 'total_finished', 'total_clicked', 'total_conversions',
  'total_amount_usd', 'total_amount_brl', 'total_amount_eur', 'total_over_pitch', 'total_under_pitch',
] as const

type AbsKey = (typeof ABS_KEYS)[number]

function sumAbs<T extends Record<AbsKey, number>>(items: T[]): Record<AbsKey, number> {
  const out = Object.fromEntries(ABS_KEYS.map((k) => [k, 0])) as Record<AbsKey, number>
  for (const it of items) for (const k of ABS_KEYS) out[k] += Number(it[k]) || 0
  return out
}

function deriveRates(sums: Record<AbsKey, number>): Pick<VturbSessionStats, 'engagement_rate' | 'play_rate' | 'overall_conversion_rate' | 'over_pitch_rate'> {
  const safe = (n: number, d: number) => (d > 0 ? n / d : 0)
  return {
    play_rate: safe(sums.total_started, sums.total_viewed),
    engagement_rate: safe(sums.total_finished, sums.total_started),
    overall_conversion_rate: safe(sums.total_conversions, sums.total_viewed),
    over_pitch_rate: safe(sums.total_over_pitch, sums.total_started),
  }
}

/** Aggrega N VturbSessionStats em um só (soma absolutos, deriva taxas dos totais). */
export function aggregateStats(items: VturbSessionStats[]): VturbSessionStats {
  const sums = sumAbs(items)
  const rates = deriveRates(sums)
  return { ...sums, ...rates }
}

/** Aggrega arrays de daily stats por data (chave `day`). */
export function aggregateDaily(arrays: VturbDailyStat[][]): VturbDailyStat[] {
  const byDay = new Map<string, VturbDailyStat[]>()
  for (const arr of arrays) {
    for (const row of arr) {
      if (!byDay.has(row.day)) byDay.set(row.day, [])
      byDay.get(row.day)!.push(row)
    }
  }
  return [...byDay.entries()]
    .map(([day, rows]) => ({ day, ...aggregateStats(rows) }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** Aggrega arrays de traffic stats por (queryKey já é fixo → group por `value`). */
export function aggregateTraffic(arrays: VturbTrafficStat[][]): VturbTrafficStat[] {
  const byValue = new Map<string, VturbTrafficStat[]>()
  for (const arr of arrays) {
    for (const row of arr) {
      const key = row.value || ''
      if (!byValue.has(key)) byValue.set(key, [])
      byValue.get(key)!.push(row)
    }
  }
  return [...byValue.entries()].map(([value, rows]) => {
    const sums = sumAbs(rows as unknown as Record<AbsKey, number>[])
    const rates = deriveRates(sums)
    return { value, ...sums, ...rates } as VturbTrafficStat
  })
}
