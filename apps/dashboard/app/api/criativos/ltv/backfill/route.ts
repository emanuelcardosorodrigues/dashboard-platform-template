/**
 * POST /api/criativos/ltv/backfill
 *   body opcional: { since?: 'YYYY-MM-DD' }
 *
 * Reconstrói criativo_ltv a partir de `transacoes`. Idempotente
 * (upsert por PK composta). Roda em cold start; ver PR 12 pro cron diário.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceFromRequest } from '@/lib/criativo-pipeline'
import { backfillLtv } from '@/lib/ltv'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  let since: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.since)) {
      since = body.since
    }
  } catch {
    // body opcional
  }

  try {
    const client = supa()
    const ws = await resolveWorkspaceFromRequest(client, req)
    const stats = await backfillLtv(client, ws.id, { sinceDate: since })
    return NextResponse.json({
      workspaceId: ws.id,
      since: since ?? null,
      ...stats,
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('ltv backfill failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
