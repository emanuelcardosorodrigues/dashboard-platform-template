/**
 * Grupos (abas) de análise de criativos — FONTE DE VERDADE no banco.
 * Antes viviam no localStorage do browser (perdia entre dispositivos); agora
 * persistem em criativo_grupos, escopados por workspace + e-mail da sessão.
 *
 * GET    /api/criativos/grupos          — lista grupos do user (+ compartilhados)
 * POST   /api/criativos/grupos          — cria 1 grupo   body: { nome, filtro, ordem? }
 * PUT    /api/criativos/grupos          — edita 1 grupo  body: { id, nome?, filtro?, ordem? }
 * DELETE /api/criativos/grupos?id=<id>  — apaga 1 grupo
 *
 * Filtro JSONB (sem schema rígido — extensível):
 *   { metricId: "lucro" }   // métrica de ordenação da aba (uso atual da UI)
 *   { ad_ids: [...] } / { hook_tipo: [...] } / { one_belief_score_gte: 0.7 } // futuro
 * O endpoint é puro CRUD; resolver o filtro pra ad_ids fica na UI.
 *
 * requireAuth valida sessão + membership (fecha o IDOR do resolveWorkspaceFromRequest)
 * e TODA query carrega .eq('workspace_id', ws.id) — tenant isolation.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/apiAuth'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  try {
    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error
    const workspaceId = auth.ws.id
    const email = auth.session.email

    let q = client
      .from('criativo_grupos')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('ordem', { ascending: true })
      .order('created_at', { ascending: false })

    if (email && /^[^\s,()]+@[^\s,()]+$/.test(email)) {
      // grupos do user + grupos compartilhados (user_email is null).
      // O e-mail vem da sessão (confiável); a regex barra vírgula/parênteses
      // por precaução contra a DSL do .or().
      q = q.or(`user_email.eq.${email},user_email.is.null`)
    } else {
      q = q.is('user_email', null) // sem e-mail válido: só grupos compartilhados
    }

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ workspaceId, total: data?.length ?? 0, grupos: data ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('grupos GET failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface CreateGrupoBody {
  nome?: string
  tipo?: 'custom' | 'preset' | 'derivado'
  filtro?: Record<string, unknown>
  ordem?: number
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateGrupoBody
    if (!body.nome || !body.nome.trim()) {
      return NextResponse.json({ error: 'nome requerido' }, { status: 400 })
    }

    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error

    const { data, error } = await client
      .from('criativo_grupos')
      .insert({
        workspace_id: auth.ws.id,
        nome: body.nome.trim(),
        tipo: body.tipo ?? 'custom',
        filtro: body.filtro ?? {},
        ordem: body.ordem ?? 0,
        user_email: auth.session.email, // grupo do usuário (era per-browser no localStorage)
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('grupos POST failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface UpdateGrupoBody {
  id?: string
  nome?: string
  filtro?: Record<string, unknown>
  ordem?: number
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateGrupoBody
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.nome === 'string') {
      if (!body.nome.trim()) return NextResponse.json({ error: 'nome vazio' }, { status: 400 })
      patch.nome = body.nome.trim()
    }
    if (body.filtro && typeof body.filtro === 'object') patch.filtro = body.filtro
    if (typeof body.ordem === 'number') patch.ordem = body.ordem

    const { data, error } = await client
      .from('criativo_grupos')
      .update(patch)
      .eq('id', body.id)
      .eq('workspace_id', auth.ws.id) // tenant isolation
      .select()
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'grupo não encontrado' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('grupos PUT failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error

    const { error } = await client
      .from('criativo_grupos')
      .delete()
      .eq('id', id)
      .eq('workspace_id', auth.ws.id) // tenant isolation
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ id, deleted: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('grupos DELETE failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
