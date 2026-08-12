// NB: sem `import 'server-only'` — quebra o ambiente de teste (vitest) e o lib/
// supabase.ts (que isto alimenta) já é de-facto server-only (usa service-role key).
// `cookies`/`lookupSession` são carregados via import dinâmico DENTRO das funções
// pra não puxar next/headers no grafo de import dos testes.
import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE, ACTIVE_WS_COOKIE } from './auth'

/**
 * Resolução do projeto (workspace) ATIVO da request.
 *
 * Autoridade server-side do isolamento multi-tenant: o cookie `active_ws` é só
 * uma PREFERÊNCIA; só vale se estiver na membership da sessão (admin → todos;
 * viewer → os seus). Forjar o cookie pra outro projeto é ignorado → cai no
 * default. Crons/contexto sem request → default DEMO (workspace fixo).
 *
 * Importante: NUNCA chamar de dentro de um unstable_cache (resolução é
 * request-scoped). O fetcher público resolve aqui e passa o id como ARGUMENTO
 * pro core cacheado, que chaveia o cache por workspace — sem isso, um blob global
 * vazaria dado entre projetos.
 */

const DEFAULT_SLUG = (process.env.DEFAULT_WORKSPACE_SLUG || 'demo').trim()

// Workspace impossível: usado como fail-CLOSED p/ usuário logado SEM membership —
// os fetchers filtram por esse id e retornam vazio (nunca vazam outro projeto).
const NIL_WORKSPACE = '00000000-0000-0000-0000-000000000000'

function sb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/** slug → workspace id (cacheado por request; barato). */
const resolveWorkspaceIdBySlug = cache(async (slug: string): Promise<string | null> => {
  const { data, error } = await sb().from('workspaces').select('id').eq('slug', slug).maybeSingle()
  if (error) { console.error('[workspace-context] resolve slug falhou:', error.message); return null }
  return (data?.id as string | undefined) ?? null
})

/** Lê o id do workspace default (DEMO). Lança se não existir (config inválida). */
async function defaultWorkspaceId(): Promise<string> {
  const id = await resolveWorkspaceIdBySlug(DEFAULT_SLUG)
  if (!id) throw new Error(`[workspace-context] workspace default '${DEFAULT_SLUG}' não encontrado`)
  return id
}

/**
 * É o workspace default (DEMO)? Usado pela factory de integrações pra restringir o
 * fallback de ENV ao tenant legado — senão um projeto novo sem credencial herdaria
 * os dados da DEMO (vazamento cross-tenant). Conservador: erro ao resolver → false.
 */
export async function isDefaultWorkspace(workspaceId: string): Promise<boolean> {
  try {
    return workspaceId === (await defaultWorkspaceId())
  } catch {
    return false
  }
}

/** Sessão da request + seus workspaces. null se deslogado/cron/build/teste. */
async function currentSession(): Promise<{ email: string; role: import('./auth').Role; workspaceIds: string[] } | null> {
  try {
    const { cookies } = await import('next/headers')
    const sid = (await cookies()).get(SESSION_COOKIE)?.value
    if (!sid) return null
    const { lookupSession, fetchWorkspaceIds } = await import('./sessions')
    const s = await lookupSession(sid)
    if (!s) return null
    // workspace_ids computado AQUI (Server Component), não no lookupSession — pra
    // não onerar o proxy Edge que não usa essa informação.
    const workspaceIds = await fetchWorkspaceIds(s.email, s.role)
    return { email: s.email, role: s.role, workspaceIds }
  } catch {
    return null
  }
}

async function activeWsCookie(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers')
    return (await cookies()).get(ACTIVE_WS_COOKIE)?.value ?? null
  } catch {
    return null
  }
}

export interface WorkspaceContext {
  activeId: string
  workspaceIds: string[]   // todos os projetos que a sessão pode acessar
  isLoggedIn: boolean
}

/**
 * Contexto de workspace da request. Resolve:
 *  - workspaceIds = os projetos da sessão (admin: todos; viewer: membership);
 *  - activeId = cookie `active_ws` SE estiver em workspaceIds; senão o default
 *    (DEMO) se acessível; senão o 1º acessível; senão (deslogado/cron) o DEMO fixo.
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  const session = await currentSession()
  const workspaceIds = session?.workspaceIds ?? []
  const cookieWs = await activeWsCookie()

  if (workspaceIds.length === 0) {
    // Logado SEM membership → fail-CLOSED (id impossível → dashboard vazio, sem
    // vazar projeto algum). Deslogado / cron / build → DEMO fixo (legado).
    if (session) return { activeId: NIL_WORKSPACE, workspaceIds: [], isLoggedIn: true }
    return { activeId: await defaultWorkspaceId(), workspaceIds: [], isLoggedIn: false }
  }

  // Cookie válido (na membership) vence.
  if (cookieWs && workspaceIds.includes(cookieWs)) {
    return { activeId: cookieWs, workspaceIds, isLoggedIn: true }
  }

  // Default: preferir DEMO se acessível (admin loga e vê DEMO como antes), senão o 1º.
  const lstId = await resolveWorkspaceIdBySlug(DEFAULT_SLUG)
  const activeId = (lstId && workspaceIds.includes(lstId)) ? lstId : workspaceIds[0]
  return { activeId, workspaceIds, isLoggedIn: true }
})

/** Atalho: só o id do projeto ativo (o que os fetchers usam). */
export const getActiveWorkspaceId = cache(async (): Promise<string> => (await getWorkspaceContext()).activeId)

export interface SwitcherWorkspace {
  id: string
  slug: string
  nome: string
  logo_url: string | null
}

// Busca id/slug/nome/logo_url dos ids; se a coluna logo_url ainda não existe
// (migration pendente), refaz sem ela (logo_url=null) — o sidebar nunca quebra.
async function selectWorkspaces(ids: string[]): Promise<SwitcherWorkspace[]> {
  const client = sb()
  // arquivado_at is null → projeto arquivado nunca aparece no switcher (soft-delete).
  let res: { data: unknown; error: unknown } = await client.from('workspaces').select('id, slug, nome, logo_url').in('id', ids).is('arquivado_at', null).order('nome')
  if (res.error) {
    res = await client.from('workspaces').select('id, slug, nome').in('id', ids).is('arquivado_at', null).order('nome')
  }
  const rows = (res.data as Array<Record<string, unknown>> | null) ?? []
  return rows.map((r) => ({ id: r.id as string, slug: r.slug as string, nome: r.nome as string, logo_url: (r.logo_url as string | null) ?? null }))
}

/** Projeto ativo + lista acessível (admin: todos; viewer: a membership) pro switcher. */
export const getSwitcherWorkspaces = cache(async (): Promise<{ active: SwitcherWorkspace | null; list: SwitcherWorkspace[] }> => {
  const { activeId, workspaceIds } = await getWorkspaceContext()
  // deslogado / sem membership → mostra só o ativo (DEMO), sem dropdown.
  const soloMode = workspaceIds.length === 0
  const list = await selectWorkspaces(soloMode ? [activeId] : workspaceIds)
  const active = list.find((w) => w.id === activeId) ?? list[0] ?? null
  return { active, list: soloMode ? (active ? [active] : []) : list }
})
