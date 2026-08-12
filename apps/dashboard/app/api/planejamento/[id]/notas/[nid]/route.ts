/**
 * PATCH  /api/planejamento/[id]/notas/[nid] — edita o corpo da nota (alvo do auto-save)
 * DELETE /api/planejamento/[id]/notas/[nid] — remove a nota
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; nid: string }> }) {
  try {
    const { id, nid } = await params
    const ws = await getActiveWorkspaceId()
    const b = (await req.json()) as Record<string, unknown>
    if (typeof b.corpo !== 'string') return NextResponse.json({ error: 'corpo requerido' }, { status: 400 })
    const { error } = await supa().from('acao_notas').update({ corpo: b.corpo, updated_at: new Date().toISOString() }).eq('id', nid).eq('acao_id', id).eq('workspace_id', ws)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; nid: string }> }) {
  try {
    const { id, nid } = await params
    const ws = await getActiveWorkspaceId()
    const { error } = await supa().from('acao_notas').delete().eq('id', nid).eq('acao_id', id).eq('workspace_id', ws)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
