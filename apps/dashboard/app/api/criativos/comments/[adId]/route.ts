/**
 * GET  /api/criativos/comments/[adId] — comments cacheados em `meta_comments`.
 * POST /api/criativos/comments/[adId] — força refresh do Meta Graph (post_id
 *      resolvido por `getAdCreativeAssets` e gravado em `meta_comments`).
 *
 * Workspace: por enquanto resolve pelo slug `demo` (único com ads reais hoje).
 * Multi-tenant verdadeiro (mapping account_id → workspace) vem em PR 16.
 *
 * Sem `.catch(()=>{})` [mind-vault: 6nwa5txkxsq3]: erros do Meta sobem como
 * MetaGraphError com status; route devolve 502 + causa.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdCreativeAssets, getPostComments, getIgMediaComments, MetaGraphError } from '@/lib/meta-graph'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
  if (error || !data) throw new Error(`workspace slug=${slug} não encontrado: ${error?.message}`)
  return data.id
}

interface CachedComment {
  id: string
  ad_id: string
  post_id: string
  message: string | null
  created_time: string | null
  like_count: number
  reply_count: number
  sentiment: string | null
  objecao_tipo: string | null
  cached_at: string
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ adId: string }> }) {
  const { adId } = await ctx.params
  if (!adId) return NextResponse.json({ error: 'adId requerido' }, { status: 400 })

  try {
    const workspaceId = await resolveWorkspaceId()
    const { data, error } = await supa()
      .from('meta_comments')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('ad_id', adId)
      .order('created_time', { ascending: false })
      .limit(500)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const comments = (data ?? []) as CachedComment[]
    const lastCachedAt = comments.length ? comments[0].cached_at : null

    return NextResponse.json({
      adId,
      workspaceId,
      total: comments.length,
      lastCachedAt,
      stale: !lastCachedAt || (Date.now() - new Date(lastCachedAt).getTime()) > 24 * 60 * 60 * 1000,
      comments,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('comments GET failed', { adId, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ adId: string }> }) {
  const { adId } = await ctx.params
  if (!adId) return NextResponse.json({ error: 'adId requerido' }, { status: 400 })

  try {
    const workspaceId = await resolveWorkspaceId()
    const assets = await getAdCreativeAssets(adId)

    // Preferência IG: se for ad Instagram-native, comments vêm da IG Graph API.
    // FB fallback: usa effective_object_story_id (raro hoje — só Page-native ads).
    const useIg = !!assets.igMediaId
    if (!useIg && !assets.postId) {
      return NextResponse.json(
        { error: `ad ${adId} não tem nem igMediaId nem postId — provavelmente imagem estática sem post associado` },
        { status: 422 }
      )
    }

    const sourceRef = useIg ? assets.igMediaId! : assets.postId!
    const fresh = useIg
      ? await getIgMediaComments(sourceRef, { max: 500 })
      : await getPostComments(sourceRef, { max: 500 })

    if (fresh.length === 0) {
      return NextResponse.json({ adId, source: useIg ? 'ig' : 'fb', sourceRef, inserted: 0, fetched: 0 })
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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      adId,
      source: useIg ? 'ig' : 'fb',
      sourceRef,
      fetched: fresh.length,
      inserted: rows.length,
    })
  } catch (err) {
    if (err instanceof MetaGraphError) {
      log.warn('meta-graph error in POST comments', { adId, status: err.status, msg: err.message })
      return NextResponse.json({ error: err.message, status: err.status ?? null }, { status: 502 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    log.error('comments POST failed', { adId, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
