/**
 * Cron job: gera análise IA do dia anterior via Gemini → Supabase ai_insights
 * Roda todo dia às 10:00 UTC (07:00 Brasília), depois de sync-meta (09h) e sync-clarity (09:30).
 *
 * Env vars necessárias:
 *   GEMINI_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CRON_SECRET (opcional)
 *   GEMINI_MODEL (opcional, default gemini-2.5-flash)
 */

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { brazilDateStr } from '@/lib/brazilDate'
import { runInsightGeneration } from '@/lib/insightsRunner'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const data = brazilDateStr(1)

  // Dispatcher por projeto: DEMO (default) ∪ workspaces com credencial Meta própria.
  // Cada projeto gera o insight com SEU dado (insightsRunner já filtra por workspace_id).
  const defaultWs = await getActiveWorkspaceId()
  const credWs = await listWorkspacesWithProvider('meta')
  const workspaceIds = [...new Set([defaultWs, ...credWs])]

  const results: Record<string, unknown> = {}
  for (const wsId of workspaceIds) {
    try {
      const r = await runInsightGeneration(data, data, 'cron', wsId)
      results[wsId] = r.ok ? { ok: true, tokens: { in: r.tokens_input, out: r.tokens_output } } : { ok: false, error: r.error }
    } catch (err) {
      results[wsId] = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  revalidateTag('sb-ai-insights', 'max')

  // Não devolve ok:true cego: se TODOS os workspaces falharam, status 500 pro monitor
  // enxergar; se só alguns falharam, 200 com degraded:true (não re-tenta os que deram
  // certo — geração custa tokens). Triage Fase 6 (falha silenciosa).
  const vals = Object.values(results) as Array<{ ok?: boolean }>
  const allFail = vals.length > 0 && vals.every((v) => v?.ok === false)
  const anyFail = vals.some((v) => v?.ok === false)
  return NextResponse.json(
    { ok: !allFail, degraded: anyFail && !allFail, date: data, workspaces: results },
    { status: allFail ? 500 : 200 },
  )
}
