import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { log } from '@/lib/log'
import { extractShortcode, resolveInstagramMediaUrl } from '@/lib/transcricao/resolve-instagram-url'

export const dynamic = 'force-dynamic'

const IG_URL_RE = /instagram\.com\/(p|reels?|tv)\/[A-Za-z0-9_-]+/
const YT_URL_RE = /(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/

/** Extrai o videoId (11 chars) de qualquer formato de URL do YouTube. */
function youtubeVideoId(u: string): string | null {
  const m = u.match(YT_URL_RE)
  return m ? m[1] : null
}

/** Classifica a URL e normaliza a canônica do YouTube (pro dedup por URL funcionar). */
function classifyUrl(u: string): { source: 'instagram' | 'youtube'; url: string } | null {
  if (IG_URL_RE.test(u)) return { source: 'instagram', url: u }
  const vid = youtubeVideoId(u)
  if (vid) return { source: 'youtube', url: `https://www.youtube.com/watch?v=${vid}` }
  return null
}

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function POST(req: NextRequest) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 401 })

    const body = await req.json()
    const raw: unknown[] = Array.isArray(body?.urls) ? body.urls : []

    // Classifica cada URL (IG ou YT), normaliza a canônica e dedup interno por URL final.
    const byUrl = new Map<string, 'instagram' | 'youtube'>()
    for (const u of raw) {
      if (typeof u !== 'string') continue
      const c = classifyUrl(u.trim())
      if (c && !byUrl.has(c.url)) byUrl.set(c.url, c.source)
    }
    const classified = [...byUrl.entries()].slice(0, 20).map(([url, source]) => ({ url, source }))

    if (classified.length === 0) {
      return NextResponse.json({ error: 'Nenhum link válido do Instagram ou YouTube encontrado' }, { status: 400 })
    }

    const db = supa()
    const urls = classified.map((c) => c.url)

    // Dedup: pula URLs já em processamento/ok nos últimos 7 dias
    const { data: existing } = await db
      .from('transcricao_links')
      .select('url')
      .eq('workspace_id', workspaceId)
      .in('url', urls)
      .not('status', 'in', '("failed","no_audio")')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

    const existingUrls = new Set((existing ?? []).map((r: { url: string }) => r.url))
    const toInsert = classified.filter((c) => !existingUrls.has(c.url))
    const skipped = classified.length - toInsert.length

    if (toInsert.length === 0) {
      return NextResponse.json({ inserted: 0, skipped, ids: [] })
    }

    const expires = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

    // Instagram: resolve a media_url (CDN áudio) aqui no Vercel (IP não bloqueado
    // pelo IG; a VPS recebe DASH sem áudio). YouTube: o worker baixa direto via
    // yt-dlp — sem media_url; thumbnail é derivável do id (i.ytimg.com).
    const rows = await Promise.all(
      toInsert.map(async ({ url, source }) => {
        const base = { workspace_id: workspaceId, url, source, expires_at: expires }
        if (source === 'youtube') {
          const vid = youtubeVideoId(url)!
          return { ...base, thumbnail_url: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` }
        }
        const sc = extractShortcode(url)
        if (!sc) return base
        try {
          const res = await resolveInstagramMediaUrl(sc)
          return res?.mediaUrl
            ? { ...base, media_url: res.mediaUrl, thumbnail_url: res.thumbnailUrl ?? null }
            : base
        } catch {
          return base
        }
      })
    )

    const { data: inserted, error } = await db
      .from('transcricao_links')
      .insert(rows)
      .select('id')
    if (error) throw error

    log.info('transcricao/submit', { inserted: toInsert.length, skipped, ws: workspaceId })
    return NextResponse.json({
      inserted: toInsert.length,
      skipped,
      ids: (inserted ?? []).map((r: { id: string }) => r.id),
    })
  } catch (err) {
    log.error('transcricao/submit', { err: String(err) })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
