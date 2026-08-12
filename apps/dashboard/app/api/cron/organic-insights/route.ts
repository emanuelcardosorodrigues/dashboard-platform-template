/**
 * Cron: recalcula os insights determinísticos (cache) + persiste scores
 * (composite/outlier) e first7 dos posts. Roda por workspace; sem IA.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'
import { computeOrganicInsights, type CorrPost, type CorrProfileDay, type CorrComment } from '@/lib/organico/correlations'
import { computeScores, type ScorablePost } from '@/lib/organico/scores'
import { log } from '@/lib/log'

/** Máximo de comentários analisados por workspace por execução do cron. */
const COMMENTS_LIMIT = 2000

/** Tamanho máximo de cada lote no upsert em batch de scores. */
const SCORE_BATCH_SIZE = 50

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function db(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}
function authOk(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

async function processWorkspace(supabase: SupabaseClient, workspaceId: string, nowMs: number) {
  const [{ data: posts }, { data: profile }, { data: comments, count: commentsCount }] = await Promise.all([
    supabase.from('organic_posts')
      .select('id, platform, format, published_at, duration_seconds, views, apv, completion_rate, avg_watch_time_s, likes, comments_count, shares, saves, tema, traffic_sources')
      .eq('workspace_id', workspaceId).limit(1000),
    supabase.from('organic_profile_daily')
      .select('date, follows, unfollows, subs_gained, subs_lost').eq('workspace_id', workspaceId)
      .gte('date', new Date(nowMs - 120 * 86400_000).toISOString().slice(0, 10)),
    supabase.from('organic_comments')
      .select('post_id, themes', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .not('analyzed_at', 'is', null)
      .order('analyzed_at', { ascending: false })
      .limit(COMMENTS_LIMIT),
  ])
  if (commentsCount != null && commentsCount > COMMENTS_LIMIT) {
    log.info('[organic-insights] comentários truncados', {
      workspace: workspaceId, total: commentsCount, usado: COMMENTS_LIMIT,
    })
  }
  const P = (posts ?? []) as Array<CorrPost & ScorablePost>

  // insights determinísticos → cache
  const insights = computeOrganicInsights(
    P as CorrPost[], (profile ?? []) as CorrProfileDay[], (comments ?? []) as CorrComment[], nowMs,
  )
  await supabase.from('organic_insights_cache')
    .upsert({ workspace_id: workspaceId, computed_at: new Date().toISOString(), insights }, { onConflict: 'workspace_id' })

  // scores persistidos em lote (evita N round-trips sequenciais)
  const scores = computeScores(P as ScorablePost[], nowMs)
  const scoreRows = Array.from(scores.entries())
    .filter(([, s]) => s.composite != null || s.outlier != null)
    .map(([postId, s]) => ({
      id: postId,
      workspace_id: workspaceId,
      composite_score: s.composite,
      outlier_score: s.outlier,
    }))

  // Upsert em chunks de SCORE_BATCH_SIZE pra não estourar limites de payload
  for (let i = 0; i < scoreRows.length; i += SCORE_BATCH_SIZE) {
    const chunk = scoreRows.slice(i, i + SCORE_BATCH_SIZE)
    await supabase.from('organic_posts')
      .upsert(chunk, { onConflict: 'id', ignoreDuplicates: false })
  }

  return { posts: P.length, insights: insights.length, scores: scoreRows.length }
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = db()
  const wsParam = new URL(req.url).searchParams.get('ws')
  let workspaceIds: string[]
  if (wsParam && /^[0-9a-f-]{36}$/i.test(wsParam)) {
    workspaceIds = [wsParam]
  } else {
    const [def, yt, ig, tt] = await Promise.all([
      getActiveWorkspaceId(),
      listWorkspacesWithProvider('youtube'),
      listWorkspacesWithProvider('instagram'),
      listWorkspacesWithProvider('tiktok'),
    ])
    workspaceIds = [...new Set([def, ...yt, ...ig, ...tt])]
  }

  const nowMs = Date.now()
  const results: Record<string, unknown> = {}
  for (const ws of workspaceIds) {
    try { results[ws] = await processWorkspace(supabase, ws, nowMs) }
    catch (e) { results[ws] = { erro: (e as Error).message } }
  }

  revalidateTag('sb-organico', 'max')
  return NextResponse.json({ workspaces: results })
}
