/**
 * DB-backed sessions (Fase 2.2).
 *
 * O cookie carrega só o session_id (uuid v4). Toda validação é por lookup em
 * `user_sessions`. Suporta revogação ativa e mudança de role em tempo real.
 *
 * **Edge-safe**: lookup usa fetch direto pra Supabase REST. Não importa
 * `@supabase/supabase-js` aqui — o middleware precisa ser leve no Edge.
 *
 * Cache: Map em memória por instância (Vercel KV não provisionado — Fase 1.3
 * bloqueada). TTL curto (30s) limita janela onde mudanças em users.role/status
 * demoram a refletir. Cold start zera cache, então pior caso é 1 hit a mais.
 */

import type { Role } from '@/lib/auth'

export type UserStatus = 'active' | 'pending_onboarding' | 'disabled'

/**
 * ai_config: cota + flag de desligamento + (Fase 2.7) domínios de dados da IA.
 * O escopo por ABA continua derivado de allowed_paths; `data_domains` é uma
 * camada adicional de escopo por FONTE DE DADOS, avaliada em lib/access.ts.
 */
export interface AiConfig {
  quota_daily: number
  disabled: boolean
  /**
   * Domínios de dados que a IA (Equipe/Odin) pode acessar. Admin ignora (acesso
   * total). Semântica FAIL-CLOSED canônica em lib/access.ts:
   *   ausente (undefined) = não configurado → tratado como TODOS (retrocompat);
   *   []                  = explicitamente NENHUM.
   * A distinção undefined-vs-[] é preservada por normalizeAiConfig de propósito.
   * Checagem canônica: canAccessDomain/allowedDomains (lib/access.ts).
   */
  data_domains?: string[]
}

export interface DefaultFilters {
  funil?: string
  conta?: string
  periodo?: string
  de?: string
  ate?: string
}

export interface SessionInfo {
  session_id: string
  user_id: string
  role: Role
  status: UserStatus
  email: string
  name: string | null
  allowed_paths: string[]
  ai_config: AiConfig
  default_filters: DefaultFilters
  avatar_url: string | null
  expires_at: number
}

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24h
export const SESSION_RENEW_THRESHOLD_MS = 4 * 60 * 60 * 1000

const CACHE_TTL_MS = 30 * 1000
const cache = new Map<string, { value: SessionInfo | null; at: number }>()

function cacheGet(id: string): SessionInfo | null | undefined {
  const e = cache.get(id)
  if (!e) return undefined
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cache.delete(id)
    return undefined
  }
  return e.value
}

function cacheSet(id: string, value: SessionInfo | null) {
  if (cache.size > 500) cache.clear()
  cache.set(id, { value, at: Date.now() })
}

// Memo de workspace-ids (membership) por instância. Membership muda raramente,
// então TTL 60s tira o round-trip REST do caminho crítico de TODA page load
// logada. Chave = `role:email` (isolamento multi-tenant — nunca compartilha
// entre usuários). Só cacheia SUCESSO; erro transitório não entra (não fail-close
// um usuário válido por 60s). Cold start zera — pior caso é 1 fetch a mais.
const WS_IDS_TTL_MS = 60 * 1000
const wsIdsCache = new Map<string, { value: string[]; at: number }>()

function supabaseRestUrl(): string {
  const url = process.env.SUPABASE_URL
  if (!url) throw new Error('SUPABASE_URL missing')
  return url
}

function serviceKey(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing')
  return k
}

function defaultQuotaForRole(role: Role): number {
  return role === 'admin' ? 100 : 20
}

function normalizeAiConfig(raw: unknown, role: Role): AiConfig {
  if (!raw || typeof raw !== 'object') {
    return { quota_daily: defaultQuotaForRole(role), disabled: false }
  }
  const r = raw as Record<string, unknown>
  const quota = typeof r.quota_daily === 'number' && r.quota_daily > 0
    ? Math.min(r.quota_daily, 500)
    : defaultQuotaForRole(role)
  const disabled = r.disabled === true
  const out: AiConfig = { quota_daily: quota, disabled }
  // Preserva a distinção undefined (chave ausente → não configurado) vs [] (nenhum).
  // Só define data_domains quando o JSON traz um array — validação de conteúdo
  // (contra o catálogo) fica em lib/access.ts; aqui só saneamos o formato.
  if (Array.isArray(r.data_domains)) {
    out.data_domains = r.data_domains
      .filter((d): d is string => typeof d === 'string' && d.length > 0 && d.length <= 40)
      .slice(0, 50)
  }
  return out
}

function normalizeDefaultFilters(raw: unknown): DefaultFilters {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: DefaultFilters = {}
  if (typeof r.funil === 'string' && r.funil.length <= 30) out.funil = r.funil
  if (typeof r.conta === 'string' && r.conta.length <= 30) out.conta = r.conta
  if (typeof r.periodo === 'string' && r.periodo.length <= 30) out.periodo = r.periodo
  if (typeof r.de === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.de)) out.de = r.de
  if (typeof r.ate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.ate)) out.ate = r.ate
  return out
}

