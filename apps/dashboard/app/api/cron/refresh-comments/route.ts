/**
 * Cron diário: refresh de comments dos ads ativos (gastaram >0 nos últimos 7d).
 * Roda 9h30 (depois do sync-meta das 9h pra ter spend atualizado).
 *
 * Estratégia:
 *  1. Lê ad_ids distintos com spend > 0 nos últimos 7 dias.
 *  2. Para cada ad: resolve post_id via Meta Graph, baixa comments dos últimos
 *     30 dias (since), upsert em meta_comments.
 *  3. Erros em ad individual NÃO interrompem o batch — registram em `results`.
 *
 * Auth: x-vercel-cron OU Bearer CRON_SECRET (mesmo padrão dos outros crons).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdCreativeAssets, getPostComments, getIgMediaComments, MetaGraphError } from '@/lib/meta-graph'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const COMMENTS_LOOKBACK_DAYS = 30
const ACTIVE_ADS_WINDOW_DAYS = 7
const MAX_ADS_PER_RUN = 50

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function resolveWorkspaceId(): Promise<string> {
  const slug = process.env.DEFAULT_WORKSPACE_SLUG ?? 'demo'
  const { data, error } = await supa().from('workspaces').select('id').eq('slug', slug).single()
  if (error || !data) throw new Error(`workspace slug=${slug}: ${error?.message ?? 'não encontrado'}`)
  return data.id
}

async function getActiveAdIds(): Promise<string[]> {
  const cutoff = new Date(Date.now() - ACTIVE_ADS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const { data, error } = await supa()
    .from('meta_ads')
    .select('ad_id, investimento')
    .gte('data', cutoff)
    .gt('investimento', 0)
    .not('ad_id', 'is', null)
  if (error) throw new Error(`fetch active ads: ${error.message}`)

  // Dedup + ordenar por gasto total desc (não acumulado, só usa pra estabilidade)
  const totals = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ ad_id: string; investimento: number }>) {
    if (!r.ad_id) continue
    totals.set(r.ad_id, (totals.get(r.ad_id) ?? 0) + (r.investimento || 0))
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ADS_PER_RUN)
    .map(([id]) => id)
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

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'META_ACCESS_TOKEN não configurado' }, { status: 500 })
  }

  const startedAt = Date.now()
  let workspaceId: string
  let adIds: string[]
  try {
    workspaceId = await resolveWorkspaceId()
    adIds = await getActiveAdIds()
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const sinceDate = new Date(Date.now() - COMMENTS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const results: Record<string, { fetched?: number; inserted?: number; error?: string; skipped?: string }> = {}

  for (const adId of adIds) {
    try {
      const assets = await getAdCreativeAssets(adId)
      const useIg = !!assets.igMediaId
      const sourceRef = useIg ? assets.igMediaId! : assets.postId
      if (!sourceRef) {
        results[adId] = { skipped: 'no source ref' }
        continue
      }
      // IG Graph não suporta `since` no /comments — paginação por cursor é o
      // único caminho. Como upsert por id é idempotente, baixar tudo de novo
      // não duplica; só usa mais quota. Pra FB, mantém since.
      const fresh = useIg
        ? await getIgMediaComments(sourceRef, { max: 200 })
        : await getPostComments(sourceRef, { since: sinceDate, max: 200 })
      if (fresh.length === 0) {
        results[adId] = { fetched: 0, inserted: 0 }
        continue
      }
      const rows = fresh.map((c) => ({
        workspace_id: workspaceId,
        id: c.id,
        ad_id: adId,
        post_id: sourceRef,
        message: c.message,
        created_time: c.createdTime,
        like_count: c.likeCount,
        reply_count: c.replyCount,
        cached_at: new Date().toISOString(),
      }))
      const { error } = await supa()
        .from('meta_comments')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: false })
      if (error) {
        results[adId] = { error: error.message }
      } else {
        results[adId] = { fetched: fresh.length, inserted: rows.length }
      }
    } catch (err) {
      const msg = err instanceof MetaGraphError
        ? `${err.message} (status ${err.status ?? '?'})`
        : err instanceof Error ? err.message : String(err)
      log.warn('refresh-comments per-ad error', { adId, msg })
      results[adId] = { error: msg }
    }
  }

  const elapsedMs = Date.now() - startedAt
  return NextResponse.json({
    workspaceId,
    adsConsiderados: adIds.length,
    elapsedMs,
    results,
  })
}
