/**
 * GET /api/cron/push-resumo — resumo diário via push (faturamento/gasto/lucro do dia).
 * Auth: x-vercel-cron ou Bearer CRON_SECRET. Agendado 0 0 * * * (UTC) = 21h BRT.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { computePeriodSummary } from '@/lib/periodSummary'
import { brazilDateStr } from '@/lib/brazilDate'
import { sendPush } from '@/lib/push'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authed(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

const brl = (v: number) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const hoje = brazilDateStr(0)
  const s = await computePeriodSummary(hoje, hoje, 'all', 'all')
  const sent = await sendPush({
    title: '📊 Resumo de hoje',
    // F6: cai na Visão Geral (KPIs do dia) em vez da home genérica. Push único por
    // dia (tag resumo-<hoje>) — sem rajada.
    body: `Faturamento ${brl(s.faturamento)} · Gasto ${brl(s.investimento)} · Lucro ${brl(s.lucro)}`,
    url: '/visao-geral',
    tag: `resumo-${hoje}`,
  })
  return NextResponse.json({ ok: true, sent, hoje })
}
