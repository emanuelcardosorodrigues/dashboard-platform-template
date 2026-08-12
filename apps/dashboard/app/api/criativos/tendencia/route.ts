import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { projetarMetrica } from '@/lib/metrics/sparkline'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

export const dynamic = 'force-dynamic'

type Metrica = 'hold_rate' | 'hook_rate' | 'ctr' | 'cpc_link' | 'cpa'
const METRICAS_VALIDAS: readonly Metrica[] = ['hold_rate', 'hook_rate', 'ctr', 'cpc_link', 'cpa']

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

function todayISO(): string {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

interface DailyRow {
  data: string | null
  impressoes: number | null
  cliques_link: number | null
  views_3seg: number | null
  views_75pct: number | null
  views_95pct: number | null
  investimento: number | null
  compras: number | null
}

function calcMetrica(metrica: Metrica, rows: DailyRow[]): number | null {
  const imp = rows.reduce((s, r) => s + (r.impressoes ?? 0), 0)
  const clk = rows.reduce((s, r) => s + (r.cliques_link ?? 0), 0)
  const v3s = rows.reduce((s, r) => s + (r.views_3seg ?? 0), 0)
  const v75 = rows.reduce((s, r) => s + ((r.views_75pct ?? r.views_95pct) ?? 0), 0)
  const inv = rows.reduce((s, r) => s + (r.investimento ?? 0), 0)
  const cmp = rows.reduce((s, r) => s + (r.compras ?? 0), 0)
  switch (metrica) {
    case 'hold_rate': return imp > 0 ? v75 / imp : null
    case 'hook_rate': return imp > 0 ? v3s / imp : null
    case 'ctr': return imp > 0 ? clk / imp : null
    case 'cpc_link': return clk > 0 ? inv / clk : null
    case 'cpa': return cmp > 0 ? inv / cmp : null
  }
}

/**
 * Histórico/projeção por ad — JANELA DE DIAS ATIVOS (não calendário):
 * se o anúncio não rodou nos últimos 7 dias, retorna os últimos 7 dias em que
 * ele RODOU (impressões > 0), mesmo que sejam menos de 7.
 *
 * A projeção SEMPRE existe enquanto houver base: (1) tendência dos dias ativos
 * (`historico`); (2) métrica agregada da janela ativa — derivada das métricas
 * que influenciam (somas de invest/cliques/compras) — (`agregado-janela`);
 * (3) agregado de toda a vida do ad (`agregado-vida`). Só vira `sem-dados`
 * quando nem a vida inteira define a métrica (ex: CPA com 0 compras sempre).
 */
export async function GET(req: NextRequest) {
  const adId = req.nextUrl.searchParams.get('ad_id') ?? ''
  const metricaRaw = req.nextUrl.searchParams.get('metrica') ?? 'hold_rate'

  if (!adId || !/^[a-zA-Z0-9_\-]+$/.test(adId)) {
    return NextResponse.json({ error: 'ad_id inválido' }, { status: 400 })
  }
  if (!(METRICAS_VALIDAS as readonly string[]).includes(metricaRaw)) {
    return NextResponse.json({ error: 'metrica inválida', aceitas: METRICAS_VALIDAS }, { status: 400 })
  }
  const metrica = metricaRaw as Metrica
  const today = todayISO()

  const supabase = getClient()
  const wsId = await getActiveWorkspaceId()
  // Toda a vida do ad (dias com impressão), mais recente primeiro. Escopado ao
  // projeto ativo — ad_id só é único POR workspace (migration 0031).
  const { data: rows } = await supabase.from('meta_ads')
    .select('data,impressoes,cliques_link,views_3seg,views_75pct,views_95pct,investimento,compras')
    .eq('workspace_id', wsId)
    .eq('ad_id', adId)
    .gt('impressoes', 0)
    .order('data', { ascending: false })
    .limit(1000)

  const rowsTyped = (rows as DailyRow[] | null) ?? []

  // Agrupa por dia (desc) e pega os 7 dias ATIVOS mais recentes.
  const byDay = new Map<string, DailyRow[]>()
  for (const r of rowsTyped) {
    if (!r.data) continue
    const d = r.data.slice(0, 10)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d)!.push(r)
  }
  const activeDaysDesc = Array.from(byDay.keys()).sort((a, b) => b.localeCompare(a))
  const window7 = activeDaysDesc.slice(0, 7).sort((a, b) => a.localeCompare(b)) // asc

  const history: Array<{ day: string; value: number | null }> = window7.map((d) => ({
    day: d,
    value: calcMetrica(metrica, byDay.get(d) ?? []),
  }))

  // Cadeia de base da projeção (sempre que possível, projetar):
  // histórico diário → agregado da janela ativa → agregado da vida do ad.
  const windowRows = window7.flatMap((d) => byDay.get(d) ?? [])
  const aggJanela = calcMetrica(metrica, windowRows)
  const aggVida = calcMetrica(metrica, rowsTyped)
  const fallback = aggJanela ?? aggVida

  const proj = projetarMetrica(
    history.map((p) => ({ date: p.day, value: p.value })),
    { hoje: today, horizon: 7, fallback },
  )
  const basis: 'historico' | 'agregado-janela' | 'agregado-vida' | 'sem-dados' =
    proj.basis === 'historico' ? 'historico'
      : proj.basis === 'fallback' ? (aggJanela != null ? 'agregado-janela' : 'agregado-vida')
        : 'sem-dados'

  const projection = proj.basis === 'sem-dados'
    ? []
    : proj.projection.map((p) => ({ day: p.date, value: p.value }))

  return NextResponse.json({
    history,
    projection,
    meta: {
      basis,
      activeDays: window7.length,
      windowFrom: window7[0] ?? null,
      windowTo: window7[window7.length - 1] ?? null,
      stale: (window7[window7.length - 1] ?? today) < today, // janela acabou antes de hoje
      confidence: proj.confidence,
    },
  })
}
