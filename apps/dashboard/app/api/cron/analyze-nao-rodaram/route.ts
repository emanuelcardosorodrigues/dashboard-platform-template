/**
 * Cron: análise dos criativos que NÃO rodaram (fila criativo_biblioteca).
 * CUSTO ZERO por construção: Whisper (VPS, ads) + Gemini FREE TIER. Cap baixo por
 * run (MAX_POR_RUN) — se a cota grátis do Gemini estourar, falha gracioso (sem cobrança;
 * a chave é free-tier, billing não habilitado). Roda separado do analyze-criativos.
 *
 *  - fonte='anuncio'  → ad_id real → runAnalysisForAd (reusa pipeline+VPS) + marca rodou=false.
 *  - fonte='biblioteca' → asset solto → re-resolve URL do vídeo + runAnalysisForLibraryAsset.
 *
 * Auth: x-vercel-cron OU Bearer CRON_SECRET.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runAnalysisForAd, runAnalysisForLibraryAsset, resolveWorkspaceBySlug } from '@/lib/criativo-pipeline'
import { getVideoSource } from '@/lib/meta-graph'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_POR_RUN = 4 // conservador: protege a cota grátis do Gemini (compartilhada com analyze-criativos)
const PER_ITEM_TIMEOUT_MS = 120_000

interface FilaRow {
  asset_key: string
  fonte: 'anuncio' | 'biblioteca'
  nome: string | null
  video_id: string | null
  video_url: string | null
  thumbnail_url: string | null
}

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${label}`)), ms))])
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!process.env.META_ACCESS_TOKEN || !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'META_ACCESS_TOKEN ou GEMINI_API_KEY ausente' }, { status: 500 })
  }
  const maxParam = Number(req.nextUrl.searchParams.get('max'))
  const max = Number.isFinite(maxParam) && maxParam > 0 ? Math.min(maxParam, 12) : MAX_POR_RUN

  const client = supa()
  let ws: Awaited<ReturnType<typeof resolveWorkspaceBySlug>>
  try {
    ws = await resolveWorkspaceBySlug(client)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const { data: fila, error: filaErr } = await client
    .from('criativo_biblioteca')
    .select('asset_key, fonte, nome, video_id, video_url, thumbnail_url')
    .eq('workspace_id', ws.id)
    .eq('analisado', false)
    .order('descoberto_em', { ascending: true })
    .limit(max)
  if (filaErr) return NextResponse.json({ error: filaErr.message }, { status: 500 })

  const results: Record<string, unknown> = {}
  for (const item of (fila ?? []) as FilaRow[]) {
    let r: { status: string } = { status: 'failed' }
    try {
      if (item.fonte === 'anuncio') {
        r = await withTimeout(
          runAnalysisForAd({ supa: client, workspaceId: ws.id, workspaceCtx: ws.ctx, adId: item.asset_key }),
          PER_ITEM_TIMEOUT_MS, item.asset_key,
        )
        // marca como "não rodou" (runAnalysisForAd usa default rodou=true).
        if (r.status === 'ok' || r.status === 'cached') {
          await client.from('criativo_analise').update({ rodou: false, fonte: 'anuncio' })
            .eq('workspace_id', ws.id).eq('ad_id', item.asset_key)
        }
      } else {
        // asset solto: re-resolve a URL do vídeo (source expira) pelo video_id.
        let videoUrl = item.video_url
        let thumb = item.thumbnail_url
        if (item.video_id) {
          const v = await getVideoSource(item.video_id)
          videoUrl = v.source ?? videoUrl
          thumb = thumb ?? v.picture
        }
        r = await withTimeout(
          runAnalysisForLibraryAsset({ supa: client, workspaceId: ws.id, workspaceCtx: ws.ctx, assetKey: item.asset_key, nome: item.nome, videoUrl, thumbnailUrl: thumb }),
          PER_ITEM_TIMEOUT_MS, item.asset_key,
        )
      }
      results[item.asset_key] = { status: r.status, fonte: item.fonte }
    } catch (err) {
      r = { status: 'failed' }
      results[item.asset_key] = { status: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
    // Só marca analisado quando a análise DEU CERTO. Falha transitória (Gemini/VPS)
    // deve poder ser re-tentada no próximo run — antes marcava em qualquer desfecho
    // e o item sumia da fila pra sempre (.eq('analisado', false)).
    if (r.status === 'ok' || r.status === 'cached') {
      await client.from('criativo_biblioteca').update({ analisado: true, atualizado_em: new Date().toISOString() })
        .eq('workspace_id', ws.id).eq('asset_key', item.asset_key)
    }
  }

  log.info('[analyze-nao-rodaram] ok', { processados: Object.keys(results).length })
  return NextResponse.json({ ok: true, processados: Object.keys(results).length, results })
}
