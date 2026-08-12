/**
 * GET /api/cron/classificar-criativos?max=4&account_id=
 *
 * F1c — classifica (Gemini sobre TEXTO+frames) os criativos cuja MÍDIA já foi
 * processada pela VPS (transcricao Whisper + frames presentes) mas que ainda
 * NÃO têm `resumo` (classificação pendente). Complementa o batch noturno da
 * VPS, que só extrai mídia.
 *
 * Por que rota separada do cron analyze-criativos: aquele pula status='ok', e
 * os media-prontos da VPS já vêm com status='ok'. Aqui o critério é
 * transcricao presente + resumo NULL, e roda com force=true.
 *
 * Sob /api/cron/ (liberado pelo proxy). Auth: x-vercel-cron OU Bearer/k=CRON_SECRET.
 * Em plano Hobby a função corta ~60s — use max baixo (4) e chame em loop até zerar.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceBySlug, resolveWorkspaceByAccountId, runAnalysisForAd } from '@/lib/criativo-pipeline'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HARD_MAX = 8
const PER_AD_TIMEOUT_MS = 120_000

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function runWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let to: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    to = setTimeout(() => reject(new Error(`timeout ${label} (${ms}ms)`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (to) clearTimeout(to)
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  // Só Bearer: o ramo ?k= vazava o segredo em access logs. A VPS já migrou.
  const k = (req.headers.get('authorization') || '').replace('Bearer ', '')
  if (!isVercelCron) {
    if (!process.env.CRON_SECRET || k !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
  if (!process.env.GEMINI_API_KEY || !process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'GEMINI_API_KEY ou META_ACCESS_TOKEN ausente' }, { status: 500 })
  }

  const rawMax = parseInt(url.searchParams.get('max') ?? '4', 10)
  const max = Math.min(Math.max(Number.isFinite(rawMax) ? rawMax : 4, 1), HARD_MAX)
  const accountId = url.searchParams.get('account_id')

  const startedAt = Date.now()
  const client = supa()
  let ws: Awaited<ReturnType<typeof resolveWorkspaceBySlug>>
  try {
    ws = accountId ? await resolveWorkspaceByAccountId(client, accountId) : await resolveWorkspaceBySlug(client)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  // Pendentes de classificação (resumo NULL). Inclui vídeos com transcrição
  // (modo texto+frames) E anúncios de IMAGEM / vídeos sem transcrição
  // (modo imageOnly = classifica pela imagem do criativo + copy).
  const { data: rows, error } = await client
    .from('criativo_analise')
    .select('ad_id, transcricao')
    .eq('workspace_id', ws.id)
    .is('resumo', null)
    .not('ad_id', 'is', null)
    .limit(max)
  if (error) {
    return NextResponse.json({ error: `fetch pendentes: ${error.message}` }, { status: 500 })
  }

  const pendentes = (rows ?? []) as Array<{ ad_id: string; transcricao: string | null }>
  if (pendentes.length === 0) {
    return NextResponse.json({ workspaceId: ws.id, processed: 0, restantes: 0, message: 'sem pendentes', elapsedMs: Date.now() - startedAt })
  }

  // Quantos ainda faltam no total (pra o loop saber quando parar).
  const { count: restantesTotal } = await client
    .from('criativo_analise')
    .select('ad_id', { count: 'exact', head: true })
    .eq('workspace_id', ws.id)
    .is('resumo', null)

  const results: Array<{ adId: string; status: string; durationMs: number; error?: string }> = []
  for (const { ad_id: adId, transcricao } of pendentes) {
    const t0 = Date.now()
    // Sem transcrição (anúncio de imagem ou vídeo que falhou na mídia) → modo imagem.
    const imageOnly = !(transcricao && transcricao.trim())
    try {
      const r = await runWithTimeout(
        runAnalysisForAd({ supa: client, workspaceId: ws.id, workspaceCtx: ws.ctx, adId, force: true, imageOnly }),
        PER_AD_TIMEOUT_MS,
        `ad ${adId}`,
      )
      results.push({ adId, status: r.status ?? 'ok', durationMs: Date.now() - t0, ...(r.error ? { error: r.error } : {}) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('classificar-criativos per-ad error', { adId, msg })
      results.push({ adId, status: 'failed', durationMs: Date.now() - t0, error: msg })
    }
  }

  return NextResponse.json({
    workspaceId: ws.id,
    processed: results.length,
    restantes: Math.max(0, (restantesTotal ?? results.length) - results.filter((r) => r.status === 'ok').length),
    results,
    elapsedMs: Date.now() - startedAt,
  })
}
