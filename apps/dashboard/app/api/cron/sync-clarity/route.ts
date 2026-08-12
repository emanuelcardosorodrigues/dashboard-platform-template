/**
 * Cron job: sincroniza métricas do Microsoft Clarity → Supabase
 * Roda todo dia às 09:30 UTC (06:30 Brasília) via Vercel Cron
 *
 * Faz 4 chamadas à Clarity Data Export API (limite: 10 req/dia/projeto):
 *   - total agregado (sem dimensão)
 *   - por URL
 *   - por Device
 *   - por Source
 *
 * Env vars necessárias:
 *   CLARITY_API_TOKEN          — token gerado no Clarity > Settings > Data Export
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CRON_SECRET                — segredo para proteger o endpoint (opcional mas recomendado)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { fetchClarityMetrics, normalizeClarityRows, type ClarityQuery } from '@/lib/clarity'
import { getClarityConfig } from '@/lib/integrations/factory'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { brazilDateStr } from '@/lib/brazilDate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Recorte = 'total' | 'url' | 'device' | 'source'

const CUTS: Array<{ recorte: Recorte; query: ClarityQuery }> = [
  { recorte: 'total',  query: { numOfDays: 1 } },
  { recorte: 'url',    query: { numOfDays: 1, dimension1: 'URL' } },
  { recorte: 'device', query: { numOfDays: 1, dimension1: 'Device' } },
  { recorte: 'source', query: { numOfDays: 1, dimension1: 'Source' } },
]

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

  const data = brazilDateStr(1) // ontem
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Config do Clarity do projeto ativo (cron sem sessão → DEMO default; cred
  // cifrada do projeto OU env do DEMO). Sem config → pula gracioso.
  const wsId = await getActiveWorkspaceId()
  const cfg = await getClarityConfig(wsId)
  if (!cfg) {
    return NextResponse.json({ skipped: 'Clarity não configurado para o projeto', workspaceId: wsId })
  }

  const results: Record<string, unknown> = {}
  for (const c of CUTS) {
    try {
      const raw = await fetchClarityMetrics(c.query, cfg.apiToken)
      const rows = normalizeClarityRows(raw, { data, recorte: c.recorte, dimensao: c.recorte })
        .map((r) => ({ ...r, workspace_id: wsId }))

      if (rows.length === 0) {
        results[c.recorte] = { rows: 0, msg: 'Sem dados' }
        continue
      }

      const { error } = await supabase.from('clarity_daily').upsert(rows, {
        onConflict: 'workspace_id,data,recorte,dimensao_valor',
        ignoreDuplicates: false,
      })
      if (error) throw new Error(error.message)

      results[c.recorte] = { rows: rows.length }
      console.log(`[sync-clarity] ✅ ${c.recorte}: ${rows.length} linha(s)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[sync-clarity] ❌ ${c.recorte}:`, msg)
      results[c.recorte] = { erro: msg }
    }
  }

  revalidateTag('sb-clarity', 'max')
  return NextResponse.json({ date: data, recortes: results })
}
