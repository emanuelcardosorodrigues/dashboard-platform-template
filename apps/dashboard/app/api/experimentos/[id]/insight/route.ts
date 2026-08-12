/**
 * POST /api/experimentos/[id]/insight — Fase 7 do plano.
 *
 * Coleta contexto multi-source do experimento e gera insight via Gemini.
 * Persiste em ai_insights com periodo='experiment'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { experimentHealthPrompt, type ExperimentHealthContext } from '@/lib/prompts/experiment-health'
import { zTest } from '@/lib/stats'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Auth: ou x-admin-password (UI) ou Authorization Bearer CRON_SECRET (cron/admin)
  const adminPwd = process.env.ADMIN_ACTION_PASSWORD
  const adminHeader = req.headers.get('x-admin-password')
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')

  const authorizedByPwd = adminPwd && adminHeader === adminPwd
  const authorizedByCron = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!authorizedByPwd && !authorizedByCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // 1. Experimento
  const { data: exp, error: expErr } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', id)
    .single()

  if (expErr || !exp) {
    return NextResponse.json({ error: 'Experimento não encontrado' }, { status: 404 })
  }
  // Tenant do experimento — usado p/ escopar bot_uids/transacoes/insight.
  // Derivado do próprio exp (cron-safe: não depende de sessão).
  const workspaceId = exp.workspace_id as string

  // 2. Health view (se aplicada)
  const { data: health } = await supabase
    .from('experiment_health')
    .select('pct_bots, clarity_rage_pct, uids_24h')
    .eq('id', id)
    .maybeSingle()

  // 3. Impressões filtradas (bots confirmados fora) + conversões por variante (7d)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const variants = (exp.variants as Array<{ slug: string }>) ?? []

  // Pull bot UIDs confirmados — insight reflete o que o filtro entrega à UI.
  let botUidSet = new Set<string>()
  const botRes = await supabase.from('bot_uids').select('uid').eq('workspace_id', workspaceId).eq('status', 'confirmed')
  if (botRes.error && /column .* does not exist/i.test(botRes.error.message)) {
    const fb = await supabase.from('bot_uids').select('uid').eq('workspace_id', workspaceId)
    botUidSet = new Set((fb.data ?? []).map((r: { uid: string }) => r.uid))
  } else if (!botRes.error) {
    botUidSet = new Set((botRes.data ?? []).map((r: { uid: string }) => r.uid))
  }

  const stats: ExperimentHealthContext['stats'] = []
  let baselineCR = 0

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]
    const { data: impRows } = await supabase
      .from('impressions')
      .select('uid')
      .eq('experiment_id', id)
      .eq('variant', v.slug)
      .gte('timestamp', sevenDaysAgo)

    const imp = (impRows ?? []).reduce(
      (n, r: { uid: string }) => (botUidSet.has(r.uid) ? n : n + 1),
      0
    )

    const { count: conv } = await supabase
      .from('transacoes')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .like('sck_slug', `%${v.slug}%`)
      .gte('created_at', sevenDaysAgo)

    const cr = imp > 0 ? (conv ?? 0) / imp : 0
    if (i === 0) baselineCR = cr

    stats.push({ variant: v.slug, imp, conv: conv ?? 0, cr })
  }

  // 4. Bayes pra todas vs controle (variante 0)
  const baseline = stats[0]
  if (baseline) {
    for (let i = 1; i < stats.length; i++) {
      const z = zTest({
        n1: baseline.imp,
        c1: baseline.conv,
        n2: stats[i].imp,
        c2: stats[i].conv,
      })
      stats[i].bayes_prob_wins = z.bayesProb
    }
  }

  // 5. Sample-size gate
  const zSample = zTest({
    n1: baseline?.imp ?? 0,
    c1: baseline?.conv ?? 0,
    n2: stats[1]?.imp ?? 0,
    c2: stats[1]?.conv ?? 0,
    mde: 0.1,
  })

  const context: ExperimentHealthContext = {
    experiment: {
      name: exp.name,
      type: exp.type,
      entry_path: exp.entry_path,
      variants: exp.variants,
      started_at: exp.started_at ?? exp.created_at,
      auto_optimize: exp.auto_optimize,
      champion_variant: exp.champion_variant,
    },
    health: {
      pct_bots: health?.pct_bots ?? 0,
      clarity_rage_pct: health?.clarity_rage_pct ?? null,
      uids_24h: health?.uids_24h ?? 0,
    },
    stats,
    meetsMinSample: zSample.meetsMinSample,
    minSampleNeeded: zSample.minSampleNeeded,
  }

  const prompt = experimentHealthPrompt(context)

  // 6. Chama Gemini
  let insight = ''
  try {
    const { generateText } = await import('@/lib/gemini')
    insight = await generateText(prompt)
  } catch (e) {
    return NextResponse.json({ error: 'Gemini falhou: ' + (e as Error).message, context }, { status: 500 })
  }

  // 7. Persistir em ai_insights
  await supabase.from('ai_insights').insert({
    workspace_id: workspaceId,
    periodo: 'experiment',
    conteudo: insight,
    contexto: { experiment_id: id, ...context },
  })

  return NextResponse.json({ insight, context })
}
