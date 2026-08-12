/**
 * Cron: coleta o TEXTO dos comentários (YouTube + Instagram) → organic_comments
 * com análise NULL (a classificação IA roda no analyze-organic-comments). Pega
 * os posts mais recentes com comentários; budget de chamadas por conta.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getYoutubeConfig, getInstagramOrganicConfig } from '@/lib/integrations/factory'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'
import { refreshAccessToken, fetchCommentThreads } from '@/lib/organico/youtube'
import { fetchComments } from '@/lib/organico/instagram'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const POSTS_PER_ACCOUNT = 15
const MAX_CALLS = 40

function db(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

function authOk(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

function resolveWorkspaces(req: NextRequest, provider: 'youtube' | 'instagram') {
  const ws = new URL(req.url).searchParams.get('ws')
  if (ws && /^[0-9a-f-]{36}$/i.test(ws)) return Promise.resolve([ws])
  return Promise.all([getActiveWorkspaceId(), listWorkspacesWithProvider(provider)])
    .then(([def, cred]) => [...new Set([def, ...cred])])
}

async function upsertComments(
  supabase: SupabaseClient, workspaceId: string, postId: string,
  comments: Array<{ externalId: string; author: string | null; text: string; likeCount: number | null; replyCount?: number | null; publishedAt: string | null }>,
): Promise<number> {
  if (comments.length === 0) return 0
  const rows = comments.map((c) => ({
    workspace_id: workspaceId, post_id: postId, external_id: c.externalId,
    author_handle: c.author, text: c.text, like_count: c.likeCount,
    reply_count: c.replyCount ?? null, published_at: c.publishedAt, is_reply: false,
  }))
  // ignoreDuplicates: não reanalisa comentário já classificado (mantém analyzed_at)
  const { error } = await supabase.from('organic_comments')
    .upsert(rows, { onConflict: 'workspace_id,post_id,external_id', ignoreDuplicates: true })
  if (error) console.warn('[sync-comments] upsert:', error.message)
  return rows.length
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = db()
  const results: Record<string, unknown> = {}

  // YouTube
  for (const workspaceId of await resolveWorkspaces(req, 'youtube')) {
    const cfg = await getYoutubeConfig(workspaceId)
    if (!cfg) continue
    const { data: accs } = await supabase.from('organic_accounts')
      .select('id, external_id').eq('workspace_id', workspaceId).eq('platform', 'youtube').neq('status', 'disconnected')
    for (const acc of (accs ?? []) as Array<{ id: string; external_id: string }>) {
      const refresh = cfg.tokens[acc.external_id] ?? cfg.tokens['*']
      if (!refresh) continue
      try {
        const token = await refreshAccessToken({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: refresh })
        const { data: posts } = await supabase.from('organic_posts')
          .select('id, external_id, comments_count').eq('workspace_id', workspaceId).eq('account_id', acc.id)
          .gt('comments_count', 0).order('published_at', { ascending: false }).limit(POSTS_PER_ACCOUNT)
        let calls = 0, total = 0
        for (const p of (posts ?? []) as Array<{ id: string; external_id: string }>) {
          if (calls >= MAX_CALLS) break
          calls += 2
          total += await upsertComments(supabase, workspaceId, p.id, await fetchCommentThreads(token, p.external_id))
        }
        results[`yt:${acc.external_id}`] = { posts: (posts ?? []).length, comentarios: total }
      } catch (e) {
        results[`yt:${acc.external_id}`] = { erro: (e as Error).message }
      }
    }
  }

  // Instagram
  for (const workspaceId of await resolveWorkspaces(req, 'instagram')) {
    const cfg = await getInstagramOrganicConfig(workspaceId)
    if (!cfg) continue
    const { data: accs } = await supabase.from('organic_accounts')
      .select('id, external_id').eq('workspace_id', workspaceId).eq('platform', 'instagram').neq('status', 'disconnected')
    for (const acc of (accs ?? []) as Array<{ id: string; external_id: string }>) {
      const pageToken = cfg.tokens[acc.external_id]
      if (!pageToken) continue
      try {
        const { data: posts } = await supabase.from('organic_posts')
          .select('id, external_id, comments_count').eq('workspace_id', workspaceId).eq('account_id', acc.id)
          .gt('comments_count', 0).order('published_at', { ascending: false }).limit(POSTS_PER_ACCOUNT)
        let calls = 0, total = 0
        for (const p of (posts ?? []) as Array<{ id: string; external_id: string }>) {
          if (calls >= MAX_CALLS) break
          calls += 2
          total += await upsertComments(supabase, workspaceId, p.id, await fetchComments(pageToken, p.external_id))
        }
        results[`ig:${acc.external_id}`] = { posts: (posts ?? []).length, comentarios: total }
      } catch (e) {
        results[`ig:${acc.external_id}`] = { erro: (e as Error).message }
      }
    }
  }

  return NextResponse.json({ contas: results })
}
