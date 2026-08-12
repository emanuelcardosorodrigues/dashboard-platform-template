/**
 * Backfill de profile_visits p/ feed/carrossel (Reels não suportam — erro #100).
 * Processa em lote os posts SEM profile_visits, do maior alcance pro menor (assim
 * os que têm dado vêm primeiro; os <5 views/sem-dado ficam no fim → o chamador
 * para quando um lote não atualiza nada). 1 call IG por post. Rodado em loop pela
 * VPS (batches pequenos + sleep) até encher, respeitando o rate limit (BUC).
 *
 * GET ?ws=<uuid|slug>&limit=10 → { batch, updated, throttled, remaining }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getInstagramOrganicConfig } from '@/lib/integrations/factory'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

const GRAPH = 'https://graph.facebook.com/v20.0'
const UUID = /^[0-9a-f-]{36}$/i
const THROTTLE_CODES = new Set([4, 17, 32, 613, 80004])

function authOk(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

async function fetchPv(mediaId: string, token: string): Promise<{ v: number | null; throttled: boolean }> {
  try {
    const r = await fetch(`${GRAPH}/${mediaId}/insights?metric=profile_visits&access_token=${encodeURIComponent(token)}`)
    const j = await r.json()
    if (j.error) return { v: null, throttled: THROTTLE_CODES.has(j.error.code) }
    const v = j.data?.[0]?.values?.[0]?.value
    return { v: typeof v === 'number' ? v : null, throttled: false }
  } catch {
    return { v: null, throttled: true }
  }
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = new URL(req.url)
  const ws = u.searchParams.get('ws') ?? ''
  const limit = Math.min(30, Math.max(1, Number(u.searchParams.get('limit') ?? 10)))
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  let workspaceId: string | null = UUID.test(ws) ? ws : null
  if (!workspaceId) {
    const { data } = await sb.from('workspaces').select('id').eq('slug', ws).maybeSingle()
    workspaceId = (data as { id?: string } | null)?.id ?? null
  }
  if (!workspaceId) return NextResponse.json({ error: `workspace '${ws}' não encontrado` }, { status: 404 })

  const cfg = await getInstagramOrganicConfig(workspaceId)
  if (!cfg) return NextResponse.json({ error: 'sem config/token de Instagram' }, { status: 400 })

  const remaining = async () => {
    const { count } = await sb.from('organic_posts').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('platform', 'instagram').in('format', ['feed', 'carousel']).is('profile_visits', null)
    return count ?? 0
  }

  const { data: posts } = await sb.from('organic_posts')
    .select('id, external_id, organic_accounts!inner(external_id)')
    .eq('workspace_id', workspaceId).eq('platform', 'instagram').in('format', ['feed', 'carousel']).is('profile_visits', null)
    .order('views', { ascending: false, nullsFirst: false }).limit(limit)

  type Row = { id: string; external_id: string; organic_accounts: { external_id: string } }
  const rows = (posts ?? []) as unknown as Row[]
  let updated = 0, throttled = 0
  for (const p of rows) {
    const token = cfg.tokens[p.organic_accounts.external_id] ?? cfg.tokens['*']
    if (!token) continue
    const { v, throttled: t } = await fetchPv(p.external_id, token)
    if (t) { throttled++; continue }
    if (v != null) { await sb.from('organic_posts').update({ profile_visits: v }).eq('id', p.id); updated++ }
  }
  return NextResponse.json({ ws, batch: rows.length, updated, throttled, remaining: await remaining() })
}
