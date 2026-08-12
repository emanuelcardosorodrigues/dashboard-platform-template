/**
 * Vídeo (mp4) PERMANENTE do criativo — espelho no nosso Storage (A-F0).
 *
 * O Meta entrega o vídeo por URL fbcdn ASSINADA (validade no `oe=`), que morre em
 * ~2 semanas e devolve 403 calado. Guardar essa URL no banco é guardar um link com
 * prazo — o mesmo apodrecimento silencioso das thumbnails (ver criativo-thumbnail).
 * Este módulo baixa o mp4 UMA vez, no momento da análise (quando a URL ainda é
 * fresca), e republica no bucket 'criativos' ao lado dos frames/thumb. O que vai
 * pro banco é sempre URL nossa — o player do popup só confia nela (default-deny).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { log } from './log'
import { THUMB_BUCKET } from './criativo-thumbnail'

// Anúncio é curto; acima disso não espelha (evita segurar um binário gigante em
// memória no serverless). fbcdn quase sempre manda content-length.
const MAX_BYTES = 120 * 1024 * 1024

/** Caminho determinístico, ao lado dos frames do mesmo ad. Re-rodar sobrescreve. */
export function videoPath(adId: string): string {
  return `${adId}/video.mp4`
}

/** Só URL do nosso bucket é confiável (default-deny, igual à thumbnail). */
export function isVideoPermanente(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.hostname.endsWith('.supabase.co') && u.pathname.includes(`/object/public/${THUMB_BUCKET}/`)
  } catch {
    return false
  }
}

/**
 * Devolve uma URL de vídeo que não expira.
 * - Já é do nosso Storage → passa direto.
 * - fbcdn/outra origem → baixa (com teto de tamanho) e republica; devolve URL nossa.
 * - Falhou (403 vencido, grande demais, bucket fora) → `null`. O caller mantém o
 *   fallback (nunca derruba a análise por causa do vídeo).
 */
export async function persistVideo(
  supa: SupabaseClient,
  adId: string,
  sourceUrl: string | null | undefined,
): Promise<string | null> {
  if (!sourceUrl) return null
  if (isVideoPermanente(sourceUrl)) return sourceUrl

  const path = videoPath(adId)
  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) {
      log.warn('persistVideo: download falhou', { adId, status: res.status })
      return null
    }
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_BYTES) {
      log.warn('persistVideo: mp4 grande demais, não espelha', { adId, len })
      return null
    }
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) {
      log.warn('persistVideo: mp4 grande demais (sem content-length)', { adId, bytes: buf.byteLength })
      return null
    }
    const contentType = res.headers.get('content-type') ?? 'video/mp4'

    const { error } = await supa.storage.from(THUMB_BUCKET).upload(path, buf, {
      contentType,
      upsert: true,
      cacheControl: '31536000',
    })
    if (error) {
      log.warn('persistVideo: upload falhou', { adId, msg: error.message })
      return null
    }

    const { data } = supa.storage.from(THUMB_BUCKET).getPublicUrl(path)
    return data?.publicUrl ?? null
  } catch (err) {
    log.warn('persistVideo: erro', { adId, msg: err instanceof Error ? err.message : String(err) })
    return null
  }
}
