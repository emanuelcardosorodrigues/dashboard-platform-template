/**
 * POST /api/criativos/chats/[id]/stream — append COM STREAMING (SSE).
 * Só Claude (bridge). Streama os tokens do bridge pro browser e, no fim, persiste
 * a mensagem + cobra quota + ledger (mesmo se o cliente desconectar no meio).
 * O caminho não-streaming ([id] POST) segue intacto pro Gemini / fallback.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAiUsage, incrementAndGetAiUsage } from '@/lib/aiUsage'
import { requireAuth } from '@/lib/apiAuth'
import { canAccessDomain } from '@/lib/access'
import { claudeAvailable } from '@/lib/aiProviders'
import { compactHistory } from '@/lib/chatCompaction'
import { recordLedger } from '@/lib/aiLedger'
import { buildCreativeSystemPrompt, buildPortfolioSystemPrompt, CHATS_PROMPT_VERSION } from '@/lib/prompts/chats-v1'
import { loadCreativeContext, loadPortfolioContext } from '../../route'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
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

interface StreamBody {
  mensagem: string
  model?: string
  ad_ids?: string[]
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  let body: StreamBody
  try {
    body = (await req.json()) as StreamBody
  } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 })
  }
  const mensagem = body.mensagem?.trim()
  if (!mensagem) return NextResponse.json({ error: 'mensagem requerida' }, { status: 400 })

  const client = supa()
  const auth = await requireAuth(req, client)
  if ('error' in auth) return auth.error
  const { session, ws } = auth
  if (session.ai_config.disabled) return NextResponse.json({ error: 'IA desativada para este usuário.' }, { status: 403 })
  if (!canAccessDomain(session, 'criativos')) return NextResponse.json({ error: 'Sem acesso ao domínio de criativos.' }, { status: 403 })
  if (!claudeAvailable()) return NextResponse.json({ error: 'Streaming requer o Claude ligado.' }, { status: 400 })
  const usage = await getAiUsage(session.user_id)
  if (usage.count >= session.ai_config.quota_daily) {
    return NextResponse.json({ error: `Limite diário atingido (${session.ai_config.quota_daily}).` }, { status: 429 })
  }

  const { data: chat, error: chatErr } = await client
    .from('criativo_chats')
    .select('id, scope, ad_id, mensagens')
    .eq('id', id)
    .eq('workspace_id', ws.id)
    .maybeSingle()
  if (chatErr) return NextResponse.json({ error: chatErr.message }, { status: 500 })
  if (!chat) return NextResponse.json({ error: 'chat não encontrado' }, { status: 404 })

  const systemPrompt =
    chat.scope === 'creative'
      ? buildCreativeSystemPrompt(ws.ctx, await loadCreativeContext(client, ws.id, chat.ad_id!))
      : buildPortfolioSystemPrompt(ws.ctx, await loadPortfolioContext(client, ws.id, body.ad_ids))

  const existing = (chat.mensagens ?? []) as PersistedTurn[]
  // COMPACTION: resume os turns antigos num bloco compacto e mantém os últimos K
  // verbatim, em vez de cortar no braço. Best-effort → cai pro slice(-40).
  const priorMsgs = existing.map((t) => ({ role: t.role, content: t.content }))
  const compacted = await compactHistory(priorMsgs, { fallbackSlice: 40 })
  const history = [
    ...compacted,
    { role: 'user' as const, content: mensagem },
  ]

  const base = process.env.CLAUDE_BRIDGE_URL!.replace(/\/$/, '')
  const bridgeRes = await fetch(`${base}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CLAUDE_BRIDGE_SECRET}` },
    body: JSON.stringify({ system: systemPrompt, messages: history, model: body.model }),
    signal: AbortSignal.timeout(180000),
  })
  if (!bridgeRes.ok || !bridgeRes.body) {
    return NextResponse.json({ error: 'bridge indisponível' }, { status: 502 })
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = bridgeRes.body.getReader()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = ''
      let modelUsed = 'claude'
      let tokIn: number | null = null
      let tokOut: number | null = null
      let buf = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, nl)
            buf = buf.slice(nl + 2)
            const line = chunk.replace(/^data:\s?/, '').trim()
            if (!line) continue
            let ev: Record<string, unknown>
            try { ev = JSON.parse(line) } catch { continue }
            if (typeof ev.delta === 'string') {
              full += ev.delta
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: ev.delta })}\n\n`))
            } else if (ev.thinking) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ thinking: true })}\n\n`))
            } else if (ev.done) {
              if (typeof ev.model === 'string') modelUsed = ev.model
              tokIn = (ev.tokens_input as number | null) ?? null
              tokOut = (ev.tokens_output as number | null) ?? null
              if (!full && typeof ev.reply === 'string') full = ev.reply
            } else if (typeof ev.error === 'string') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: ev.error })}\n\n`))
            }
          }
        }
      } catch {
        /* cliente/bridge caiu — ainda persistimos o que veio */
      }

      // Persiste (mesmo em desconexão do cliente) + cobra quota/ledger só em sucesso.
      try {
        const now = new Date().toISOString()
        const mensagensFinal: PersistedTurn[] = [
          ...existing,
          { role: 'user', content: mensagem, at: now },
          { role: 'model', content: full || '(sem resposta)', at: now, modelo: modelUsed, prompt_version: CHATS_PROMPT_VERSION, tokens_input: tokIn, tokens_output: tokOut },
        ]
        await client.from('criativo_chats').update({ mensagens: mensagensFinal, updated_at: now }).eq('id', id).eq('workspace_id', ws.id)
        await incrementAndGetAiUsage(session.user_id)
        await recordLedger(client, {
          workspaceId: ws.id, userEmail: session.email, scope: chat.scope,
          provider: 'claude', model: modelUsed, tokensInput: tokIn, tokensOutput: tokOut, subscription: true,
        })
      } catch (e) {
        log.error('stream persist failed', { id, msg: e instanceof Error ? e.message : String(e) })
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
