/**
 * Endpoint manual: regenera análise IA para uma data ou período.
 * Auth: middleware do dashboard (cookie de sessão lst_session).
 * Rate limit: rejeita se já houve geração manual nos últimos 5 minutos.
 *
 * Body aceita {from?, to?} OU {data?} (compat com chamadas antigas).
 */

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { brazilDateStr } from '@/lib/brazilDate'
import { runInsightGeneration } from '@/lib/insightsRunner'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { badRequest, regenerateBodySchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const RATE_LIMIT_MS = 5 * 60 * 1000
const MAX_RANGE_DAYS = 30

function diffDays(from: string, to: string): number {
  const [yf, mf, df] = from.split('-').map(Number)
  const [yt, mt, dt] = to.split('-').map(Number)
  const a = Date.UTC(yf, mf - 1, df)
  const b = Date.UTC(yt, mt - 1, dt)
  return Math.round((b - a) / 86400000) + 1
}

export async function POST(req: Request) {
  // Body vazio é tolerado (= regenerar ontem). Schema valida formato YYYY-MM-DD
  // quando algum campo for enviado; refazemos o defaulting fora do schema pra
  // manter compat com chamadas legadas que enviam {} ou só {data}.
  let body: { data?: string; from?: string; to?: string } = {}
  try {
    const raw = await req.json()
    const parsed = regenerateBodySchema.safeParse(raw ?? {})
    if (!parsed.success) {
      const r = badRequest({
        ok: false,
        error: 'invalid',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.') || '(root)', message: i.message })),
      })
      return NextResponse.json(r.body, { status: r.status })
    }
    body = parsed.data
  } catch {
    body = {}
  }

  // Compat: {data} legado vira from=to=data.
  const from = body.from ?? body.data ?? brazilDateStr(1)
  const to = body.to ?? body.data ?? brazilDateStr(1)

  if (to < from) {
    return NextResponse.json({ error: '"to" deve ser >= "from"' }, { status: 400 })
  }
  const dias = diffDays(from, to)
  if (dias > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Período máximo é ${MAX_RANGE_DAYS} dias (recebido: ${dias}).` },
      { status: 400 },
    )
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const workspaceId = await getActiveWorkspaceId()

  const { data: last, error: rlError } = await supabase
    .from('ai_insights')
    .select('gerado_at')
    .eq('workspace_id', workspaceId)
    .eq('gerado_por', 'manual')
    .order('gerado_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (rlError) {
    return NextResponse.json({ error: rlError.message }, { status: 500 })
  }

  if (last?.gerado_at) {
    const elapsed = Date.now() - new Date(last.gerado_at).getTime()
    if (elapsed < RATE_LIMIT_MS) {
      const waitSec = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000)
      return NextResponse.json(
        { error: `Aguarde ${waitSec}s antes de regenerar novamente.` },
        { status: 429 },
      )
    }
  }

  const r = await runInsightGeneration(from, to, 'manual', workspaceId)

  if (!r.ok) {
    return NextResponse.json({ error: r.error ?? 'falha' }, { status: 500 })
  }

  revalidateTag('sb-ai-insights', 'max')

  return NextResponse.json({
    ok: true,
    from,
    to,
    tokens: { in: r.tokens_input, out: r.tokens_output },
  })
}
