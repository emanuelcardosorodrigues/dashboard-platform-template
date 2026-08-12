/**
 * PATCH  /api/criativos/grupos/[id]   — edita { nome?, filtro?, ordem? }
 * DELETE /api/criativos/grupos/[id]   — remove
 *
 * Preset/derivado podem ser editados (renomeados) mas não excluídos via API
 * (são gerados; pra remover, troca tipo→custom primeiro ou edita filtro=null).
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
  nome?: string
  filtro?: Record<string, unknown>
  ordem?: number
  tipo?: 'custom' | 'preset' | 'derivado'
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  try {
    const body = (await req.json()) as PatchBody
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.nome !== undefined) patch.nome = body.nome
    if (body.filtro !== undefined) patch.filtro = body.filtro
    if (body.ordem !== undefined) patch.ordem = body.ordem
    if (body.tipo !== undefined) patch.tipo = body.tipo

    const client = supa()
    const { id: workspaceId } = await resolveWorkspaceFromRequest(client, req)

    const { data, error } = await client
      .from('criativo_grupos')
      .update(patch)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'grupo não encontrado' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('grupos PATCH failed', { id, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  try {
    const client = supa()
    const { id: workspaceId } = await resolveWorkspaceFromRequest(client, req)

    const { error } = await client
      .from('criativo_grupos')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ id, deleted: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('grupos DELETE failed', { id, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
