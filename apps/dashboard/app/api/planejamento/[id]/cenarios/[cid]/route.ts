/**
 * PATCH  /api/planejamento/[id]/cenarios/[cid] — alvo do auto-save (estado/nome do cenário).
 *   Concorrência otimista: body.updated_at deve casar o do banco (senão 409). Recalcula is_melhor.
 * DELETE /api/planejamento/[id]/cenarios/[cid] — remove cenário (não permite remover o Base/ordem 0).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { computeDerivadoPorTipo } from '@/lib/funilEngine'
import type { AcaoTipo } from '@/lib/acoesVendas'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

/** Recalcula is_melhor de TODOS os cenários simulados da ação (autoridade server). Maior ROAS vence; 'real' não concorre. */
async function recomputeMelhor(db: ReturnType<typeof supa>, acaoId: string, ws: string) {
  const { data: acao } = await db.from('acoes_vendas').select('tipo').eq('id', acaoId).eq('workspace_id', ws).maybeSingle()
  const tipo = (acao?.tipo ?? 'lancamento_pago') as AcaoTipo
  const { data } = await db.from('acao_cenarios').select('id, kind, estado').eq('acao_id', acaoId).eq('workspace_id', ws)
  if (!data) return
  let melhorId: string | null = null
  let melhorRoas = 0
  for (const c of data) {
    if (c.kind !== 'simulado') continue
    const roas = computeDerivadoPorTipo(tipo, c.estado).roas
    if (roas > melhorRoas) { melhorRoas = roas; melhorId = c.id }
  }
  await Promise.all(data.map((c) => db.from('acao_cenarios').update({ is_melhor: c.id === melhorId }).eq('id', c.id).eq('workspace_id', ws)))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; cid: string }> }) {
  try {
    const { id, cid } = await params
    const ws = await getActiveWorkspaceId()
    const db = supa()
    const b = (await req.json()) as Record<string, unknown>

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.estado && typeof b.estado === 'object') patch.estado = b.estado
    if (typeof b.nome === 'string' && b.nome.trim()) patch.nome = b.nome.trim()

    // concorrência otimista: só atualiza se updated_at bate (evita last-write-wins entre abas)
    let q = db.from('acao_cenarios').update(patch).eq('id', cid).eq('acao_id', id).eq('workspace_id', ws)
    if (typeof b.updated_at === 'string') q = q.eq('updated_at', b.updated_at)
    const { data, error } = await q.select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'conflito: o cenário foi atualizado em outro lugar', code: 'CONFLICT' }, { status: 409 })
    }

    if (patch.estado) await recomputeMelhor(db, id, ws)
    return NextResponse.json({ ok: true, cenario: data[0] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; cid: string }> }) {
  try {
    const { id, cid } = await params
    const ws = await getActiveWorkspaceId()
    const db = supa()
    const { data: alvo } = await db.from('acao_cenarios').select('ordem').eq('id', cid).eq('acao_id', id).eq('workspace_id', ws).maybeSingle()
    if (!alvo) return NextResponse.json({ error: 'cenário não encontrado' }, { status: 404 })
    if (alvo.ordem === 0) return NextResponse.json({ error: 'o cenário Base não pode ser removido' }, { status: 400 })

    const { error } = await db.from('acao_cenarios').delete().eq('id', cid).eq('acao_id', id).eq('workspace_id', ws)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await recomputeMelhor(db, id, ws)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
