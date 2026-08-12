/**
 * GET   /api/criativos/sugestoes?status=pending&limit=50  — lista
 * POST  /api/criativos/sugestoes/generate                  — separado em /generate
 *
 * Status: pending → approved/rejected/edited → executed (PR 8 conecta execute).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceFromRequest } from '@/lib/criativo-pipeline'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

const VALID_STATUS = new Set(['pending', 'approved', 'rejected', 'edited', 'executed'])

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'pending'
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 500)

  if (!VALID_STATUS.has(status)) {
    return NextResponse.json({ error: `status inválido: ${status}` }, { status: 400 })
  }

  try {
    const client = supa()
    const { id: workspaceId } = await resolveWorkspaceFromRequest(client, req)
    const { data, error } = await client
      .from('criativo_sugestoes')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ workspaceId, status, total: data?.length ?? 0, sugestoes: data ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('sugestoes GET failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
