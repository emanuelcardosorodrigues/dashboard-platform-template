/**
 * Autenticação de rotas /api — fonte ÚNICA da checagem sessão + membership.
 *
 * resolveWorkspaceFromRequest confia no ?account_id da URL (IDOR): qualquer um
 * que saiba um account_id de outro tenant leria/escreveria naquele workspace.
 * requireAuth fecha isso validando o workspace resolvido contra a membership do
 * usuário logado (fetchWorkspaceIds, memoizado → barato).
 *
 * Uso:
 *   const auth = await requireAuth(req, client)
 *   if ('error' in auth) return auth.error
 *   const { session, ws } = auth   // ws = { id, ctx }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession, fetchWorkspaceIds } from '@/lib/sessions'
import { resolveWorkspaceFromRequest } from '@/lib/criativo-pipeline'

export async function requireAuth(req: NextRequest, client: SupabaseClient) {
  const c = await cookies()
  const sid = c.get(SESSION_COOKIE)?.value
  const session = sid ? await lookupSession(sid) : null
  if (!session) return { error: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  const ws = await resolveWorkspaceFromRequest(client, req)
  const wsIds = await fetchWorkspaceIds(session.email, session.role)
  if (!wsIds.includes(ws.id)) {
    return { error: NextResponse.json({ error: 'Sem acesso a este workspace' }, { status: 403 }) }
  }
  return { session, ws }
}
