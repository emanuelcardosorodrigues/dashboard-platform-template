/**
 * Ingestão do inventário de criativos que NÃO RODARAM (anúncios 0-entrega + assets
 * soltos da biblioteca). SÓ leitura do Meta + upsert no inventário criativo_biblioteca
 * — CUSTO ZERO (sem Gemini). Pode rodar como cron diário OU trigger manual.
 *
 * Auth: x-vercel-cron OU Bearer CRON_SECRET.
 * Valida: GET /api/criativos/biblioteca/sync  (Authorization: Bearer $CRON_SECRET)
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceBySlug } from '@/lib/criativo-pipeline'
import { ingestNaoRodaram } from '@/lib/criativosBiblioteca'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'META_ACCESS_TOKEN ausente' }, { status: 500 })
  }
  const accountIds = (process.env.META_ACCOUNT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (accountIds.length === 0) {
    return NextResponse.json({ error: 'META_ACCOUNT_IDS ausente' }, { status: 500 })
  }

  const client = supa()
  try {
    const ws = await resolveWorkspaceBySlug(client)
    const res = await ingestNaoRodaram({
      supa: client, workspaceId: ws.id, accountIds, now: new Date().toISOString(),
    })
    log.info('[biblioteca/sync] ok', res)
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('[biblioteca/sync] erro', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
