import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireActiveWorkspaceAuth } from '@/lib/apiAuth'
import { isCreativeAnalysisTabAllowed } from '@/lib/auth'
import {
  fetchFunisConfig,
  fetchMetaAds,
  fetchTransacoes,
  filterByAccount,
  filterByFunil,
  filterTransacoesByFunil,
} from '@/lib/supabase'
import {
  buildCreativePerformanceHistory,
  PERFORMANCE_HISTORY_METRICS,
  type PerformanceHistoryMetric,
} from '@/lib/creativePerformanceHistory'

export const dynamic = 'force-dynamic'

const MAX_TOP = 25
const MAX_AD_IDS = 500
const MAX_RANGE_DAYS = 366 * 3
const AD_ID = /^[A-Za-z0-9_-]{1,128}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function parseAdIds(raw: unknown): string[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw)) return null
  const values = [...new Set(raw.map((value) => typeof value === 'string' ? value.trim() : ''))]
  if (values.some((value) => !AD_ID.test(value)) || values.length > MAX_AD_IDS) return null
  return values
}

function parseTopByMetric(raw: unknown): Record<PerformanceHistoryMetric, number> | null {
  if (raw == null) return { hook_rate: 10, conv_body: 10, cpc_link: 10, hold_rate: 10 }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const validKeys = new Set<string>(PERFORMANCE_HISTORY_METRICS)
  if (Object.keys(input).some((key) => !validKeys.has(key))) return null
  const result = {} as Record<PerformanceHistoryMetric, number>
  for (const metric of PERFORMANCE_HISTORY_METRICS) {
    const value = input[metric]
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_TOP) return null
    result[metric] = value as number
  }
  return result
}

function optionalFilter(input: Record<string, unknown>, key: string, fallback: string, maxLength: number): string | null {
  const value = input[key]
  if (value == null) return fallback
  if (typeof value !== 'string' || value.length > maxLength) return null
  return value
}

function calendarDays(from: string, to: string): string[] | null | undefined {
  if (!from || !to) return undefined
  const start = Date.parse(`${from}T00:00:00.000Z`)
  const end = Date.parse(`${to}T00:00:00.000Z`)
  const count = Math.floor((end - start) / 86_400_000) + 1
  if (count < 1 || count > MAX_RANGE_DAYS) return null
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start)
    day.setUTCDate(day.getUTCDate() + index)
    return day.toISOString().slice(0, 10)
  })
}

/**
 * POST /api/criativos/historico
 * body: { de, ate, funil, conta, adIds: string[], topByMetric: { ... } }
 *
 * A query não recebe workspace do cliente: o tenant vem exclusivamente da sessão
 * e do workspace ativo autorizado. A resposta expõe somente nomes de criativos e
 * métricas agregadas, nunca linhas de transação nem dados de comprador.
 */
export async function POST(req: NextRequest) {
  const auth = await requireActiveWorkspaceAuth()
  if ('error' in auth) return auth.error
  // A rota fica explicitamente protegida mesmo se o proxy for ignorado num teste,
  // preview ou infraestrutura alternativa. `allowed_paths` ausente/estranho nega.
  if (auth.session.role === 'viewer' &&
    (!Array.isArray(auth.session.allowed_paths) || !isCreativeAnalysisTabAllowed(auth.session.allowed_paths, 'historico'))) {
    return NextResponse.json({ error: 'Sem acesso ao Histórico de Performance' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body inválido')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
  }
  const de = optionalFilter(body, 'de', '', 10)
  const ate = optionalFilter(body, 'ate', '', 10)
  const funil = optionalFilter(body, 'funil', 'all', 64)
  const conta = optionalFilter(body, 'conta', 'all', 128)
  const adIds = parseAdIds(body.adIds)
  const topByMetric = parseTopByMetric(body.topByMetric)

  if (de == null || ate == null || funil == null || conta == null || adIds == null || topByMetric == null) {
    return NextResponse.json({ error: 'Filtros inválidos' }, { status: 400 })
  }
  if ((de && !validDate(de)) || (ate && !validDate(ate))) {
    return NextResponse.json({ error: 'Período inválido: use YYYY-MM-DD' }, { status: 400 })
  }
  if (de && ate && de > ate) {
    return NextResponse.json({ error: '`de` não pode ser posterior a `ate`' }, { status: 400 })
  }
  const days = calendarDays(de, ate)
  if (days === null) {
    return NextResponse.json({ error: `Período máximo: ${MAX_RANGE_DAYS} dias` }, { status: 400 })
  }

  try {
    const [allMeta, allTransacoes, funis] = await Promise.all([
      fetchMetaAds(auth.workspaceId),
      fetchTransacoes(auth.workspaceId),
      fetchFunisConfig(auth.workspaceId),
    ])

    // Mesma ordem e os mesmos helpers de listCriativos: somente anúncios que
    // rodaram, período/funil/conta; as transações não têm conta Meta e seguem o
    // resolvedor de funil que usa o catálogo inteiro de Meta para a campanha.
    let meta = allMeta.filter((row) => Number(row.impressoes ?? 0) > 0)
    if (de) meta = meta.filter((row) => (row.data ?? '') >= de)
    if (ate) meta = meta.filter((row) => (row.data ?? '') <= ate)
    meta = filterByFunil(meta, funil, funis)
    meta = filterByAccount(meta, conta)
    if (adIds.length) {
      const selected = new Set(adIds)
      meta = meta.filter((row) => Boolean(row.ad_id && selected.has(row.ad_id)))
    }

    let transacoes = allTransacoes
    if (de) transacoes = transacoes.filter((row) => (row.data ?? '') >= de)
    if (ate) transacoes = transacoes.filter((row) => (row.data ?? '') <= ate)
    transacoes = filterTransacoesByFunil(transacoes, funil, allMeta, funis)

    const history = buildCreativePerformanceHistory(meta, transacoes, { days: days ?? undefined, topByMetric })
    return NextResponse.json({
      ...history,
      meta: {
        from: de || null,
        to: ate || null,
        topByMetric,
        selectedCreatives: new Set(meta.map((row) => row.criativo || row.ad_name || '(sem nome)')).size,
      },
    })
  } catch (error) {
    console.error('[criativos/historico] failed', error)
    return NextResponse.json({ error: 'Não foi possível carregar o histórico de performance' }, { status: 500 })
  }
}
