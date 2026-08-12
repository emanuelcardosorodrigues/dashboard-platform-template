import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdCreativeAssets } from '@/lib/meta-graph'
import { getMetaConfig } from '@/lib/integrations/factory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Resolve o token Meta de um projeto (?ws=slug|uuid). Sem ws → env global (DEMO). */
async function tokenForWs(wsParam: string | null): Promise<{ accessToken?: string; videoToken?: string }> {
  if (!wsParam) return {}
  let wsId = wsParam
  if (!/^[0-9a-f-]{36}$/i.test(wsParam)) {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    const { data } = await sb.from('workspaces').select('id').eq('slug', wsParam).maybeSingle()
    wsId = (data as { id?: string } | null)?.id ?? ''
  }
  if (!wsId) return {}
  const cfg = await getMetaConfig(wsId)
  if (!cfg) return {}
  return { accessToken: cfg.accessToken, videoToken: cfg.pageToken || cfg.accessToken }
}

/**
 * Resolve a mídia de um criativo via Meta (usa o META_PAGE_TOKEN pro `source`
 * do vídeo). Consumido pela VPS (worker de frames/Whisper) — o token NUNCA sai
 * do Vercel; a VPS só recebe a URL do mp4 (CDN, baixável sem token).
 *
 * Auth: só Authorization: Bearer CRON_SECRET. O ramo ?k= foi removido — vazava
 * o segredo em access logs (query string). A VPS (caller) já migrou pra Bearer.
 * Sob /api/cron/ (liberado pelo proxy).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const k = (req.headers.get('authorization') || '').replace('Bearer ', '')
  if (!process.env.CRON_SECRET || k !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const adId = url.searchParams.get('ad_id')
  if (!adId) return NextResponse.json({ error: 'ad_id requerido' }, { status: 400 })
  try {
    const tokens = await tokenForWs(url.searchParams.get('ws'))
    const a = await getAdCreativeAssets(adId, tokens)
    return NextResponse.json({
      ad_id: adId,
      video_id: a.videoId,
      source_url: a.videoUrl, // mp4 do CDN Meta — baixável sem token
      thumbnail_url: a.thumbnailUrl,
      instagram_permalink_url: a.instagramPermalinkUrl,
      copy: a.copy,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
