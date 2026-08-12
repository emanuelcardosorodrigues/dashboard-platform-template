/**
 * GET  /api/planejamento/[id]/notas — lista notas do planejamento
 * POST /api/planejamento/[id]/notas — cria nota { corpo }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ws = await getActiveWorkspaceId()
    const { data, error } = await supa().from('acao_notas').select('*').eq('acao_id', id).eq('workspace_id', ws).order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ notas: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ws = await getActiveWorkspaceId()
    const db = supa()
    const { data: dono } = await db.from('acoes_vendas').select('id').eq('id', id).eq('workspace_id', ws).maybeSingle()
    if (!dono) return NextResponse.json({ error: 'planejamento não encontrado' }, { status: 404 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const corpo = typeof b.corpo === 'string' ? b.corpo : ''
    // autor_email vem da SESSÃO, nunca do body (senão é forjável — auditoria falsa).
    const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
    const session = sessionId ? await lookupSession(sessionId) : null
    const autor_email = session?.email ?? null
    const { data, error } = await db.from('acao_notas').insert({ workspace_id: ws, acao_id: id, corpo, autor_email }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
