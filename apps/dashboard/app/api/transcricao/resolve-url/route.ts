/**
 * Resolve a URL de um reel público do Instagram → CDN URL de áudio.
 * Chamado pelo VPS worker SE a media_url não foi pré-resolvida no submit.
 *
 * GET /api/transcricao/resolve-url?url=INSTAGRAM_URL
 * Auth: Bearer CRON_SECRET
 *
 * Nota: O VPS Hetzner é bloqueado pelo Instagram para DASH com áudio;
 *       o Vercel não é. Por isso esse endpoint existe — o worker chama o
 *       Vercel que chama o Instagram e devolve a CDN URL.
 *
 *       Porém, o Cloudflare bloqueia o IP do VPS na rota do dashboard.
 *       A abordagem preferida é pré-resolver no submit (já feito). Este
 *       endpoint existe como fallback e para diagnóstico.
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractShortcode, resolveInstagramMediaUrl } from '@/lib/transcricao/resolve-instagram-url'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function authOk(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET
  if (!s) return false
  return req.headers.get('authorization') === `Bearer ${s}`
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const igUrl = searchParams.get('url') ?? ''

  if (!igUrl) {
    return NextResponse.json({ error: 'url obrigatório' }, { status: 400 })
  }

  const shortcode = extractShortcode(igUrl)
  if (!shortcode) {
    return NextResponse.json({ error: 'URL inválida — esperado /reel/, /p/ ou /tv/' }, { status: 400 })
  }

  try {
    const result = await resolveInstagramMediaUrl(shortcode)
    if (!result) {
      return NextResponse.json(
        { error: 'Sem URL de áudio encontrada (reel privado ou IP bloqueado)', shortcode },
        { status: 422 }
      )
    }
    return NextResponse.json({
      media_url: result.mediaUrl,
      thumbnail_url: result.thumbnailUrl,
      source: result.source,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
