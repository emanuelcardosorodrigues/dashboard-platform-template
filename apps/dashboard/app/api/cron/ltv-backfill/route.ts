/**
 * Cron diário: backfill incremental do criativo_ltv.
 * Roda 10:40 (depois de analyze-criativos 10:20).
 *
 * Estratégia: usa janela `since` = primeira compra dos últimos 365d, pra
 * cobrir recompras recentes sem recomputar histórico inteiro toda noite.
 * Upsert por PK (workspace_id, ad_id, email) é idempotente.
 *
 * Auth: x-vercel-cron OU Bearer CRON_SECRET.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceBySlug } from '@/lib/criativo-pipeline'
import { backfillLtv } from '@/lib/ltv'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const LOOKBACK_DAYS = 365

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const startedAt = Date.now()
  try {
    const client = supa()
    const ws = await resolveWorkspaceBySlug(client)
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const stats = await backfillLtv(client, ws.id, { sinceDate: since })
    return NextResponse.json({
      workspaceId: ws.id,
      since,
      ...stats,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('ltv-backfill cron failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
