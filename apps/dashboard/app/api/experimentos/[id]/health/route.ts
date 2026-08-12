/**
 * GET /api/experimentos/[id]/health — leitura barata para o HealthCard da UI.
 *
 * Devolve a linha de experiment_health (pct_bots, clarity_rage_pct, uids_24h)
 * + o insight mais recente em ai_insights (periodo='experiment',
 * contexto->>experiment_id = id). Não chama Gemini — geração fica em POST
 * /api/experimentos/[id]/insight.
 *
 * Auth: aberto pra qualquer sessão admin (proxy.ts gateia /api/admin/* mas
 * /api/experimentos/* é leitura — segue padrão do GET /api/experimentos).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Health view (graceful fallback se migration 0004 não aplicada)
  let health: { pct_bots: number; clarity_rage_pct: number | null; uids_24h: number } | null = null
  const healthRes = await supabase
    .from('experiment_health')
    .select('pct_bots, clarity_rage_pct, uids_24h')
    .eq('id', id)
    .maybeSingle()
  if (!healthRes.error && healthRes.data) {
    health = {
      pct_bots: Number(healthRes.data.pct_bots) || 0,
      clarity_rage_pct: healthRes.data.clarity_rage_pct === null ? null : Number(healthRes.data.clarity_rage_pct),
      uids_24h: Number(healthRes.data.uids_24h) || 0,
    }
  }

  // Latest insight para esse experimento (escopado ao projeto ativo p/ o limit(20)
  // não ser dominado por insights de outros tenants)
  let latestInsight: { conteudo: string; gerado_at: string } | null = null
  const workspaceId = await getActiveWorkspaceId()
  const insightRes = await supabase
    .from('ai_insights')
    .select('conteudo, gerado_at, contexto')
    .eq('workspace_id', workspaceId)
    .eq('periodo', 'experiment')
    .order('gerado_at', { ascending: false })
    .limit(20)
  if (!insightRes.error && insightRes.data) {
    const hit = insightRes.data.find((r) => {
      const ctx = r.contexto as { experiment_id?: string } | null
      return ctx?.experiment_id === id
    })
    if (hit) latestInsight = { conteudo: hit.conteudo as string, gerado_at: hit.gerado_at as string }
  }

  return NextResponse.json({ health, latestInsight })
}
