/**
 * Ledger de custo/tokens da IA (A-F5). Registra cada turno em ai_usage_ledger e
 * calcula o custo em USD por modelo. Base do "créditos" no header e do TETO por
 * workspace. Gemini/Groq entram com custo 0 (grátis); Claude cobra por token.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** USD por 1M tokens {input, output}. Fonte: tabela de modelos do claude-api skill. */
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
}

export function estimateCostUsd(model: string, tokensIn: number | null, tokensOut: number | null): number {
  const p = PRICING[model]
  if (!p) return 0 // gemini/groq/desconhecido → grátis
  const ti = tokensIn ?? 0
  const to = tokensOut ?? 0
  return (ti / 1_000_000) * p.in + (to / 1_000_000) * p.out
}

export interface LedgerEntry {
  workspaceId: string
  userEmail: string | null
  scope: string | null
  provider: string
  model: string
  tokensInput: number | null
  tokensOutput: number | null
  /** assinatura (bridge Claude Code) = sem custo marginal → cost_usd = 0 */
  subscription?: boolean
}

/** Grava o turno no ledger. Best-effort: erro só loga, nunca derruba a resposta. */
export async function recordLedger(client: SupabaseClient, e: LedgerEntry): Promise<number> {
  const cost = e.subscription ? 0 : estimateCostUsd(e.model, e.tokensInput, e.tokensOutput)
  const { error } = await client.from('ai_usage_ledger').insert({
    workspace_id: e.workspaceId,
    user_email: e.userEmail,
    scope: e.scope,
    provider: e.provider,
    model: e.model,
    tokens_input: e.tokensInput,
    tokens_output: e.tokensOutput,
    cost_usd: cost,
  })
  if (error) {
    // não relança: o ledger é contabilidade, não pode quebrar o chat
    console.error('[aiLedger] falha ao gravar', error.message)
  }
  return cost
}

/** Teto mensal de custo por workspace (USD). 0/ausente = sem teto. */
function monthlyCapUsd(): number {
  const raw = Number(process.env.AI_WORKSPACE_MONTHLY_CAP_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

export interface CapState {
  ok: boolean
  spent: number
  cap: number
}

/** Soma o custo do mês corrente (UTC) e compara com o teto. */
export async function withinMonthlyCap(client: SupabaseClient, workspaceId: string): Promise<CapState> {
  const cap = monthlyCapUsd()
  if (cap <= 0) return { ok: true, spent: 0, cap: 0 }
  const monthStart = new Date().toISOString().slice(0, 7) + '-01T00:00:00Z'
  const { data, error } = await client
    .from('ai_usage_ledger')
    .select('cost_usd')
    .eq('workspace_id', workspaceId)
    .gte('at', monthStart)
  if (error) return { ok: true, spent: 0, cap } // fail-open: erro de leitura não bloqueia
  const spent = (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  return { ok: spent < cap, spent, cap }
}
