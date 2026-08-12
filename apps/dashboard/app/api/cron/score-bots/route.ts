/**
 * Cron: composite bot score cross-source (Fase 3 do plano).
 *
 * Para cada UID com ≥1 impression nas últimas 24h:
 *   1. Junta sinais de Clarity (clarity_daily por URL da variante)
 *   2. Junta sinais de GA4 (engagement rate por pagePath)
 *   3. Junta sinais de vTurb (play rate por utm_id da variante) — condicional
 *   4. Compõe score via lib/botScore.composeScore
 *   5. Upsert em bot_uids com status='suspect' (≥50) ou 'confirmed' (≥80)
 *
 * Schedule: 5 10 * * * (Vercel cron, 10:05 UTC diário — 5min após quarantine-bots)
 * Auth: x-vercel-cron OR Authorization: Bearer $CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { composeScore, type ClaritySignal, type GA4Signal } from '@/lib/botScore'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface ImpressionRow {
  experiment_id: string
  uid: string
  ip_fp: string | null
  variant: string
  timestamp: string
}

interface ExperimentRow {
  id: string
  entry_path: string
  vturb_enabled?: boolean
  variants: Array<{ slug: string; url?: string }>
}

interface ClarityDailyRow {
  dimensao_valor: string
  dead_clicks: number | null
  rage_clicks: number | null
  total_pageviews: number | null
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  if (!isVercelCron) {
    const secret = process.env.CRON_SECRET
    if (!secret) return NextResponse.json({ error: 'CRON_SECRET ausente' }, { status: 401 })
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // 1. Janela de análise: últimas 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // 2. Buscar todas impressions na janela
  const { data: impressions, error: impErr } = await supabase
    .from('impressions')
    .select('experiment_id, uid, ip_fp, variant, timestamp')
    .gte('timestamp', since)

  if (impErr) {
    return NextResponse.json({ error: 'impressions: ' + impErr.message }, { status: 500 })
  }
  if (!impressions || impressions.length === 0) {
    return NextResponse.json({ scored: 0, message: 'Sem impressões na janela' })
  }

  // 3. Experimentos referenciados (pra mapa entry_path + vturb_enabled)
  const expIds = Array.from(new Set((impressions as ImpressionRow[]).map(i => i.experiment_id)))
  const { data: exps, error: expErr } = await supabase
    .from('experiments')
    .select('id, entry_path, vturb_enabled, variants')
    .in('id', expIds)

  if (expErr) {
    return NextResponse.json({ error: 'experiments: ' + expErr.message }, { status: 500 })
  }
  const expById = new Map<string, ExperimentRow>(
    (exps ?? []).map((e: ExperimentRow) => [e.id, e])
  )

  // 4. Clarity signals — busca clarity_daily filtrado pelos paths dos experimentos
  const paths = Array.from(new Set((exps ?? []).map((e: ExperimentRow) => e.entry_path)))
  let clarityByPath = new Map<string, ClaritySignal>()
  if (paths.length > 0) {
    const { data: clarityRows } = await supabase
      .from('clarity_daily')
      .select('dimensao_valor, dead_clicks, rage_clicks, total_pageviews')
      .eq('recorte', 'url')
      .gte('data', since.slice(0, 10))
      .in('dimensao_valor', paths.map(p => 'https://example.com' + p))

    clarityByPath = new Map(
      (clarityRows ?? []).map((row: ClarityDailyRow) => {
        const total = row.total_pageviews ?? 0
        return [
          row.dimensao_valor.replace('https://example.com', ''),
          {
            deadClickRatio: total > 0 ? (row.dead_clicks ?? 0) / total : 0,
            rageClicks: row.rage_clicks ?? 0,
            totalClicks: total,
          } satisfies ClaritySignal,
        ]
      })
    )
  }

  // 5. GA4 — buscado per-batch porque exige call HTTP. Skip se não configurado.
  // Pra MVP, deixar GA4 opcional: chamamos só pra os top-3 paths em volume.
  const ga4ByPath = new Map<string, GA4Signal>()
  try {
    const { ga4IsConfigured, fetchPathEngagement } = await import('@/lib/ga4')
    if (ga4IsConfigured()) {
      const sortedPaths = paths.slice(0, 3) // top-3 paths
      const engagement = await fetchPathEngagement(sortedPaths)
      for (const e of engagement) ga4ByPath.set(e.pagePath, {
        engagementRate: e.engagementRate,
        sessions: e.sessions,
      })
    }
  } catch (e) {
    console.warn('[score-bots] GA4 fetch skipped:', (e as Error).message)
  }

  // 6. Agregar por UID
  type UidAgg = {
    experimentIds: Set<string>
    variants: Set<string>
    impCount: number
    ipFp: string | null
  }
  const byUid = new Map<string, UidAgg>()
  for (const imp of impressions as ImpressionRow[]) {
    const agg = byUid.get(imp.uid) ?? {
      experimentIds: new Set<string>(),
      variants: new Set<string>(),
      impCount: 0,
      ipFp: null,
    }
    agg.experimentIds.add(imp.experiment_id)
    agg.variants.add(imp.variant)
    agg.impCount += 1
    if (imp.ip_fp) agg.ipFp = imp.ip_fp
    byUid.set(imp.uid, agg)
  }

  // 7. Score cada UID
  const toUpsert: Array<{
    uid: string
    ip_fp: string | null
    source: string
    score: number
    signals: Record<string, unknown>
    status: 'suspect' | 'confirmed'
  }> = []

  for (const [uid, agg] of byUid.entries()) {
    // Worker signal: hoje não persistido — placeholder. Mantém false até Phase 6.
    // Clarity: pega o primeiro experimento que tem dados clarity
    let claritySignal: ClaritySignal | undefined
    let ga4Signal: GA4Signal | undefined
    let vturbEnabled = false

    for (const expId of agg.experimentIds) {
      const exp = expById.get(expId)
      if (!exp) continue
      if (exp.vturb_enabled) vturbEnabled = true
      if (!claritySignal && clarityByPath.has(exp.entry_path)) {
        claritySignal = clarityByPath.get(exp.entry_path)
      }
      if (!ga4Signal && ga4ByPath.has(exp.entry_path)) {
        ga4Signal = ga4ByPath.get(exp.entry_path)
      }
    }

    const result = composeScore({
      // worker placeholder até persistir reason em impressions
      worker: agg.impCount >= 4 ? { hit: true, reason: 'rate_burst_local' } : undefined,
      clarity: claritySignal,
      ga4: ga4Signal,
      vturbEnabled,
    })

    if (result.status === 'cleared') continue

    toUpsert.push({
      uid,
      ip_fp: agg.ipFp,
      source: 'cross_source',
      score: result.score,
      signals: { ...result.signals, imp_count: agg.impCount, exps: Array.from(agg.experimentIds) },
      status: result.status,
    })
  }

  // 8. Upsert em bot_uids
  if (toUpsert.length === 0) {
    return NextResponse.json({ scored: 0, message: 'Nenhum UID com score ≥50' })
  }

  const { error: upErr } = await supabase
    .from('bot_uids')
    .upsert(toUpsert, { onConflict: 'uid' })

  if (upErr) {
    return NextResponse.json({ error: 'upsert: ' + upErr.message }, { status: 500 })
  }

  const suspectCount = toUpsert.filter(r => r.status === 'suspect').length
  const confirmedCount = toUpsert.filter(r => r.status === 'confirmed').length
  const totalUids = byUid.size
  const pctBots = totalUids > 0 ? toUpsert.length / totalUids : 0

  return NextResponse.json({
    scored: toUpsert.length,
    suspects: suspectCount,
    confirmed_auto: confirmedCount,
    pct_bots: pctBots,
    window_hours: 24,
  })
}
