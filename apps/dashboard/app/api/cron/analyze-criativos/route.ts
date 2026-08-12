/**
 * Cron diário: análise multimodal Gemini dos criativos ativos.
 * Roda 10:00 (depois do sync-meta 9h e refresh-comments 9:45).
 *
 * Estratégia:
 *  1. Lista ad_ids elegíveis: GASTO acumulado >= R$50 OU ao menos 1 venda real
 *     na janela de 90d (criativo que gerou compra mas ainda abaixo de R$50 também entra).
 *  2. Skip os que já têm criativo_analise com status='ok' (cache eterno por hash
 *     — re-analyze acontece via POST manual com ?force=1).
 *  3. Processa até MAX_NEW_ADS_PER_RUN (4) — Gemini 2.5 Pro multimodal leva
 *     ~30-90s/criativo; com maxDuration 300s, 4 + 1 stale cabe folgado.
 *     Catchup mais rápido: POST /api/criativos/analise/batch?max=8 (admin).
 *  4. Refresh forçado de até MAX_STALE_REFRESH_PER_RUN (1) ad cuja análise
 *     mais recente é > STALE_DAYS (30) — capta drift de hook tags conforme o
 *     mercado evolui sem rodar tudo de novo.
 *
 * Auth: x-vercel-cron OU Bearer CRON_SECRET.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runAnalysisForAd, resolveWorkspaceBySlug } from '@/lib/criativo-pipeline'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ACTIVE_WINDOW_DAYS = 90
const MIN_GASTO_RELEVANTE = 50 // R$ — só analisa criativo com gasto acumulado relevante (regra do Chefe)
const MAX_NEW_ADS_PER_RUN = 4
const MAX_STALE_REFRESH_PER_RUN = 1
const STALE_DAYS = 30
const PER_AD_TIMEOUT_MS = 120_000 // 2min por criativo

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface AdRow {
  ad_id: string
  investimento: number
}
interface TransRow {
  ad_id: string | null
}

interface Candidates {
  pending: string[]
  stale: string[]
}

async function getCandidates(workspaceId: string): Promise<Candidates> {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const { data, error } = await supa()
    .from('meta_ads')
    .select('ad_id, investimento')
    .eq('workspace_id', workspaceId)
    .gte('data', cutoff)
    .not('ad_id', 'is', null)
  if (error) throw new Error(`fetch candidates: ${error.message}`)

  // Agrega GASTO por ad_id.
  const totals = new Map<string, number>()
  for (const r of (data ?? []) as AdRow[]) {
    if (!r.ad_id) continue
    totals.set(r.ad_id, (totals.get(r.ad_id) ?? 0) + (r.investimento || 0))
  }

  // Ad_ids que geraram ao menos 1 venda real na janela (regra: gasto>=R$50 OU venda>=1).
  const { data: transData } = await supa()
    .from('transacoes')
    .select('ad_id')
    .eq('workspace_id', workspaceId)
    .gte('data', cutoff)
    .gt('valor_bruto', 1)
    .not('ad_id', 'is', null)
  const idsComVenda = new Set<string>(
    ((transData ?? []) as TransRow[]).map((r) => r.ad_id).filter((id): id is string => Boolean(id))
  )

  // Inclui ad_id se gasto >= R$50 OU gerou venda (e tem algum gasto — descarta R$0 absoluto).
  for (const [id, gasto] of totals) {
    if (gasto < MIN_GASTO_RELEVANTE && !idsComVenda.has(id)) totals.delete(id)
  }
  // Criativos com venda mas sem nenhum gasto na janela de 90d ainda não estão em totals; ignoramos.

  if (totals.size === 0) return { pending: [], stale: [] }

  const allIds = [...totals.keys()]
  const { data: existing, error: exErr } = await supa()
    .from('criativo_analise')
    .select('ad_id, status, gerado_at')
    .eq('workspace_id', workspaceId)
    .in('ad_id', allIds)
  if (exErr) throw new Error(`fetch existing analise: ${exErr.message}`)

  const staleCutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000
  const okMap = new Map<string, number>() // ad_id -> gerado_at timestamp
  for (const r of (existing ?? []) as Array<{ ad_id: string; status: string; gerado_at: string | null }>) {
    if (r.status === 'ok') {
      okMap.set(r.ad_id, r.gerado_at ? new Date(r.gerado_at).getTime() : 0)
    }
  }

  const sortByGastoDesc = (a: string, b: string) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)

  const pending = allIds.filter((id) => !okMap.has(id)).sort(sortByGastoDesc).slice(0, MAX_NEW_ADS_PER_RUN)

  const stale = allIds
    .filter((id) => {
      const ts = okMap.get(id)
      return ts !== undefined && ts < staleCutoff
    })
    .sort(sortByGastoDesc)
    .slice(0, MAX_STALE_REFRESH_PER_RUN)

  return { pending, stale }
}

async function runWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let to: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    to = setTimeout(() => reject(new Error(`timeout ${label} (${ms}ms)`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (to) clearTimeout(to)
  }
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!process.env.META_ACCESS_TOKEN || !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'META_ACCESS_TOKEN ou GEMINI_API_KEY ausente' }, { status: 500 })
  }

  const startedAt = Date.now()
  const client = supa()
  let ws: Awaited<ReturnType<typeof resolveWorkspaceBySlug>>
  let candidates: Candidates
  try {
    ws = await resolveWorkspaceBySlug(client)
    candidates = await getCandidates(ws.id)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const results: Record<string, unknown> = {}

  const queue: Array<{ adId: string; force: boolean }> = [
    ...candidates.pending.map((adId) => ({ adId, force: false })),
    ...candidates.stale.map((adId) => ({ adId, force: true })),
  ]

  for (const { adId, force } of queue) {
    try {
      const r = await runWithTimeout(
        runAnalysisForAd({ supa: client, workspaceId: ws.id, workspaceCtx: ws.ctx, adId, force }),
        PER_AD_TIMEOUT_MS,
        `ad ${adId}`
      )
      results[adId] = { ...r, _refreshed: force }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('analyze-criativos per-ad error', { adId, force, msg })
      results[adId] = { status: 'failed', error: msg, _refreshed: force }
    }
  }

  return NextResponse.json({
    workspaceId: ws.id,
    pendingConsidered: candidates.pending.length,
    staleConsidered: candidates.stale.length,
    elapsedMs: Date.now() - startedAt,
    results,
  })
}
