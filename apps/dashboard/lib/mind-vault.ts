/**
 * Mind Vault client — HTTP wrapper sobre o MCP server hospedado em Cloudflare.
 *
 * Por quê esse arquivo existe:
 * - O MCP `mind-vault` é acessível via JSON-RPC 2.0 em /mcp do worker. O
 *   dashboard precisa ler avatar/One Belief/thresholds/padrões em runtime
 *   (server actions, cron, análise IA) — não dá pra depender do CLI do Claude.
 * - Mind Vault é bidirecional: lê (avatar, One Belief, padrões) e escreve (em
 *   modo proposta, via `proposeVaultSave`, que NUNCA salva direto — vira
 *   sugestão pendente em `criativo_sugestoes` tipo `vault_save` pra humano
 *   aprovar). Esse é o cowork pattern [mind-vault: b4crjq2vat53].
 *
 * Erros: SEM .catch silencioso [mind-vault: 6nwa5txkxsq3]. Toda falha de rede,
 * tipo errado ou HTTP não-ok é lançada como `MindVaultError` com causa.
 */
import { createClient } from '@supabase/supabase-js'
import { log } from './log'

const MCP_URL = process.env.MIND_VAULT_MCP_URL

export class MindVaultError extends Error {
  constructor(msg: string, readonly cause?: unknown) {
    super(msg)
    this.name = 'MindVaultError'
  }
}

// ─── MCP JSON-RPC primitive ───────────────────────────────────────────────────

interface McpResult {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
}

let rpcId = 0

async function callTool<T = unknown>(tool: string, args: Record<string, unknown>): Promise<T> {
  if (!MCP_URL) throw new MindVaultError('MIND_VAULT_MCP_URL is not configured')
  const id = ++rpcId
  const body = {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  }

  let res: Response
  try {
    res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    })
  } catch (cause) {
    throw new MindVaultError(`network failure calling ${tool}`, cause)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new MindVaultError(`mcp ${tool} returned ${res.status}: ${text.slice(0, 200)}`)
  }

  // Server pode responder JSON puro ou SSE. Detecta pelo content-type.
  const ct = res.headers.get('content-type') ?? ''
  let payload: unknown
  if (ct.includes('text/event-stream')) {
    const raw = await res.text()
    const dataLine = raw
      .split('\n')
      .find((l) => l.startsWith('data:'))
      ?.slice(5)
      .trim()
    if (!dataLine) throw new MindVaultError(`mcp ${tool} returned empty SSE`)
    payload = JSON.parse(dataLine)
  } else {
    payload = await res.json().catch((cause) => {
      throw new MindVaultError(`mcp ${tool} returned non-JSON`, cause)
    })
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new MindVaultError(`mcp ${tool} returned non-object`)
  }
  const env = payload as { error?: { message?: string }; result?: McpResult }
  if (env.error) throw new MindVaultError(`mcp ${tool} error: ${env.error.message ?? 'unknown'}`)
  if (!env.result) throw new MindVaultError(`mcp ${tool} missing result`)
  if (env.result.isError) {
    const errText = env.result.content?.[0]?.text ?? 'unknown tool error'
    throw new MindVaultError(`mcp ${tool} tool error: ${errText}`)
  }

  const text = env.result.content?.[0]?.text
  if (typeof text !== 'string') {
    throw new MindVaultError(`mcp ${tool} returned no text content`)
  }

  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

// ─── Domain types ─────────────────────────────────────────────────────────────

export type VaultKind =
  | 'concept' | 'decision' | 'insight' | 'fact' | 'pattern' | 'principle' | 'question'

export interface VaultHit {
  id: string
  title: string
  domain: string
  kind: VaultKind
  tldr: string
}

export interface VaultNote {
  id: string
  title: string
  body: string
  tldr: string
  domains: string[]
  kind: VaultKind
  tags?: string[]
  created_at?: number
  updated_at?: number
}

export interface VaultStats {
  total_notes: number
  by_domain?: Record<string, number>
  by_kind?: Record<string, number>
}

// ─── Cache local (1h TTL, in-memory) ──────────────────────────────────────────
// Evita martelar o worker em loops de análise. Reset por process; em Vercel,
// dura o tempo da função quente. Persistência durável fica pra futuro.

const TTL_MS = 60 * 60 * 1000
type CacheEntry<T> = { value: T; until: number }
const cache = new Map<string, CacheEntry<unknown>>()

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.until < Date.now()) {
    cache.delete(key)
    return null
  }
  return hit.value as T
}

