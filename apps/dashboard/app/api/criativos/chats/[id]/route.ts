/**
 * GET    /api/criativos/chats/[id] — histórico completo do chat
 * POST   /api/criativos/chats/[id] — append mensagem do user + chama Gemini + persiste
 *   body: { mensagem: string, user_email?: string }
 * DELETE /api/criativos/chats/[id] — apaga o chat
 *
 * Append re-monta o systemPrompt do zero (contexto pode ter mudado desde o
 * primeiro turn). Mensagens persistidas têm shape { role, content, at, ... }.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAiUsage, incrementAndGetAiUsage } from '@/lib/aiUsage'
import { type ChatMessage } from '@/lib/gemini'
import { compactHistory } from '@/lib/chatCompaction'
import { runChat, isValidEffort, claudeAvailable, type Provider } from '@/lib/aiProviders'
import { recordLedger, withinMonthlyCap } from '@/lib/aiLedger'
import { TAG_TOOL, makeTagExecutor } from '@/lib/aiTools'
import { canAccessDomain } from '@/lib/access'
import {
  buildCreativeSystemPrompt,
  buildPortfolioSystemPrompt,
  CHATS_PROMPT_VERSION,
} from '@/lib/prompts/chats-v1'
import { loadCreativeContext, loadPortfolioContext } from '../route'
import { requireAuth } from '@/lib/apiAuth'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_HISTORY_TURNS = 40 // garante que mesmo chats longos não estouram token budget

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface PersistedTurn {
  role: 'user' | 'model'
  content: string
  at: string
  tokens_input?: number | null
  tokens_output?: number | null
  modelo?: string
  prompt_version?: string
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  try {
    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error
    const workspaceId = auth.ws.id
    const { data, error } = await client
      .from('criativo_chats')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'chat não encontrado' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('chats[id] GET failed', { id, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface AppendBody {
  mensagem: string
  user_email?: string
  /** conjunto filtrado na tela (scope=portfolio) — reescopado a cada turno */
  ad_ids?: string[]
  /** A-F5: motor de IA. Ausente/gemini = grátis; claude = BYO (precisa key) */
  provider?: Provider
  model?: string
  effort?: string
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now()
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  let body: AppendBody
  try {
    body = (await req.json()) as AppendBody
  } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 })
  }
  if (!body.mensagem || typeof body.mensagem !== 'string' || body.mensagem.trim().length === 0) {
    return NextResponse.json({ error: 'mensagem requerida' }, { status: 400 })
  }

  try {
    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error
    const { session, ws } = auth
    if (session.ai_config.disabled) {
      return NextResponse.json({ error: 'IA desativada para este usuário.' }, { status: 403 })
    }
    if (!canAccessDomain(session, 'criativos')) {
      return NextResponse.json({ error: 'Sem acesso ao domínio de criativos.' }, { status: 403 })
    }
    const usage = await getAiUsage(session.user_id)
    if (usage.count >= session.ai_config.quota_daily) {
      return NextResponse.json({ error: `Limite diário atingido (${session.ai_config.quota_daily}).` }, { status: 429 })
    }
    const provider: Provider = body.provider === 'claude' ? 'claude' : 'gemini'
    if (provider === 'claude' && claudeAvailable()) {
      const cap = await withinMonthlyCap(client, ws.id)
      if (!cap.ok) {
        return NextResponse.json(
          { error: `Teto de custo do mês atingido (US$ ${cap.cap}). Gasto: US$ ${cap.spent.toFixed(2)}.` },
          { status: 402 }
        )
      }
    }

    // 1. Carrega chat existente
    const { data: chat, error: chatErr } = await client
      .from('criativo_chats')
      .select('id, scope, ad_id, user_email, mensagens')
      .eq('id', id)
      .eq('workspace_id', ws.id)
      .maybeSingle()
    if (chatErr) return NextResponse.json({ error: chatErr.message }, { status: 500 })
    if (!chat) return NextResponse.json({ error: 'chat não encontrado' }, { status: 404 })

    const existing = (chat.mensagens ?? []) as PersistedTurn[]

    // 2. Re-monta systemPrompt com contexto fresco
    const systemPrompt =
      chat.scope === 'creative'
        ? buildCreativeSystemPrompt(ws.ctx, await loadCreativeContext(client, ws.id, chat.ad_id!))
        : buildPortfolioSystemPrompt(ws.ctx, await loadPortfolioContext(client, ws.id, body.ad_ids))

    // 3. History pra o modelo: COMPACTION (resume os antigos, mantém os últimos K
    // verbatim) em vez de cortar no braço. Best-effort → cai pro slice(-MAX_HISTORY_TURNS).
    const priorMsgs: ChatMessage[] = existing.map((t) => ({ role: t.role, content: t.content }))
    const compacted = await compactHistory(priorMsgs, { fallbackSlice: MAX_HISTORY_TURNS })
    const history: ChatMessage[] = [
      ...compacted,
      { role: 'user' as const, content: body.mensagem.trim() },
    ]

    const out = await runChat({
      provider,
      model: body.model,
      effort: isValidEffort(body.effort) ? body.effort : undefined,
      systemPrompt,
      history,
      promptVersion: CHATS_PROMPT_VERSION,
      tools: [TAG_TOOL],
      executeTool: makeTagExecutor(ws.id, session.email),
    })
    // cobra a quota só após a resposta do modelo (sucesso)
    await incrementAndGetAiUsage(session.user_id)
    await recordLedger(client, {
      workspaceId: ws.id,
      userEmail: session.email,
      scope: chat.scope,
      provider: out.provider,
      model: out.modelo,
      tokensInput: out.tokens_input,
      tokensOutput: out.tokens_output,
      subscription: out.provider === 'claude',
    })

    // 4. Persistir append
    const novoUserTurn: PersistedTurn = {
      role: 'user',
      content: body.mensagem.trim(),
      at: new Date().toISOString(),
    }
    const novoModelTurn: PersistedTurn = {
      role: 'model',
      content: out.reply,
      at: new Date().toISOString(),
      tokens_input: out.tokens_input,
      tokens_output: out.tokens_output,
      modelo: out.modelo,
      prompt_version: out.prompt_version,
    }
    const mensagensFinal = [...existing, novoUserTurn, novoModelTurn]

    const patch: Record<string, unknown> = {
      mensagens: mensagensFinal,
      updated_at: new Date().toISOString(),
    }
    if (!chat.user_email) patch.user_email = session.email

    const { error: upErr } = await client
      .from('criativo_chats')
      .update(patch)
      .eq('id', id)
      .eq('workspace_id', ws.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    return NextResponse.json({
      id,
      workspaceId: ws.id,
      reply: out.reply,
      modelo: out.modelo,
      provider: out.provider,
      prompt_version: out.prompt_version,
      tokens_input: out.tokens_input,
      tokens_output: out.tokens_output,
      tags_applied: (out.toolCalls?.length ?? 0) > 0,
      total_mensagens: mensagensFinal.length,
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('chats[id] POST failed', { id, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  try {
    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error
    const workspaceId = auth.ws.id
    const { error } = await client
      .from('criativo_chats')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ id, deleted: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('chats[id] DELETE failed', { id, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
