/**
 * POST /api/criativos/sugestoes/[id]/mark-done
 *   body opcional: { executado_por?: string, nota?: string }
 *
 * Fecha sugestão de tipo 'novo_brief' / 'lateralizar' / 'congruencia_fix'
 * SEM chamar API externa — apenas registra que o humano implementou fora
 * do sistema (criou o ad no gerenciador, ajustou copy etc).
 *
 * Insere log com tipo='mark_done' (requer migration 0015) e marca
 * criativo_sugestoes.status='executed'.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceBySlug, resolveWorkspaceByAccountId } from '@/lib/criativo-pipeline'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface MarkDoneBody {
  executado_por?: string
  nota?: string
}

const TIPOS_FECHAVEIS = ['novo_brief', 'lateralizar', 'congruencia_fix'] as const

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const accountId = req.nextUrl.searchParams.get('account_id')
  const body = (await req.json().catch(() => ({}))) as MarkDoneBody

  try {
    const client = supa()
    const { id: workspaceId } = accountId
      ? await resolveWorkspaceByAccountId(client, accountId)
      : await resolveWorkspaceBySlug(client)

    const { data: sug, error: sErr } = await client
      .from('criativo_sugestoes')
      .select('id, tipo, ad_id, status, payload')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!sug) return NextResponse.json({ error: 'sugestão não encontrada' }, { status: 404 })

    if (!TIPOS_FECHAVEIS.includes(sug.tipo)) {
      return NextResponse.json(
        { error: `tipo '${sug.tipo}' não usa mark-done (use /execute pra escalar/pausar/vault_save)` },
        { status: 422 }
      )
    }

    if (sug.status === 'executed') {
      return NextResponse.json({ error: 'sugestão já está executed' }, { status: 409 })
    }

    const { data: logRow, error: logErr } = await client
      .from('criativo_acoes_log')
      .insert({
        workspace_id: workspaceId,
        sugestao_id: sug.id,
        ad_id: sug.ad_id ?? 'manual',
        tipo: 'mark_done',
        payload: { nota: body.nota ?? null, sugestao_tipo: sug.tipo },
        executado_por: body.executado_por ?? null,
        status: 'ok',
        resultado: { closed_manually: true },
        concluido_em: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (logErr || !logRow) {
      return NextResponse.json({ error: `log insert: ${logErr?.message}` }, { status: 500 })
    }

    const { error: upErr } = await client
      .from('criativo_sugestoes')
      .update({ status: 'executed' })
      .eq('id', sug.id)
      .eq('workspace_id', workspaceId)
    if (upErr) {
      log.error('mark-done: falhou update sugestao', { id, msg: upErr.message })
      return NextResponse.json({ error: upErr.message, logId: logRow.id }, { status: 500 })
    }

    return NextResponse.json({ sugestaoId: id, logId: logRow.id, status: 'executed' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('mark-done failed', { id, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
