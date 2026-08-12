/**
 * GET  /api/acoes-vendas  — lista as ações de vendas
 * POST /api/acoes-vendas  — cria uma ação
 * body: { nome, tipo, data_inicio?, data_fim?, produtos_front?/ob?/upsell?/downsell?, metas?, descricao?, status? }
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
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export async function GET() {
  try {
    const ws = await getActiveWorkspaceId()
    const { data, error } = await supa().from('acoes_vendas').select('*').eq('workspace_id', ws).order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ acoes: data ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>
    const nome = typeof b.nome === 'string' ? b.nome.trim() : ''
    if (!nome) return NextResponse.json({ error: 'nome requerido' }, { status: 400 })
    const tipo = typeof b.tipo === 'string' && TIPOS.includes(b.tipo) ? b.tipo : 'lancamento_pago'
    const ws = await getActiveWorkspaceId()

    const { data, error } = await supa()
      .from('acoes_vendas')
      .insert({
        workspace_id: ws,
        nome,
        tipo,
        data_inicio: (b.data_inicio as string) || null,
        data_fim: (b.data_fim as string) || null,
        produtos_front: arr(b.produtos_front),
        produtos_ob: arr(b.produtos_ob),
        produtos_upsell: arr(b.produtos_upsell),
        produtos_downsell: arr(b.produtos_downsell),
        metas: (b.metas as Record<string, number>) ?? {},
        descricao: (b.descricao as string) ?? null,
        status: (b.status as string) ?? 'ativo',
      })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('acoes-vendas POST failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
