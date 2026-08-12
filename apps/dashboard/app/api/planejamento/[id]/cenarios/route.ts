/**
 * GET  /api/planejamento/[id]/cenarios — lista cenários do planejamento
 * POST /api/planejamento/[id]/cenarios — adiciona um cenário extra (limite 7 simulados)
 * Cenário "real" é VIRTUAL (computado dos dados), não é persistido aqui.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { estadoVazioFunil } from '@/lib/funilEngine'

export const dynamic = 'force-dynamic'

const MAX_SIMULADOS = 7 // Base + A + B + 4 extras

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

async function donoOuNull(db: ReturnType<typeof supa>, id: string, ws: string) {
  const { data } = await db.from('acoes_vendas').select('id').eq('id', id).eq('workspace_id', ws).maybeSingle()
  return data?.id ?? null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ws = await getActiveWorkspaceId()
    const { data, error } = await supa().from('acao_cenarios').select('*').eq('acao_id', id).eq('workspace_id', ws).order('ordem', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ cenarios: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ws = await getActiveWorkspaceId()
    const db = supa()
    if (!(await donoOuNull(db, id, ws))) return NextResponse.json({ error: 'planejamento não encontrado' }, { status: 404 })

    const { data: existentes } = await db.from('acao_cenarios').select('id, ordem, estado').eq('acao_id', id).eq('workspace_id', ws).eq('kind', 'simulado')
    const simulados = existentes ?? []
    if (simulados.length >= MAX_SIMULADOS) return NextResponse.json({ error: `limite de ${MAX_SIMULADOS} cenários simulados atingido` }, { status: 400 })

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const nome = typeof b.nome === 'string' && b.nome.trim() ? b.nome.trim() : `Extra ${Math.max(0, simulados.length - 2)}`
    // herda os inputs do cenário "Base", variação zerada (variação editada depois)
    const base = simulados.find((c) => c.ordem === 0)
    const estado = base?.estado
      ? { ...(base.estado as Record<string, unknown>), variacao: {} }
      : estadoVazioFunil()
    const ordem = Math.max(0, ...simulados.map((c) => c.ordem)) + 1

    const { data, error } = await db.from('acao_cenarios').insert({
      workspace_id: ws, acao_id: id, nome, ordem, kind: 'simulado', estado, is_melhor: false,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
