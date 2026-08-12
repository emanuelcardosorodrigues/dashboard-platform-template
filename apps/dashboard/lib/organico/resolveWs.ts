/**
 * Resolve o parâmetro ?ws= dos crons do Orgânico aceitando UUID **ou slug**
 * (demo/lrm/thm). Sem param → workspace default da sessão/cron.
 *
 * Bug que isto corrige: os endpoints aceitavam só UUID; o orquestrador da VPS
 * passava o SLUG → caíam no default (DEMO) e lrm/thm nunca eram processados.
 */
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

const UUID_RE = /^[0-9a-f-]{36}$/i

export async function resolveWsParam(wsParam: string | null | undefined): Promise<string> {
  if (wsParam && UUID_RE.test(wsParam)) return wsParam
  if (wsParam) {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    const { data } = await sb.from('workspaces').select('id').eq('slug', wsParam).maybeSingle()
    const id = (data as { id?: string } | null)?.id
    if (id) return id
  }
  return getActiveWorkspaceId()
}