interface UserSessionRow {
  id: string
  user_id: string
  expires_at: string
  revoked_at: string | null
  users: {
    email: string
    name: string | null
    role: Role
    status: UserStatus
    ai_config: unknown
    allowed_paths: string[] | null
    default_filters: unknown
    avatar_url: string | null
  } | null
}

/**
 * Workspaces que a sessão pode acessar. admin → TODOS (god-mode); viewer → só os
 * da sua membership (workspace_members por email). Fail-safe: em erro retorna [].
 *
 * Fica FORA de lookupSession de propósito: o proxy (Edge) chama lookupSession em
 * toda request e NÃO precisa disto — quem precisa é a camada de dados/switcher
 * (Server Components), que chama isto via getWorkspaceContext (react-cache).
 */
export async function fetchWorkspaceIds(email: string, role: Role): Promise<string[]> {
  const memoKey = `${role}:${email.toLowerCase()}`
  const hit = wsIdsCache.get(memoKey)
  if (hit && Date.now() - hit.at < WS_IDS_TTL_MS) return hit.value

  const key = serviceKey()
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
  const base = supabaseRestUrl()
  const remember = (ids: string[]) => {
    if (wsIdsCache.size > 500) wsIdsCache.clear()
    wsIdsCache.set(memoKey, { value: ids, at: Date.now() })
    return ids
  }
  try {
    if (role === 'admin') {
      // arquivado_at is.null → projeto arquivado some até pro admin (soft-delete).
      const res = await fetch(`${base}/rest/v1/workspaces?select=id&arquivado_at=is.null`, { headers, cache: 'no-store' })
      if (!res.ok) return [] // erro transitório: NÃO cacheia
      return remember(((await res.json()) as { id: string }[]).map((r) => r.id))
    }
    const res = await fetch(
      `${base}/rest/v1/workspace_members?user_email=eq.${encodeURIComponent(email)}&select=workspace_id`,
      { headers, cache: 'no-store' },
    )
    if (!res.ok) return [] // erro transitório: NÃO cacheia
    return remember(((await res.json()) as { workspace_id: string }[]).map((r) => r.workspace_id))
  } catch {
    return []
  }
}

export async function lookupSession(sessionId: string): Promise<SessionInfo | null> {
  if (!sessionId || sessionId.length < 16) return null

  const cached = cacheGet(sessionId)
  if (cached !== undefined) return cached

  const url = `${supabaseRestUrl()}/rest/v1/user_sessions?id=eq.${encodeURIComponent(sessionId)}&revoked_at=is.null&select=id,user_id,expires_at,revoked_at,users(email,name,role,status,ai_config,allowed_paths,default_filters,avatar_url)`
  const key = serviceKey()
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    cacheSet(sessionId, null)
    return null
  }

  const rows = (await res.json()) as UserSessionRow[]
  const row = rows?.[0]
  if (!row || !row.users) {
    cacheSet(sessionId, null)
    return null
  }

  const expiresAt = new Date(row.expires_at).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    cacheSet(sessionId, null)
    return null
  }

  if (row.users.status === 'disabled') {
    cacheSet(sessionId, null)
    return null
  }

  const allowedPaths = Array.isArray(row.users.allowed_paths)
    ? row.users.allowed_paths.filter((p): p is string => typeof p === 'string')
    : []

  const info: SessionInfo = {
    session_id: row.id,
    user_id: row.user_id,
    role: row.users.role,
    status: row.users.status,
    email: row.users.email,
    name: row.users.name,
    allowed_paths: allowedPaths,
    ai_config: normalizeAiConfig(row.users.ai_config, row.users.role),
    default_filters: normalizeDefaultFilters(row.users.default_filters),
    avatar_url: row.users.avatar_url,
    expires_at: expiresAt,
  }
  cacheSet(sessionId, info)
  return info
}

export function invalidateSessionCache(sessionId: string) {
  cache.delete(sessionId)
}

export async function createSession(args: {
  userId: string
  ip: string | null
  userAgent: string | null
}): Promise<string> {
  const id = crypto.randomUUID()
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  const key = serviceKey()
  const res = await fetch(`${supabaseRestUrl()}/rest/v1/user_sessions`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      id,
      user_id: args.userId,
      ip: args.ip ?? null,
      user_agent: (args.userAgent ?? '').slice(0, 250) || null,
      expires_at: expires,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`createSession falhou: ${res.status} ${detail.slice(0, 200)}`)
  }
  return id
}

export async function revokeSession(sessionId: string): Promise<void> {
  if (!sessionId) return
  const key = serviceKey()
  await fetch(`${supabaseRestUrl()}/rest/v1/user_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  }).catch(() => {})
  invalidateSessionCache(sessionId)
}

export async function touchSession(sessionId: string): Promise<void> {
  if (!sessionId) return
  const key = serviceKey()
  await fetch(`${supabaseRestUrl()}/rest/v1/user_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      last_seen_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    }),
  }).catch(() => {})
  invalidateSessionCache(sessionId)
}
