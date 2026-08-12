/**
 * Wrapper para Microsoft Clarity Data Export API.
 *
 * Limites importantes (impostos pela Microsoft):
 *   - 10 requisições / dia / projeto
 *   - numOfDays aceita 1, 2 ou 3
 *   - até 3 dimensões por chamada
 *   - retorna apenas métricas agregadas (sem recordings ou heatmaps)
 *
 * Doc: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
 */

const BASE = 'https://www.clarity.ms/export-data/api/v1/project-live-insights'

export type ClarityDimension =
  | 'URL'
  | 'Browser'
  | 'Device'
  | 'OS'
  | 'Country'
  | 'Source'
  | 'Medium'
  | 'Campaign'

export interface ClarityQuery {
  numOfDays: 1 | 2 | 3
  dimension1?: ClarityDimension
  dimension2?: ClarityDimension
  dimension3?: ClarityDimension
}

export async function fetchClarityMetrics(q: ClarityQuery, apiToken?: string): Promise<unknown[]> {
  // Multi-tenant: o token vem resolvido da factory (cred cifrada do projeto ou
  // env do DEMO). Fallback pro env mantém call sites legados/testes funcionando.
  const token = apiToken ?? process.env.CLARITY_API_TOKEN
  if (!token) throw new Error('CLARITY_API_TOKEN não configurado')

  const params = new URLSearchParams({ numOfDays: String(q.numOfDays) })
  if (q.dimension1) params.set('dimension1', q.dimension1)
  if (q.dimension2) params.set('dimension2', q.dimension2)
  if (q.dimension3) params.set('dimension3', q.dimension3)

  const res = await fetch(`${BASE}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Clarity API ${res.status}: ${body}`)
  }

  return (await res.json()) as unknown[]
}

type ClarityRecorte = 'total' | 'url' | 'device' | 'source'

interface NormalizeCtx {
  data: string
  recorte: ClarityRecorte
  dimensao: string
}

interface ClarityApiRow {
  metricName: string
  information: Array<Record<string, string | number>>
}

// Campo da dimensão dentro do objeto `information` retornado pela Clarity API.
const DIM_FIELD: Record<Exclude<ClarityRecorte, 'total'>, string> = {
  url: 'Url',
  device: 'Device',
  source: 'Source',
}

// Métricas escalares que mapeamos para colunas do schema.
// Demais métricas (Browser, OS, Country, PageTitle, ReferrerUrl, PopularPages)
// vêm sempre quebradas pelo seu próprio "name" e não fazem parte da nossa tabela.
const SCALAR_METRICS = new Set([
  'Traffic', 'ScrollDepth', 'EngagementTime',
  'DeadClickCount', 'RageClickCount', 'QuickbackClick',
  'ExcessiveScroll', 'ScriptErrorCount', 'ErrorClickCount',
])

interface AccumState {
  sessions: number
  bot_sessions: number
  pageviews: number
  // Médias ponderadas: somatório (valor * peso) e somatório (peso).
  scroll_sum: number; scroll_w: number
  engagement_sum: number; engagement_w: number
  pps_sum: number; pps_w: number
  dead: number; rage: number; quick: number
  excessive: number; script_err: number; err_click: number
}

function newState(): AccumState {
  return {
    sessions: 0, bot_sessions: 0, pageviews: 0,
    scroll_sum: 0, scroll_w: 0,
    engagement_sum: 0, engagement_w: 0,
    pps_sum: 0, pps_w: 0,
    dead: 0, rage: 0, quick: 0,
    excessive: 0, script_err: 0, err_click: 0,
  }
}

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

