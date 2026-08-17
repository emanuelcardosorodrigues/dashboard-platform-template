/**
 * Config de borda (Cloudflare) do Worker A/B, resolvida POR WORKSPACE.
 *
 * Cada projeto vive na sua própria conta Cloudflare — KV, D1 e token
 * independentes. A invalidação de KV e o sync de fallback no D1 precisam
 * bater na conta DO workspace do experimento, nunca numa conta compartilhada
 * ("o do Leandro é só do Leandro").
 *
 * Fonte: env `AB_EDGE_ACCOUNTS` — JSON `{ [workspaceId]: EdgeAccount }`.
 *   {"<uuid>":{"account_id":"...","api_token":"...","kv_namespace_id":"...","d1_database_id":"..."}}
 *
 * Compatibilidade: se `AB_EDGE_ACCOUNTS` NÃO estiver definido, cai no legado
 * de conta única (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` +
 * `AB_KV_NAMESPACE_ID` + `D1_DATABASE_ID`) para TODOS os workspaces — o
 * comportamento anterior à migração multi-conta. Com o env definido, a
 * resolução é estrita: workspace sem entrada → `null` (pula a invalidação; o
 * Worker ainda converge pelo TTL de 5 min do KV). Assim um projeto nunca
 * escreve na borda de outro.
 */
export interface EdgeAccount {
  accountId: string
  apiToken: string
  kvNamespaceId: string
  d1DatabaseId: string
}

let cache: { raw: string | undefined; map: Record<string, EdgeAccount> | null } | null = null

function parseMap(raw: string | undefined): Record<string, EdgeAccount> | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Record<string, Record<string, string>>
    const out: Record<string, EdgeAccount> = {}
    for (const [wsId, cfg] of Object.entries(obj)) {
      const accountId = cfg.account_id ?? cfg.accountId
      const apiToken = cfg.api_token ?? cfg.apiToken
      const kvNamespaceId = cfg.kv_namespace_id ?? cfg.kvNamespaceId
      const d1DatabaseId = cfg.d1_database_id ?? cfg.d1DatabaseId
      if (accountId && apiToken && kvNamespaceId && d1DatabaseId) {
        out[wsId] = { accountId, apiToken, kvNamespaceId, d1DatabaseId }
      }
    }
    return out
  } catch {
    return null
  }
}

type EdgeEnv = {
  AB_EDGE_ACCOUNTS?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_API_TOKEN?: string
  AB_KV_NAMESPACE_ID?: string
  D1_DATABASE_ID?: string
}

function legacyEdge(env: EdgeEnv): EdgeAccount | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = env.CLOUDFLARE_API_TOKEN
  const kvNamespaceId = env.AB_KV_NAMESPACE_ID
  const d1DatabaseId = env.D1_DATABASE_ID
  if (!accountId || !apiToken || !kvNamespaceId) return null
  return { accountId, apiToken, kvNamespaceId, d1DatabaseId: d1DatabaseId ?? '' }
}

/**
 * Resolve a conta de borda de um workspace. `env` é injetável para teste.
 * - `AB_EDGE_ACCOUNTS` definido → estrito por workspace (ou `null`).
 * - ausente → legado de conta única para qualquer workspace.
 */
export function edgeForWorkspace(
  workspaceId: string,
  env: EdgeEnv = process.env as EdgeEnv,
): EdgeAccount | null {
  const raw = env.AB_EDGE_ACCOUNTS
  // Env presente (mesmo malformado) → resolução ESTRITA por workspace: nunca
  // cai no legado de conta única, pra não escrever na borda de outro projeto.
  if (raw && raw.trim()) {
    if (!cache || cache.raw !== raw) cache = { raw, map: parseMap(raw) ?? {} }
    return cache.map![workspaceId] ?? null
  }
  return legacyEdge(env)
}

/** Reset do cache — só para teste. */
export function __resetEdgeCache() {
  cache = null
}
