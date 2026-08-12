/**
 * GET  /api/criativos/analise/[adId] — análise cacheada em `criativo_analise`.
 * POST /api/criativos/analise/[adId]?force=1 — força nova análise Gemini.
 *
 * Cache eterno por video_hash (sha256 do binário). Se o hash bate e
 * status='ok', skip Gemini (lógica em lib/criativo-pipeline.ts).
 *
 * Workspace: resolve por DEFAULT_WORKSPACE_SLUG (multi-tenant verdadeiro → PR 16).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runAnalysisForAd, resolveWorkspaceFromRequest } from '@/lib/criativo-pipeline'
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

export async function GET(req: NextRequest, ctx: { params: Promise<{ adId: string }> }) {
  const { adId } = await ctx.params
  if (!adId) return NextResponse.json({ error: 'adId requerido' }, { status: 400 })

  try {
    const { id: workspaceId } = await resolveWorkspaceFromRequest(supa(), req)
    const { data, error } = await supa()
      .from('criativo_analise')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('ad_id', adId)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ adId, workspaceId, status: 'not_found' }, { status: 404 })

    return NextResponse.json({ adId, workspaceId, ...data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('analise GET failed', { adId, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ adId: string }> }) {
  const { adId } = await ctx.params
  if (!adId) return NextResponse.json({ error: 'adId requerido' }, { status: 400 })

  const force = req.nextUrl.searchParams.get('force') === '1'

  try {
    const client = supa()
    const ws = await resolveWorkspaceFromRequest(client, req)
    const result = await runAnalysisForAd({
      supa: client,
      workspaceId: ws.id,
      workspaceCtx: ws.ctx,
      adId,
      force,
    })

    const status = result.status === 'failed' ? 502 : result.status === 'no-asset' ? 422 : 200
    return NextResponse.json(result, { status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('analise POST failed', { adId, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
