/**
 * POST /api/criativos/analise/batch?max=4&account_id=
 *   → processa até `max` (default 4, hard cap 8) ads PENDENTES (sem analise OK)
 *     do workspace, ordenados por views_3seg desc nos últimos 7 dias.
 *
 * Admin-only. Existe pra acelerar catchup quando o cron diário (MAX_NEW=4)
 * não dá conta — admin clica várias vezes até esvaziar a fila.
 *
 * Auth: cookie de sessão com role='admin'. Sem fallback Bearer (use o cron
 * pra automação).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import {
  resolveWorkspaceBySlug,
  resolveWorkspaceByAccountId,
  runAnalysisForAd,
} from '@/lib/criativo-pipeline'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ACTIVE_WINDOW_DAYS = 7
const MIN_VIEWS_3SEG = 100
const HARD_MAX = 8
const PER_AD_TIMEOUT_MS = 120_000

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function getPendingAdIds(workspaceId: string, limit: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const { data, error } = await supa()
    .from('meta_ads')
    .select('ad_id, views_3seg')
    .eq('workspace_id', workspaceId)
    .gte('data', cutoff)
    .gte('views_3seg', MIN_VIEWS_3SEG)
    .not('ad_id', 'is', null)
  if (error) throw new Error(`fetch candidates: ${error.message}`)

  const totals = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ ad_id: string; views_3seg: number }>) {
    if (!r.ad_id) continue
    totals.set(r.ad_id, (totals.get(r.ad_id) ?? 0) + (r.views_3seg || 0))
  }
  if (totals.size === 0) return []

  const allIds = [...totals.keys()]
  const { data: existing, error: exErr } = await supa()
    .from('criativo_analise')
    .select('ad_id, status')
    .eq('workspace_id', workspaceId)
    .in('ad_id', allIds)
  if (exErr) throw new Error(`fetch existing: ${exErr.message}`)

  const ok = new Set<string>(
    (existing ?? [])
      .filter((r: { status: string }) => r.status === 'ok')
      .map((r: { ad_id: string }) => r.ad_id)
  )

  return allIds
    .filter((id) => !ok.has(id))
    .sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
    .slice(0, limit)
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

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 })
  }

  if (!process.env.META_ACCESS_TOKEN || !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'META_ACCESS_TOKEN ou GEMINI_API_KEY ausente' }, { status: 500 })
  }

  const rawMax = parseInt(req.nextUrl.searchParams.get('max') ?? '4', 10)
  const max = Math.min(Math.max(Number.isFinite(rawMax) ? rawMax : 4, 1), HARD_MAX)
  const accountId = req.nextUrl.searchParams.get('account_id')

  const startedAt = Date.now()
  const client = supa()
  let ws: Awaited<ReturnType<typeof resolveWorkspaceBySlug>>
  try {
    ws = accountId
      ? await resolveWorkspaceByAccountId(client, accountId)
      : await resolveWorkspaceBySlug(client)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  let pending: string[]
  try {
    pending = await getPendingAdIds(ws.id, max)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  if (pending.length === 0) {
    return NextResponse.json({
      workspaceId: ws.id,
      requested: max,
      processed: 0,
      results: [],
      elapsedMs: Date.now() - startedAt,
      message: 'Nenhum ad pendente.',
    })
  }

  const results: Array<{ adId: string; status: string; durationMs: number; error?: string }> = []

  for (const adId of pending) {
    const t0 = Date.now()
    try {
      const r = await runWithTimeout(
        runAnalysisForAd({ supa: client, workspaceId: ws.id, workspaceCtx: ws.ctx, adId, force: false }),
        PER_AD_TIMEOUT_MS,
        `ad ${adId}`,
      )
      results.push({ adId, status: r.status ?? 'ok', durationMs: Date.now() - t0 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('analise batch per-ad error', { adId, msg })
      results.push({ adId, status: 'failed', durationMs: Date.now() - t0, error: msg })
    }
  }

  return NextResponse.json({
    workspaceId: ws.id,
    requested: max,
    processed: results.length,
    results,
    elapsedMs: Date.now() - startedAt,
  })
}
