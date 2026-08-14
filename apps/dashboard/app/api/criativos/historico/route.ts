import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireActiveWorkspaceAuth } from '@/lib/apiAuth'
import {
  fetchFunisConfig,
  fetchMetaAds,
  fetchTransacoes,
  filterByAccount,
  filterByFunil,
  filterTransacoesByFunil,
} from '@/lib/supabase'
import { buildCreativePerformanceHistory } from '@/lib/creativePerformanceHistory'

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

function parseTop(raw: string | null): number | null {
  if (raw == null || raw === '') return 10
  if (!/^\d+$/.test(raw)) return null
  const top = Number(raw)
  return Number.isSafeInteger(top) && top >= 1 && top <= MAX_TOP ? top : null
}

function parseAdIds(raw: string | null): string[] | null {
  if (!raw) return []
  const values = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))]
  if (values.length > MAX_AD_IDS || values.some((value) => !AD_ID.test(value))) return null
  return values
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
 * GET /api/criativos/historico?de=&ate=&funil=&conta=&adIds=a,b&top=10
 *
 * A query não recebe workspace do cliente: o tenant vem exclusivamente da sessão
 * e do workspace ativo autorizado. A resposta expõe somente nomes de criativos e
 * métricas agregadas, nunca linhas de transação nem dados de comprador.
 */
export async function GET(req: NextRequest) {
  const auth = await requireActiveWorkspaceAuth()
  if ('error' in auth) return auth.error

  const sp = req.nextUrl.searchParams
  const de = sp.get('de') ?? ''
  const ate = sp.get('ate') ?? ''
  const funil = sp.get('funil') ?? 'all'
  const conta = sp.get('conta') ?? 'all'
  const top = parseTop(sp.get('top'))
  const adIds = parseAdIds(sp.get('adIds'))

  if ((de && !validDate(de)) || (ate && !validDate(ate))) {
    return NextResponse.json({ error: 'Período inválido: use YYYY-MM-DD' }, { status: 400 })
  }
  if (de && ate && de > ate) {
    return NextResponse.json({ error: '`de` não pode ser posterior a `ate`' }, { status: 400 })
  }
  if (funil.length > 64 || conta.length > 128) {
    return NextResponse.json({ error: 'Filtro inválido' }, { status: 400 })
  }
  if (top == null) {
    return NextResponse.json({ error: `top deve ser inteiro entre 1 e ${MAX_TOP}` }, { status: 400 })
  }
  if (adIds == null) {
    return NextResponse.json({ error: `adIds inválidos (máximo ${MAX_AD_IDS})` }, { status: 400 })
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

    const history = buildCreativePerformanceHistory(meta, transacoes, { days: days ?? undefined, top })
    return NextResponse.json({
      ...history,
      meta: {
        from: de || null,
        to: ate || null,
        top,
        selectedCreatives: new Set(meta.map((row) => row.criativo || row.ad_name || '(sem nome)')).size,
      },
    })
  } catch (error) {
    console.error('[criativos/historico] failed', error)
    return NextResponse.json({ error: 'Não foi possível carregar o histórico de performance' }, { status: 500 })
  }
}
