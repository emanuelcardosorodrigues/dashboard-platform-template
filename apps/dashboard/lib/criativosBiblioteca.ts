/**
 * Inventário de criativos que NÃO RODARAM ("Cobertura TOTAL"):
 *   - Anúncios criados com 0 entrega: anúncio da conta cujo ad_id NÃO está em
 *     meta_ads (meta_ads só tem quem entregou). fonte='anuncio', ad_id real.
 *   - Assets soltos: vídeo/imagem da biblioteca de mídia cujo video_id/image_hash
 *     NÃO é usado por NENHUM anúncio. fonte='biblioteca', asset_key sintético.
 *
 * Só LISTA (Meta reads) e faz upsert no inventário criativo_biblioteca — CUSTO ZERO
 * (sem Gemini, sem transcrição). A análise é etapa separada (cron cost-capped).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { listAccountAds, listAdVideos, listAdImages } from './meta-graph'

export interface IngestResult {
  contas: number
  adsZerados: number
  assetsSoltos: number
  upserts: number
  erros: string[]
}

interface Placeholder {
  workspace_id: string
  asset_key: string
  fonte: 'anuncio' | 'biblioteca'
  account_id: string
  nome: string | null
  video_id: string | null
  image_hash: string | null
  video_url: string | null
  thumbnail_url: string | null
  effective_status: string | null
  atualizado_em: string
}

export async function ingestNaoRodaram(opts: {
  supa: SupabaseClient
  workspaceId: string
  accountIds: string[]
  accessToken?: string
  now: string // ISO — passado de fora (server action / route)
}): Promise<IngestResult> {
  const { supa, workspaceId, accountIds, accessToken, now } = opts
  const res: IngestResult = { contas: accountIds.length, adsZerados: 0, assetsSoltos: 0, upserts: 0, erros: [] }

  // ad_ids que JÁ entregaram (estão em meta_ads) — esses NÃO são "não rodaram".
  const entregaram = new Set<string>()
  {
    const { data } = await supa.from('meta_ads').select('ad_id').eq('workspace_id', workspaceId)
    for (const r of (data ?? []) as Array<{ ad_id: string | null }>) if (r.ad_id) entregaram.add(r.ad_id)
  }

  const placeholders: Placeholder[] = []
  const usados = new Set<string>() // video_id/image_hash usados em QUALQUER anúncio

  // 1) Anúncios da conta (independente de entrega) — coleta os com 0 entrega + marca assets usados.
  for (const acc of accountIds) {
    let ads
    try { ads = await listAccountAds(acc, { accessToken }) }
    catch (e) { res.erros.push(`listAccountAds(${acc}): ${e instanceof Error ? e.message : String(e)}`); continue }
    for (const a of ads) {
      if (a.videoId) usados.add(`v:${a.videoId}`)
      if (a.imageHash) usados.add(`i:${a.imageHash}`)
      if (!entregaram.has(a.adId)) {
        res.adsZerados++
        placeholders.push({
          workspace_id: workspaceId, asset_key: a.adId, fonte: 'anuncio', account_id: acc,
          nome: a.name, video_id: a.videoId, image_hash: a.imageHash,
          video_url: null, thumbnail_url: null, effective_status: a.effectiveStatus, atualizado_em: now,
        })
      }
    }
  }

  // 2) Biblioteca de mídia − assets usados em algum anúncio = "soltos".
  for (const acc of accountIds) {
    let vids: Awaited<ReturnType<typeof listAdVideos>> = []
    let imgs: Awaited<ReturnType<typeof listAdImages>> = []
    try { vids = await listAdVideos(acc, { accessToken }) }
    catch (e) { res.erros.push(`listAdVideos(${acc}): ${e instanceof Error ? e.message : String(e)}`) }
    try { imgs = await listAdImages(acc, { accessToken }) }
    catch (e) { res.erros.push(`listAdImages(${acc}): ${e instanceof Error ? e.message : String(e)}`) }
    for (const v of vids) {
      if (usados.has(`v:${v.videoId}`)) continue
      res.assetsSoltos++
      placeholders.push({
        workspace_id: workspaceId, asset_key: `lib_vid_${v.videoId}`, fonte: 'biblioteca', account_id: acc,
        nome: v.title, video_id: v.videoId, image_hash: null,
        video_url: v.source, thumbnail_url: v.picture, effective_status: null, atualizado_em: now,
      })
    }
    for (const im of imgs) {
      if (usados.has(`i:${im.hash}`)) continue
      res.assetsSoltos++
      placeholders.push({
        workspace_id: workspaceId, asset_key: `lib_img_${im.hash}`, fonte: 'biblioteca', account_id: acc,
        nome: im.name, video_id: null, image_hash: im.hash,
        video_url: null, thumbnail_url: im.url, effective_status: null, atualizado_em: now,
      })
    }
  }

  // 3) Upsert no inventário em lotes. onConflict não toca `analisado` (preserva o que já foi analisado).
  for (let i = 0; i < placeholders.length; i += 500) {
    const lote = placeholders.slice(i, i + 500)
    const { error } = await supa.from('criativo_biblioteca').upsert(lote, { onConflict: 'workspace_id,asset_key' })
    if (error) res.erros.push(`upsert lote ${i}: ${error.message}`)
    else res.upserts += lote.length
  }
  return res
}
