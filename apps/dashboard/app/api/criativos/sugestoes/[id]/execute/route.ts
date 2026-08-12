/**
 * POST /api/criativos/sugestoes/[id]/execute
 *   body opcional: { executado_por?: string, dry_run?: boolean }
 *
 * Executa sugestão APROVADA.
 *   - 'escalar' / 'pausar'   → Meta Graph API (precisa de ad_id)
 *   - 'vault_save'           → mind-vault MCP (ad_id = 'vault' se sem origem)
 *   - 'novo_brief' / 'lateralizar' / 'congruencia_fix' → 422 (humano copia da UI)
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceFromRequest } from '@/lib/criativo-pipeline'
import { executarAcao, CriativoAcaoLockError } from '@/lib/criativo-acoes'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface ExecuteBody {
  executado_por?: string
  dry_run?: boolean
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  // ── Segurança P0: executa sugestão que pode ESCALAR/PAUSAR (dinheiro) ──────
  // Revalida sessão admin no handler (defense-in-depth + rejeita bypass de
  // CRON_SECRET) e garante humano-no-loop (IA nunca executa dinheiro sozinha).
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden: executar sugestão exige admin' }, { status: 403 })
  }

  let body: ExecuteBody = {}
  try {
    body = (await req.json().catch(() => ({}))) as ExecuteBody
  } catch {
    // body opcional
  }

  try {
    const client = supa()
    const { id: workspaceId } = await resolveWorkspaceFromRequest(client, req)

    const { data: sug, error: sErr } = await client
      .from('criativo_sugestoes')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!sug) return NextResponse.json({ error: 'sugestão não encontrada' }, { status: 404 })

    if (sug.status !== 'approved' && sug.status !== 'edited') {
      return NextResponse.json(
        { error: `sugestão precisa estar approved/edited (atual: ${sug.status})` },
        { status: 409 }
      )
    }

    const TIPOS_EXECUTAVEIS = ['escalar', 'pausar', 'vault_save'] as const
    type TipoExecutavel = (typeof TIPOS_EXECUTAVEIS)[number]
    if (!TIPOS_EXECUTAVEIS.includes(sug.tipo as TipoExecutavel)) {
      return NextResponse.json(
        { error: `tipo '${sug.tipo}' não é executável automaticamente — use a UI` },
        { status: 422 }
      )
    }

    if (sug.tipo !== 'vault_save' && !sug.ad_id) {
      return NextResponse.json({ error: 'sugestão sem ad_id' }, { status: 422 })
    }

    if (sug.tipo === 'vault_save' && !sug.payload?.vault_note) {
      return NextResponse.json({ error: 'sugestão vault_save sem payload.vault_note' }, { status: 422 })
    }

    const result = await executarAcao(client, {
      workspaceId,
      adId: sug.ad_id ?? 'vault',
      tipo: sug.tipo as TipoExecutavel,
      payload: sug.payload ?? {},
      sugestaoId: sug.id,
      executadoPor: session.email, // ator do SERVIDOR (sessão), nunca do body
      dryRun: !!body.dry_run,
    })

    const status = result.status === 'failed' ? 502 : 200
    return NextResponse.json({ sugestaoId: id, ...result }, { status })
  } catch (err) {
    if (err instanceof CriativoAcaoLockError) {
      return NextResponse.json({ error: err.message, code: 'LOCKED' }, { status: 409 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    log.error('sugestoes/execute failed', { id, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
