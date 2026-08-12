/**
 * Backfill de comentários: o sync diário só pega os 15 posts mais recentes/conta
 * (2 páginas = ~100 coment.). Aqui puxamos os comentários dos posts ANTIGOS ainda
 * não sincronizados (instagram, comments_count>0), até ~12 páginas (600) por post.
 * Rodado em loop pela VPS, por workspace, respeitando rate limit. Idempotente
 * (UNIQUE workspace,post,external_id). Reels/feed/carrossel — todos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getInstagramOrganicConfig } from '@/lib/integrations/factory'
import { fetchComments } from '@/lib/organico/instagram'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const UUID = /^[0-9a-f-]{36}$/i
const MAX_PAGES = 12 // ~600 comentários/post

function authOk(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}
function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = new URL(req.url)
  const ws = u.searchParams.get('ws') ?? ''
  const limit = Math.min(8, Math.max(1, Number(u.searchParams.get('limit') ?? 3)))
  const supabase = sb()

  let workspaceId: string | null = UUID.test(ws) ? ws : null
  if (!workspaceId) {
    const { data } = await supabase.from('workspaces').select('id').eq('slug', ws).maybeSingle()
    workspaceId = (data as { id?: string } | null)?.id ?? null
  }
  if (!workspaceId) return NextResponse.json({ error: `workspace '${ws}' não encontrado` }, { status: 404 })

  const cfg = await getInstagramOrganicConfig(workspaceId)
  if (!cfg) return NextResponse.json({ error: 'sem config/token de Instagram' }, { status: 400 })

  // posts (IG) com comentários ainda NÃO sincronizados (sem nenhuma linha em organic_comments)
  const syncedSet = async () => {
    const { data } = await supabase.from('organic_comments').select('post_id').eq('workspace_id', workspaceId)
    return new Set((((data ?? []) as Array<{ post_id: string }>)).map((r) => r.post_id))
  }
  const synced = await syncedSet()
  const { data: postsRaw } = await supabase.from('organic_posts')
    .select('id, external_id, comments_count, organic_accounts!inner ( external_id )')
    .eq('workspace_id', workspaceId).eq('platform', 'instagram').gt('comments_count', 0)
    .order('comments_count', { ascending: false }).limit(2000)
  type P = { id: string; external_id: string; comments_count: number; organic_accounts: { external_id: string } }
  const posts = ((postsRaw ?? []) as unknown as P[])
  const unsynced = posts.filter((p) => !synced.has(p.id))
  const batch = unsynced.slice(0, limit)

  let inserted = 0, sincronizados = 0
  for (const p of batch) {
    const token = cfg.tokens[p.organic_accounts.external_id] ?? cfg.tokens['*']
    if (!token) continue
    const comments = await fetchComments(token, p.external_id, MAX_PAGES)
    if (comments.length === 0) { continue } // restrito/sem retorno
    const recs = comments.map((c) => ({
      workspace_id: workspaceId, post_id: p.id, external_id: c.externalId,
      author_handle: c.author, text: c.text, like_count: c.likeCount,
      published_at: c.publishedAt, is_reply: false,
    }))
    const { error } = await supabase.from('organic_comments')
      .upsert(recs, { onConflict: 'workspace_id,post_id,external_id', ignoreDuplicates: true })
    if (!error) { inserted += recs.length; sincronizados++ }
  }

  const remaining = unsynced.length - sincronizados
  return NextResponse.json({ ws, batch: batch.length, sincronizados, inserted, remaining })
}