function cacheSet<T>(key: string, value: T) {
  cache.set(key, { value, until: Date.now() + TTL_MS })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function recall(
  query: string,
  opts: { domainsFilter?: string[]; limit?: number } = {}
): Promise<VaultHit[]> {
  const key = `recall:${query}:${(opts.domainsFilter ?? []).join(',')}:${opts.limit ?? 15}`
  const cached = cacheGet<VaultHit[]>(key)
  if (cached) return cached

  const args: Record<string, unknown> = { query, limit: opts.limit ?? 15 }
  if (opts.domainsFilter?.length) args.domains_filter = opts.domainsFilter

  const result = await callTool<VaultHit[] | { hits?: VaultHit[] }>('recall', args)
  const hits = Array.isArray(result) ? result : (result.hits ?? [])
  cacheSet(key, hits)
  return hits
}

export async function getNote(id: string): Promise<VaultNote> {
  const key = `note:${id}`
  const cached = cacheGet<VaultNote>(key)
  if (cached) return cached
  const note = await callTool<VaultNote>('get_note', { id })
  if (!note || typeof note.id !== 'string') {
    throw new MindVaultError(`get_note returned malformed note for id=${id}`)
  }
  cacheSet(key, note)
  return note
}

export async function stats(): Promise<VaultStats> {
  return callTool<VaultStats>('stats', {})
}

/**
 * Salva nota direto no vault. Usado SÓ pelo executor da sugestão `vault_save`
 * depois que humano aprovou no dashboard — proposeVaultSave apenas enfileira.
 * O MCP retorna { id, title, ... }; devolvemos o id pra audit log.
 */
export interface SaveNoteArgs {
  title: string
  body: string
  tldr: string
  domains: string[]
  kind: VaultKind
  tags?: string[]
}

export async function saveNote(args: SaveNoteArgs): Promise<{ id: string }> {
  if (!args.title || !args.body || !args.tldr) {
    throw new MindVaultError('saveNote: title/body/tldr são obrigatórios')
  }
  if (!Array.isArray(args.domains) || args.domains.length === 0) {
    throw new MindVaultError('saveNote: domains não pode ser vazio')
  }
  const result = await callTool<{ id?: string }>('save_note', {
    title: args.title,
    body: args.body,
    tldr: args.tldr,
    domains: args.domains,
    kind: args.kind,
    tags: args.tags ?? [],
  })
  if (!result || typeof result.id !== 'string') {
    throw new MindVaultError('saveNote: MCP não retornou id válido')
  }
  return { id: result.id }
}

/**
 * NÃO salva direto no vault. Cria uma sugestão pendente do tipo `vault_save`
 * em `criativo_sugestoes` pro humano revisar e aprovar [b4crjq2vat53]. Quem
 * efetivamente chama save_note só é o endpoint de aprovação (PR 14).
 */
export interface ProposeVaultSaveArgs {
  workspaceId: string
  title: string
  body: string
  tldr: string
  domains: string[]
  kind: VaultKind
  tags?: string[]
  motivo: string
  evidencias: Array<{ tipo: string; ref: string; trecho?: string }>
  custoUsd?: number
  modelo?: string
}

export async function proposeVaultSave(
  args: ProposeVaultSaveArgs,
  supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
): Promise<{ sugestaoId: string }> {
  const { data, error } = await supabase
    .from('criativo_sugestoes')
    .insert({
      workspace_id: args.workspaceId,
      tipo: 'vault_save',
      payload: {
        motivo: args.motivo,
        evidencias: args.evidencias,
        vault_note: {
          title: args.title,
          body: args.body,
          tldr: args.tldr,
          domains: args.domains,
          kind: args.kind,
          tags: args.tags ?? [],
        },
      },
      status: 'pending',
      custo_usd: args.custoUsd,
      modelo: args.modelo,
    })
    .select('id')
    .single()

  if (error) {
    throw new MindVaultError(`failed to propose vault save: ${error.message}`)
  }
  log.info('vault save proposed', { sugestaoId: data.id, title: args.title })
  return { sugestaoId: data.id }
}

/**
 * Saída direta do recall com domínios pré-filtrados pro workspace. Use isso
 * sempre que possível em vez de `recall` cru — respeita `workspaces.vault_domains`.
 */
export async function recallForWorkspace(
  workspaceId: string,
  query: string,
  opts: { limit?: number } = {},
  supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
): Promise<VaultHit[]> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('vault_domains')
    .eq('id', workspaceId)
    .single()
  if (error) throw new MindVaultError(`workspace ${workspaceId}: ${error.message}`)

  const domains = Array.isArray(data?.vault_domains)
    ? (data.vault_domains as string[])
    : []
  return recall(query, { domainsFilter: domains.length ? domains : undefined, limit: opts.limit })
}
