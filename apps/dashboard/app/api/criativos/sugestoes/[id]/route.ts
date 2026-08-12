/**
 * PATCH  /api/criativos/sugestoes/[id]  — decisão humana
 *   body: { status: 'approved'|'rejected'|'edited', decisao_por, decisao_diff? }
 *
 * Execute (status='executed') é feito pelo PR 8 (ads_management actions) que
 * chama Meta Graph e atualiza status pra 'executed'.
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

interface PatchBody {
  status: 'approved' | 'rejected' | 'edited'
  decisao_por?: string
  decisao_diff?: Record<string, unknown>
  payload?: Record<string, unknown> // se status=edited, payload pode ser sobrescrito
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  try {
    const body = (await req.json()) as PatchBody
    if (!['approved', 'rejected', 'edited'].includes(body.status)) {
      return NextResponse.json({ error: 'status inválido' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {
      status: body.status,
      decisao_por: body.decisao_por ?? null,
      decisao_em: new Date().toISOString(),
    }
    if (body.decisao_diff) patch.decisao_diff = body.decisao_diff
    if (body.payload && body.status === 'edited') patch.payload = body.payload

    const client = supa()
    const { id: workspaceId } = await resolveWorkspaceFromRequest(client, req)

    const { data, error } = await client
      .from('criativo_sugestoes')
      .update(patch)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'sugestão não encontrada' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('sugestoes PATCH failed', { id, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
