/**
 * PATCH  /api/acoes-vendas/[id]  — edita campos de uma ação
 * DELETE /api/acoes-vendas/[id]  — remove a ação
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { log } from '@/lib/log'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

const TIPOS = ['low_ticket', 'lancamento_gratis', 'lancamento_pago', 'perpetuo_vsl']
const STATUS = ['rascunho', 'ativo', 'encerrado']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const b = (await req.json()) as Record<string, unknown>
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof b.nome === 'string') patch.nome = b.nome.trim()
    if (typeof b.tipo === 'string' && TIPOS.includes(b.tipo)) patch.tipo = b.tipo
    if (typeof b.status === 'string' && STATUS.includes(b.status)) patch.status = b.status
    if ('data_inicio' in b) patch.data_inicio = (b.data_inicio as string) || null
    if ('data_fim' in b) patch.data_fim = (b.data_fim as string) || null
    for (const f of ['produtos_front', 'produtos_ob', 'produtos_upsell', 'produtos_downsell']) {
      if (Array.isArray(b[f])) patch[f] = (b[f] as unknown[]).filter((x): x is string => typeof x === 'string')
    }
    if (b.metas && typeof b.metas === 'object') patch.metas = b.metas
    if ('descricao' in b) patch.descricao = (b.descricao as string) ?? null

    const ws = await getActiveWorkspaceId()
    const { data, error } = await supa().from('acoes_vendas').update(patch).eq('id', id).eq('workspace_id', ws).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('acoes-vendas PATCH failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ws = await getActiveWorkspaceId()
    const { error } = await supa().from('acoes_vendas').delete().eq('id', id).eq('workspace_id', ws)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('acoes-vendas DELETE failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
