/**
 * Resolve a URL do vídeo de um post orgânico pro worker de transcrição da VPS
 * (token só no Vercel; a VPS só recebe a URL e baixa). Espelha /api/cron/media
 * dos criativos pagos. Auth: só Bearer CRON_SECRET (o ?k= vazava em access logs;
 * a VPS já migrou pra Bearer).
 *
 * GET /api/cron/organic-media?post_id=<uuid>
 *  - Instagram: page token → Graph GET /{media}?fields=media_url (CDN, expira →
 *    por isso a VPS resolve na hora de baixar). Só REELS/VIDEO têm áudio.
 *  - YouTube: devolve a watch URL (a VPS baixa o áudio via yt-dlp).
 * Resposta: { kind: 'video'|'none', url: string|null, platform }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getInstagramOrganicConfig } from '@/lib/integrations/factory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GRAPH = 'https://graph.facebook.com/v20.0'

function authOk(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  if (!s) return false
  return req.headers.get('authorization') === `Bearer ${s}`
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const postId = new URL(req.url).searchParams.get('post_id') ?? ''
  if (!postId) return NextResponse.json({ error: 'post_id obrigatório' }, { status: 400 })

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data, error } = await sb.from('organic_posts')
    .select('workspace_id, platform, external_id, format, permalink, account_id')
    .eq('id', postId).maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'post não encontrado' }, { status: 404 })
  const post = data as { workspace_id: string; platform: string; external_id: string; format: string | null; permalink: string | null; account_id: string }

  if (post.platform === 'youtube') {
    // VPS baixa o áudio via yt-dlp a partir da watch URL
    return NextResponse.json({ kind: 'video', platform: 'youtube', url: `https://www.youtube.com/watch?v=${post.external_id}` })
  }

  if (post.platform === 'instagram') {
    // só vídeo tem áudio. O page token é por conta IG (igUserId); descobrimos a
    // conta dona do post e pegamos o token dela no mapa cifrado.
    const cfg = await getInstagramOrganicConfig(post.workspace_id)
    const tokens = cfg?.tokens ?? {}
    const { data: accRow } = await sb.from('organic_accounts')
      .select('external_id').eq('id', post.account_id).maybeSingle()
    const igUserId = (accRow as { external_id?: string } | null)?.external_id
    const keys = Object.keys(tokens).filter((k) => k !== '__user')
    const token = (igUserId && tokens[igUserId]) || (keys.length === 1 ? tokens[keys[0]] : null)
    if (!token) return NextResponse.json({ kind: 'none', platform: 'instagram', url: null, hint: 'sem page token' })
    try {
      const res = await fetch(`${GRAPH}/${post.external_id}?fields=media_url,media_type,media_product_type&access_token=${token}`)
      const j = await res.json() as { media_url?: string; media_type?: string; error?: { message?: string } }
      if (j.error || !j.media_url || j.media_type !== 'VIDEO') {
        return NextResponse.json({ kind: 'none', platform: 'instagram', url: null })
      }
      return NextResponse.json({ kind: 'video', platform: 'instagram', url: j.media_url })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 })
    }
  }

  return NextResponse.json({ kind: 'none', platform: post.platform, url: null })
}
