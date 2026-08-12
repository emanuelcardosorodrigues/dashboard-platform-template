/**
 * Thumbnail PERMANENTE do criativo.
 *
 * O Meta entrega a thumbnail por URL assinada no fbcdn, com a validade embutida no
 * parâmetro `oe=` (unix hex). Passou da data, o CDN responde 403 e o card fica sem
 * prévia — mostrando o alt text. Guardar essa URL no banco é guardar um link com
 * prazo de validade: em 16/07/2026, 375 dos 394 criativos que dependiam dela já
 * estavam quebrados (o primeiro venceu em 02/06).
 *
 * Os criativos que NUNCA quebraram são os que a VPS processou: ela baixa o mp4,
 * extrai os frames e republica no nosso Storage, então a thumbnail é o 1º frame
 * numa URL nossa. Este módulo estende essa mesma garantia pra quem não tem frames
 * (anúncio de imagem, ou vídeo que a VPS não processou): baixa o binário do Meta
 * UMA vez e republica no bucket. O que vai pro banco é sempre URL nossa.
 *
 * Mesma família dos bugs de razão com denominador fraco (ver lib/metrics/convBody):
 * o dado parecia certo na hora em que foi gravado e apodreceu depois, calado.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { log } from './log'

/** Bucket público onde a VPS já publica os frames — a thumbnail mora junto. */
export const THUMB_BUCKET = 'criativos'

/**
 * Caminho determinístico, ao lado dos frames do mesmo ad (`{adId}/frame_00_hook.jpg`).
 * Determinístico = re-rodar sobrescreve, nunca multiplica arquivo órfão no bucket.
 */
export function thumbPath(adId: string): string {
  return `${adId}/thumb.jpg`
}

/**
 * Só a URL do NOSSO bucket é confiável. Qualquer outra é de terceiro e tem que ser
 * copiada antes de virar registro.
 *
 * A checagem é default-deny de propósito. A primeira versão disto listava os hosts
 * ruins (fbcdn, cdninstagram) e deixava passar o resto — e passou mesmo: 23 criativos
 * gravaram `facebook.com/ads/image/?d=…`, que responde 200 hoje e é dependência do
 * Facebook pra sempre. Lista de bloqueio erra por omissão; lista de permissão erra
 * pro lado seguro (copia demais).
 */
export function isThumbPermanente(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.hostname.endsWith('.supabase.co') && u.pathname.includes(`/object/public/${THUMB_BUCKET}/`)
  } catch {
    return false
  }
}

/**
 * Devolve uma URL de thumbnail que não expira.
 *
 * - Já é do nosso Storage → passa direto, sem baixar nada.
 * - Qualquer outra origem → baixa e republica no bucket, devolve a URL nossa.
 * - Falhou (403 de URL já vencida, bucket fora do ar) → `null`. O caller decide o
 *   fallback; nunca derruba a análise por causa de imagem.
 */
export async function persistThumbnail(
  supa: SupabaseClient,
  adId: string,
  sourceUrl: string | null | undefined,
): Promise<string | null> {
  if (!sourceUrl) return null
  if (isThumbPermanente(sourceUrl)) return sourceUrl

  const path = thumbPath(adId)
  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) {
      // 403 aqui = a URL já venceu antes de a gente conseguir copiar. Só o
      // re-resolve no Meta (backfill-thumbs) recupera.
      log.warn('persistThumbnail: download falhou', { adId, status: res.status })
      return null
    }
    const buf = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') ?? 'image/jpeg'

    const { error } = await supa.storage.from(THUMB_BUCKET).upload(path, buf, {
      contentType,
      upsert: true,
      cacheControl: '31536000',
    })
    if (error) {
      log.warn('persistThumbnail: upload falhou', { adId, msg: error.message })
      return null
    }

    const { data } = supa.storage.from(THUMB_BUCKET).getPublicUrl(path)
    return data?.publicUrl ?? null
  } catch (err) {
    log.warn('persistThumbnail: erro', { adId, msg: err instanceof Error ? err.message : String(err) })
    return null
  }
}
