/**
 * GET /api/criativos/analise?limit=&status=ok|failed|running|all&account_id=
 *   → lista análises do workspace ordenadas por one_belief_score desc / gerado_at desc
 *
 * Workspace é resolvido por account_id (multi-tenant) se passado; senão
 * usa DEFAULT_WORKSPACE_SLUG (single-tenant legacy).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceBySlug, resolveWorkspaceByAccountId } from '@/lib/criativo-pipeline'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '100'), 500)
  const status = req.nextUrl.searchParams.get('status') ?? 'all'
  const accountId = req.nextUrl.searchParams.get('account_id')

  try {
    const client = supa()
    const { id: workspaceId } = accountId
      ? await resolveWorkspaceByAccountId(client, accountId)
      : await resolveWorkspaceBySlug(client)

    let q = client
      .from('criativo_analise')
      .select(
        'ad_id, ad_name, status, one_belief_score, one_belief_desvio, hook_tipo, hook_descricao, angulo_copy, formato_visual, elementos_visuais, cta, producao, resumo, transcricao, modelo, prompt_version, gerado_at, thumbnail_url, video_url, instagram_permalink_url'
      )
      .eq('workspace_id', workspaceId)
      .order('one_belief_score', { ascending: false, nullsFirst: false })
      .order('gerado_at', { ascending: false })
      .limit(limit)

    if (status !== 'all') q = q.eq('status', status)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ workspaceId, total: data?.length ?? 0, rows: data ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('analise GET list failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