function applyMetric(s: AccumState, metricName: string, info: Record<string, unknown>) {
  // Peso = sessions desta linha. Para Traffic é totalSessionCount; pras demais é sessionsCount.
  const rowSessions = toNum(info.sessionsCount)

  switch (metricName) {
    case 'Traffic': {
      const sess = toNum(info.totalSessionCount)
      const pps = toNum(info.pagesPerSessionPercentage)
      s.sessions += sess
      s.bot_sessions += toNum(info.totalBotSessionCount)
      s.pageviews += Math.round(sess * pps)
      s.pps_sum += pps * sess
      s.pps_w += sess
      break
    }
    case 'ScrollDepth': {
      const sd = toNum(info.averageScrollDepth)
      const w = rowSessions || 1
      s.scroll_sum += sd * w
      s.scroll_w += w
      break
    }
    case 'EngagementTime': {
      // `activeTime` = tempo realmente engajado (segundos médios).
      const t = toNum(info.activeTime ?? info.totalTime)
      const w = rowSessions || 1
      s.engagement_sum += t * w
      s.engagement_w += w
      break
    }
    case 'DeadClickCount':    s.dead       += toNum(info.subTotal); break
    case 'RageClickCount':    s.rage       += toNum(info.subTotal); break
    case 'QuickbackClick':    s.quick      += toNum(info.subTotal); break
    case 'ExcessiveScroll':   s.excessive  += toNum(info.subTotal); break
    case 'ScriptErrorCount':  s.script_err += toNum(info.subTotal); break
    case 'ErrorClickCount':   s.err_click  += toNum(info.subTotal); break
  }
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url)
    const pathname = u.pathname.replace(/\/$/, '') || '/'
    return u.origin + pathname
  } catch {
    return url
  }
}

function stateToRow(
  s: AccumState,
  ctx: NormalizeCtx,
  dimValue: string,
  raw: unknown
): Record<string, unknown> {
  return {
    data: ctx.data,
    recorte: ctx.recorte,
    dimensao_valor: dimValue,
    sessions: s.sessions || null,
    pages_per_session: s.pps_w > 0 ? Number((s.pps_sum / s.pps_w).toFixed(2)) : null,
    total_pageviews: s.pageviews || null,
    scroll_depth_pct: s.scroll_w > 0 ? Number((s.scroll_sum / s.scroll_w).toFixed(2)) : null,
    engagement_time_sec: s.engagement_w > 0 ? Number((s.engagement_sum / s.engagement_w).toFixed(2)) : null,
    dead_clicks: s.dead || null,
    rage_clicks: s.rage || null,
    quick_backs: s.quick || null,
    excessive_scroll: s.excessive || null,
    script_errors: s.script_err || null,
    error_clicks: s.err_click || null,
    raw_json: ctx.recorte === 'total' ? raw : null, // raw só no total pra evitar bloat
  }
}

/**
 * Normaliza o array retornado pela Clarity API em linhas prontas pro Supabase.
 *
 * - `recorte='total'`: 1 linha (`dimensao_valor='*'`) com agregados gerais.
 * - `recorte='url'|'device'|'source'`: N linhas, 1 por valor de dimensão.
 *   URLs são canonicalizadas (strip query string) e agregadas por path.
 *   Contadores somam, médias são ponderadas por número de sessões.
 */
export function normalizeClarityRows(
  apiResponse: unknown[],
  ctx: NormalizeCtx
): Array<Record<string, unknown>> {
  const byDim = new Map<string, AccumState>()
  const dimField = ctx.recorte === 'total' ? null : DIM_FIELD[ctx.recorte]

  for (const m of apiResponse as ClarityApiRow[]) {
    if (!SCALAR_METRICS.has(m.metricName)) continue

    for (const info of m.information ?? []) {
      let dimValue: string
      if (dimField === null) {
        // Para 'total', ignora qualquer info que tenha algum DIM_FIELD setado
        // (pode acontecer se a API decidir incluir breakdown agressivamente).
        const hasAnyDim = Object.values(DIM_FIELD).some((k) => k in info)
        if (hasAnyDim) continue
        dimValue = '*'
      } else {
        const raw = info[dimField]
        if (raw == null || raw === '') continue
        dimValue = String(raw)
        if (ctx.recorte === 'url') dimValue = canonicalUrl(dimValue)
      }

      let state = byDim.get(dimValue)
      if (!state) {
        state = newState()
        byDim.set(dimValue, state)
      }
      applyMetric(state, m.metricName, info)
    }
  }

  return Array.from(byDim.entries()).map(([dim, state]) =>
    stateToRow(state, ctx, dim, apiResponse)
  )
}
