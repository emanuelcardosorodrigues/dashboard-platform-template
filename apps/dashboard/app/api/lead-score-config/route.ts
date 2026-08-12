/**
 * PUT /api/lead-score-config — salva (upsert) a config de Lead Scoring de um funil.
 * body: { funil, weights, tier_quente, tier_morno, alvo_coluna }
 * Config global por funil (sem workspace) — leitura é cacheada (tag sb-lead-score-config).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { log } from '@/lib/log'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
// #16 — defaults importados da fonte única (lib/leadScore) para não divergir
import { DEFAULT_TIER_QUENTE, DEFAULT_TIER_MORNO, DEFAULT_ALVO_COLUNA } from '@/lib/leadScore'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface ConfigBody {
  funil?: string
  weights?: Record<string, Record<string, number>>
  tier_quente?: number
  tier_morno?: number
  alvo_coluna?: string
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as ConfigBody
    const funil = (body.funil ?? 'all').trim() || 'all'
    const workspaceId = await getActiveWorkspaceId()
    const client = supa()
    const { data, error } = await client
      .from('lead_score_config')
      .upsert(
        {
          workspace_id: workspaceId,
          funil,
          weights: body.weights ?? {},
          tier_quente: body.tier_quente ?? DEFAULT_TIER_QUENTE,
          tier_morno: body.tier_morno ?? DEFAULT_TIER_MORNO,
          alvo_coluna: body.alvo_coluna ?? DEFAULT_ALVO_COLUNA,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,funil' },
      )
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    revalidateTag('sb-lead-score-config', { expire: 0 })
    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('lead-score-config PUT failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
