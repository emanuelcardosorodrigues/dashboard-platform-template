/**
 * Adapter multi-provider do chat (A-F5). Uma entrada — runChat — atrás dos dois
 * motores, mesmo shape do chatTurn:
 *   - Gemini/Groq GRÁTIS (default, comportamento atual intacto).
 *   - Claude pela ASSINATURA MAX do usuário, via bridge self-hosted (Claude Code
 *     `-p` rodando na VPS equipe, logado na assinatura). Sem custo por token além
 *     da mensalidade — NÃO usa a API paga da Anthropic.
 *
 * Sem CLAUDE_BRIDGE_URL/CLAUDE_BRIDGE_SECRET → cai pro Gemini grátis.
 */
import { chatTurn, chatTurnAgentic, type ChatMessage, type ChatTurnOutput, type AgenticTool, type ToolExecutor } from '@/lib/gemini'

export type Provider = 'gemini' | 'claude'
export type Effort = 'low' | 'medium' | 'high' | 'max'

export const CLAUDE_MODELS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'] as const
const CLAUDE_SET = new Set<string>(CLAUDE_MODELS)
const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8'
const BRIDGE_TIMEOUT_MS = 150_000

export function isValidEffort(v: unknown): v is Effort {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'max'
}
/** Claude disponível = bridge da assinatura configurado. */
export function claudeAvailable(): boolean {
  return !!(process.env.CLAUDE_BRIDGE_URL && process.env.CLAUDE_BRIDGE_SECRET)
}

export interface RunChatOpts {
  provider?: Provider
  model?: string
  effort?: Effort
  systemPrompt: string
  history: ChatMessage[]
  promptVersion: string
  /** tools agênticas — só no Gemini (o bridge do Claude é texto-só). */
  tools?: AgenticTool[]
  executeTool?: ToolExecutor
}
export type RunChatOutput = ChatTurnOutput & { provider: Provider; toolCalls?: string[] }

export async function runChat(opts: RunChatOpts): Promise<RunChatOutput> {
  if (opts.provider === 'claude' && claudeAvailable()) {
    // bridge é texto-só: se pediram tools, elas simplesmente não rodam no Claude.
    return { ...(await claudeViaBridge(opts)), provider: 'claude' }
  }
  if (opts.tools?.length && opts.executeTool) {
    const out = await chatTurnAgentic({
      systemPrompt: opts.systemPrompt,
      history: opts.history,
      promptVersion: opts.promptVersion,
      tools: opts.tools,
      executeTool: opts.executeTool,
    })
    return { ...out, provider: 'gemini' }
  }
  const out = await chatTurn({
    systemPrompt: opts.systemPrompt,
    history: opts.history,
    promptVersion: opts.promptVersion,
  })
  return { ...out, provider: 'gemini' }
}

async function claudeViaBridge(opts: RunChatOpts): Promise<ChatTurnOutput> {
  const base = process.env.CLAUDE_BRIDGE_URL!.replace(/\/$/, '')
  const secret = process.env.CLAUDE_BRIDGE_SECRET!
  const model = opts.model && CLAUDE_SET.has(opts.model) ? opts.model : DEFAULT_CLAUDE_MODEL
  const messages = opts.history.map((m) => ({
    role: m.role === 'model' ? 'assistant' : 'user',
    content: m.content,
  }))

  const res = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ system: opts.systemPrompt, messages, model }),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  })
  const j = (await res.json().catch(() => ({}))) as {
    reply?: string
    model?: string
    tokens_input?: number | null
    tokens_output?: number | null
    is_error?: boolean
    error?: string
  }
  if (!res.ok || j.is_error) {
    throw new Error(j.error || j.reply || `bridge HTTP ${res.status}`)
  }
  return {
    modelo: j.model || model,
    prompt_version: opts.promptVersion,
    reply: j.reply && j.reply.trim() ? j.reply : '(sem resposta)',
    tokens_input: j.tokens_input ?? null,
    tokens_output: j.tokens_output ?? null,
  }
}
