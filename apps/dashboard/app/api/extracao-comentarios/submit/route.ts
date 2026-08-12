/**
 * POST /api/extracao-comentarios/submit — cria extrações de comentários YT.
 *
 * Fluxo: valida URLs (zod + extractYoutubeVideoId) → dedup interno por videoId
 * (cap 10/submit) → dedup contra extrações vivas do workspace → 1 chamada
 * videos.list batched (metadados + expected_comments) → insere status=pending.
 * Vídeo que a API não devolve (privado/apagado) entra como failed com erro claro.
 * O processamento em si é dirigido pelo client via /process (chunks retomáveis).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { log } from '@/lib/log'
import { parseBody, badRequest, extracaoSubmitSchema } from '@/lib/validation/schemas'
import { resolveExtracaoAuth } from '@/lib/organico/extracaoAuth'
import { extractYoutubeVideoId, fetchVideosLite } from '@/lib/organico/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_VIDEOS_POR_SUBMIT = 10

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function POST(req: NextRequest) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 401 })

    const parsed = await parseBody(req, extracaoSubmitSchema)
    if (!parsed.ok) {
      const { status, body } = badRequest(parsed)
      return NextResponse.json(body, { status })
    }

    // URL → videoId; dedup interno preservando a primeira URL colada de cada vídeo
    const byVideo = new Map<string, string>()
    let invalid = 0
    for (const url of parsed.data.urls) {
      if (!url) continue
      const vid = extractYoutubeVideoId(url)
      if (!vid) { invalid++; continue }
      if (!byVideo.has(vid)) byVideo.set(vid, url)
    }
    const uniqueVideoIds = [...byVideo.keys()]
    const videoIds = uniqueVideoIds.slice(0, MAX_VIDEOS_POR_SUBMIT)
    // URLs válidas descartadas por exceder o cap (não são "inválidas" nem "já extraídas")
    const dropped = uniqueVideoIds.length - videoIds.length

    if (videoIds.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma URL válida de vídeo do YouTube encontrada (watch, youtu.be, shorts ou live)' },
        { status: 400 },
      )
    }

    const db = supa()

    // Dedup contra o histórico. Extração viva do mesmo vídeo:
    //  - concluída (done/comments_disabled) → pula ("já extraído")
    //  - incompleta (pending/processing/quota) → RETOMA (devolve o id p/ o client dirigir)
    const { data: existing } = await db
      .from('yt_comment_extractions')
      .select('id,video_id,status')
      .eq('workspace_id', workspaceId)
      .in('video_id', videoIds)
      .neq('status', 'failed')
      .gt('expires_at', new Date().toISOString())

    const CONCLUIDAS = new Set(['done', 'comments_disabled'])
    const existingByVideo = new Map((existing ?? []).map((r: { id: string; video_id: string; status: string }) => [r.video_id, r]))
    const resumableIds: string[] = []
    let skipped = 0
    const toFetch: string[] = []
    for (const v of videoIds) {
      const ex = existingByVideo.get(v)
      if (!ex) { toFetch.push(v); continue }
      if (CONCLUIDAS.has(ex.status)) { skipped++; continue }
      resumableIds.push(ex.id) // incompleta → retomar
    }

    if (toFetch.length === 0) {
      return NextResponse.json({ inserted: 0, resumable: resumableIds.length, failed: 0, skipped, invalid, dropped, ids: resumableIds })
    }

    // API key (dados públicos, sem escopo) com fallback pro OAuth do workspace
    const auth = await resolveExtracaoAuth(workspaceId)
    if (!auth) {
      return NextResponse.json(
        { error: 'YouTube não configurado — defina YOUTUBE_API_KEY na Vercel ou conecte um canal em Administração → Projetos' },
        { status: 400 },
      )
    }

    // Metadados batched (1 unit). Vídeo ausente no retorno = privado/apagado.
    const metas = await fetchVideosLite(auth, toFetch)
    const metaById = new Map(metas.map((m) => [m.id, m]))

    const rows = toFetch.map((videoId) => {
      const meta = metaById.get(videoId)
      return {
        workspace_id: workspaceId,
        video_id: videoId,
        url: byVideo.get(videoId)!,
        video_title: meta?.title ?? null,
        channel_title: meta?.channelTitle ?? null,
        thumbnail_url: meta?.thumbnailUrl ?? null,
        video_published_at: meta?.publishedAt ?? null,
        expected_comments: meta?.commentCount ?? null,
        ...(meta
          ? {}
          : { status: 'failed', ultimo_erro: 'Vídeo não encontrado — privado, apagado ou URL errada' }),
      }
    })

    const { data: inserted, error } = await db
      .from('yt_comment_extractions')
      .insert(rows)
      .select('id,status')
    if (error) throw error

    // ids que o client vai dirigir: novos pendentes + incompletos retomáveis
    const novosPendentes = (inserted ?? []).filter((r) => r.status === 'pending').map((r: { id: string }) => r.id)
    const failed = toFetch.length - novosPendentes.length // privados/apagados
    const ids = [...novosPendentes, ...resumableIds]
    log.info('extracao-comentarios/submit', {
      pending: novosPendentes.length, resumable: resumableIds.length,
      failed, skipped, invalid, dropped, ws: workspaceId,
    })
    return NextResponse.json({ inserted: novosPendentes.length, resumable: resumableIds.length, failed, skipped, invalid, dropped, ids })
  } catch (err) {
    log.error('extracao-comentarios/submit', { err: String(err) })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
