/**
 * POST /api/extracao-comentarios/process — avança UMA extração em um chunk.
 *
 * O client chama em loop até done. Cada chamada:
 *   lease atômico (contra 2ª aba) → token → chunk da fase atual → upsert
 *   idempotente → persiste cursor/contadores → libera lease.
 *
 * Fases: 'threads' (commentThreads.list paginado, order=time, replies inline
 * embutidas) → 'replies' (comments.list?parentId= pras raízes marcadas
 * replies_fetched=false — fila derivada da própria tabela, índice parcial).
 *
 * Interrupção NUNCA perde progresso: quota → status='quota' com cursor salvo;
 * erro → status='failed' com cursor salvo; aba fechada → lease expira em 90s.
 * "Continuar" na UI chama este endpoint de novo e retoma do cursor.
 * Orçamento por chunk bem abaixo do maxDuration (Vercel Hobby).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { log } from '@/lib/log'
import { parseBody, badRequest, extracaoProcessSchema } from '@/lib/validation/schemas'
import { resolveExtracaoAuth } from '@/lib/organico/extracaoAuth'
import {
  fetchCommentThreadsChunk,
  fetchAllReplies,
  type YtCommentRow,
} from '@/lib/organico/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LEASE_MS = 90_000
const WALL_CLOCK_MS = 25_000       // orçamento do chunk, folga vs maxDuration
const THREADS_PAGES_POR_CHUNK = 15 // ~1500 comentários raiz por chamada
const REPLIES_THREADS_POR_CHUNK = 30

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

interface ExtractionRow {
  id: string
  video_id: string
  status: string
  phase: 'threads' | 'replies'
  page_cursor: string | null
  pages_fetched: number
  comments_count: number
  quota_units: number
  expected_comments: number | null
}

function commentToRow(c: YtCommentRow, extractionId: string, workspaceId: string, repliesFetched: boolean) {
  return {
    extraction_id: extractionId,
    workspace_id: workspaceId,
    external_id: c.externalId,
    parent_external_id: c.parentExternalId,
    author: c.author,
    author_channel_url: c.authorChannelUrl,
    text: c.text,
    like_count: c.likeCount,
    reply_count: c.replyCount,
    published_at: c.publishedAt,
    replies_fetched: repliesFetched,
  }
}

async function upsertComments(db: SupabaseClient, rows: ReturnType<typeof commentToRow>[]) {
  if (rows.length === 0) return
  // Idempotente: retomada re-processa a página que falhou sem duplicar
  const { error } = await db
    .from('yt_extracted_comments')
    .upsert(rows, { onConflict: 'extraction_id,external_id', ignoreDuplicates: true })
  if (error) throw error
}

async function countComments(db: SupabaseClient, extractionId: string): Promise<number> {
  const { count, error } = await db
    .from('yt_extracted_comments')
    .select('id', { count: 'exact', head: true })
    .eq('extraction_id', extractionId)
  if (error) throw error
  return count ?? 0
}

export async function POST(req: NextRequest) {
  const db = supa()
  let leasedId: string | null = null
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 401 })

    const parsed = await parseBody(req, extracaoProcessSchema)
    if (!parsed.ok) {
      const { status, body } = badRequest(parsed)
      return NextResponse.json(body, { status })
    }
    const { id } = parsed.data

    const { data: row, error: rowErr } = await db
      .from('yt_comment_extractions')
      .select('id,video_id,status,phase,page_cursor,pages_fetched,comments_count,quota_units,expected_comments')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle<ExtractionRow>()
    if (rowErr) throw rowErr
    if (!row) return NextResponse.json({ error: 'Extração não encontrada' }, { status: 404 })

    // Terminais: nada a processar
    if (row.status === 'done' || row.status === 'comments_disabled') {
      return NextResponse.json({ done: true, status: row.status, commentsCount: row.comments_count })
    }

    // Auth ANTES do lease (falha aqui não deixa a extração travada em processing).
    // API key preferida (sem escopo OAuth); fallback OAuth do workspace.
    const auth = await resolveExtracaoAuth(workspaceId)
    if (!auth) {
      return NextResponse.json(
        { error: 'YouTube não configurado — defina YOUTUBE_API_KEY na Vercel ou conecte um canal em Administração → Projetos' },
        { status: 400 },
      )
    }

    // Lease atômico: só passa quem pegar a linha sem lease vigente
    // O filtro .or() com timestamp foi verificado contra o Postgres real:
    // adquire quando expirado, bloqueia a 2ª aba com lease vigente. nowIso é
    // server-side (sem vírgula, parseia certo no PostgREST).
    const nowIso = new Date().toISOString()
    const { data: leased, error: leaseErr } = await db
      .from('yt_comment_extractions')
      .update({ status: 'processing', lease_until: new Date(Date.now() + LEASE_MS).toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
      .select('id')
    if (leaseErr) throw leaseErr
    if (!leased || leased.length === 0) {
      return NextResponse.json({ error: 'Extração já está sendo processada (outra aba?)' }, { status: 409 })
    }
    leasedId = id

    const t0 = Date.now()
    let phase = row.phase
    let pagesFetched = row.pages_fetched
    let quotaUnits = row.quota_units

    if (phase === 'threads') {
      const chunk = await fetchCommentThreadsChunk(auth, row.video_id, {
        pageToken: row.page_cursor ?? undefined,
        maxPages: THREADS_PAGES_POR_CHUNK,
      })
      pagesFetched += chunk.pagesFetched
      quotaUnits += chunk.pagesFetched

      const incomplete = new Set(chunk.incompleteThreadIds)
      await upsertComments(db, chunk.comments.map((c) =>
        commentToRow(c, id, workspaceId, c.parentExternalId === null ? !incomplete.has(c.externalId) : true),
      ))
      const commentsCount = await countComments(db, id)

      if (chunk.commentsDisabled) {
        await db.from('yt_comment_extractions').update({
          status: 'comments_disabled', concluida_em: new Date().toISOString(),
          pages_fetched: pagesFetched, quota_units: quotaUnits, comments_count: commentsCount,
          lease_until: null,
        }).eq('id', id)
        return NextResponse.json({ done: true, status: 'comments_disabled', commentsCount })
      }

      if (chunk.quotaExceeded) {
        await db.from('yt_comment_extractions').update({
          status: 'quota', page_cursor: chunk.nextPageToken,
          pages_fetched: pagesFetched, quota_units: quotaUnits, comments_count: commentsCount,
          ultimo_erro: 'Quota diária da API do YouTube esgotada — clique em Continuar amanhã',
          lease_until: null,
        }).eq('id', id)
        return NextResponse.json({ done: false, status: 'quota', commentsCount })
      }

      const threadsAcabaram = chunk.nextPageToken === null
      await db.from('yt_comment_extractions').update({
        status: 'processing',
        phase: threadsAcabaram ? 'replies' : 'threads',
        page_cursor: chunk.nextPageToken,
        pages_fetched: pagesFetched, quota_units: quotaUnits, comments_count: commentsCount,
        lease_until: null, ultimo_erro: null,
      }).eq('id', id)
      return NextResponse.json({
        done: false, status: 'processing', phase: threadsAcabaram ? 'replies' : 'threads',
        commentsCount, expectedComments: row.expected_comments,
      })
    }

    // phase === 'replies': fila = raízes com replies_fetched=false (índice parcial).
    // reply_cursor retoma a raiz de onde parou (thread grande / quota / deadline).
    const { data: fila, error: filaErr } = await db
      .from('yt_extracted_comments')
      .select('external_id,reply_cursor')
      .eq('extraction_id', id)
      .is('parent_external_id', null)
      .eq('replies_fetched', false)
      .limit(REPLIES_THREADS_POR_CHUNK)
    if (filaErr) throw filaErr

    if (!fila || fila.length === 0) {
      const commentsCount = await countComments(db, id)
      await db.from('yt_comment_extractions').update({
        status: 'done', concluida_em: new Date().toISOString(),
        comments_count: commentsCount, lease_until: null, ultimo_erro: null,
      }).eq('id', id)
      return NextResponse.json({ done: true, status: 'done', commentsCount })
    }

    const deadlineMs = t0 + WALL_CLOCK_MS
    let quotaEstourou = false
    for (const { external_id: parentId, reply_cursor } of fila) {
      if (Date.now() > deadlineMs) break
      const r = await fetchAllReplies(auth, parentId, {
        pageToken: reply_cursor ?? undefined,
        deadlineMs,
      })
      quotaUnits += r.pagesFetched
      await upsertComments(db, r.replies.map((c) => commentToRow(c, id, workspaceId, true)))

      if (r.quotaExceeded) {
        // salva cursor da raiz p/ retomar sem re-baixar; raiz continua replies_fetched=false
        await db.from('yt_extracted_comments')
          .update({ reply_cursor: r.nextPageToken })
          .eq('extraction_id', id).eq('external_id', parentId)
        quotaEstourou = true
        break
      }
      if (r.nextPageToken) {
        // parou por deadline/teto NO MEIO da raiz — salva cursor, raiz continua na fila
        await db.from('yt_extracted_comments')
          .update({ reply_cursor: r.nextPageToken })
          .eq('extraction_id', id).eq('external_id', parentId)
        break // chunk acabou; próximo /process retoma esta raiz do cursor
      }
      // raiz 100% coletada
      await db.from('yt_extracted_comments')
        .update({ replies_fetched: true, reply_cursor: null })
        .eq('extraction_id', id).eq('external_id', parentId)
    }

    const commentsCount = await countComments(db, id)
    await db.from('yt_comment_extractions').update({
      status: quotaEstourou ? 'quota' : 'processing',
      quota_units: quotaUnits, comments_count: commentsCount,
      ...(quotaEstourou
        ? { ultimo_erro: 'Quota diária da API do YouTube esgotada — clique em Continuar amanhã' }
        : { ultimo_erro: null }),
      lease_until: null,
    }).eq('id', id)
    return NextResponse.json({
      done: false, status: quotaEstourou ? 'quota' : 'processing', phase: 'replies',
      commentsCount, expectedComments: row.expected_comments,
    })
  } catch (err) {
    log.error('extracao-comentarios/process', { err: String(err) })
    // Falha honesta com progresso preservado (cursor fica onde estava)
    if (leasedId) {
      await db.from('yt_comment_extractions').update({
        status: 'failed',
        ultimo_erro: String(err).slice(0, 500),
        lease_until: null,
      }).eq('id', leasedId)
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
