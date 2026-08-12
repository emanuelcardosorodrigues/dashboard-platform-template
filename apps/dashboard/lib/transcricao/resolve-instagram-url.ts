/**
 * Resolve a URL de um reel público do Instagram para uma CDN URL de áudio.
 * Deve ser chamada a partir de Vercel/Next.js (IP não bloqueado pelo IG).
 * O VPS Hetzner recebe DASH sem áudio; Vercel recebe DASH completo.
 */

const IG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function extractShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}

function decodeIgString(raw: string): string {
  return raw
    .replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\n/g, '\n')
}

function extractAudioUrl(dashManifest: string): string | null {
  // Procura AdaptationSet com contentType="audio"
  const audioSection = dashManifest.match(
    /<AdaptationSet[^>]+contentType="audio"[^>]*>([\s\S]*?)<\/AdaptationSet>/
  )
  if (!audioSection) return null
  const baseUrlMatch = audioSection[1].match(/<BaseURL>(https:\/\/[^<]+)<\/BaseURL>/)
  if (!baseUrlMatch) return null
  // DASH manifest é XML: & nos parâmetros de query vem como &amp;
  return baseUrlMatch[1].replace(/&amp;/g, '&')
}

export interface ResolveResult {
  mediaUrl: string
  thumbnailUrl: string | null
  source: 'video_url_direct' | 'dash_audio_stream'
}

/**
 * Faz fetch da página do reel e extrai a CDN URL de áudio.
 * Retorna null se não conseguir (reel privado, URL inválida, etc).
 */
export async function resolveInstagramMediaUrl(shortcode: string): Promise<ResolveResult | null> {
  const pageRes = await fetch(`https://www.instagram.com/reel/${shortcode}/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })
  if (!pageRes.ok) return null

  const html = await pageRes.text()

  // thumbnail (og:image)
  const thumbMatch = html.match(/<meta property="og:image" content="([^"]+)"/)
  const thumbnailUrl = thumbMatch ? thumbMatch[1] : null

  // has_audio
  const hasAudioMatch = html.match(/"has_audio"\s*:\s*(true|false)/)
  const hasAudio = hasAudioMatch ? hasAudioMatch[1] === 'true' : null

  // video_url direto
  const videoUrlMatch = html.match(/"video_url"\s*:\s*"(https[^"\\]+(?:\\.[^"\\]*)*)"/)
  const videoUrl = videoUrlMatch ? decodeIgString(videoUrlMatch[1]) : null

  if (videoUrl && hasAudio === true) {
    return { mediaUrl: videoUrl, thumbnailUrl, source: 'video_url_direct' }
  }

  // DASH manifest → stream de áudio
  const dashMatch = html.match(/"video_dash_manifest"\s*:\s*"((?:[^"\\]|\\.)+?)"/)
  if (dashMatch) {
    const dashManifest = decodeIgString(dashMatch[1])
    const audioUrl = extractAudioUrl(dashManifest)
    if (audioUrl) {
      return { mediaUrl: audioUrl, thumbnailUrl, source: 'dash_audio_stream' }
    }
  }

  return null
}
