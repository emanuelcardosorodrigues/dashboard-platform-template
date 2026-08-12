/**
 * Cron diário de retenção. Roda às 03:00 BRT (06:00 UTC).
 *
 * Política (Fase 1.11):
 * - audit_log: delete > 180 dias.
 * - login_attempts: delete sessões antigas (> 24h e não bloqueadas).
 * - bot_fingerprints: delete > 30 dias (LGPD — IP retido só pelo necessário).
 * - ai_insights: scrubar metricas_contexto de linhas > 90 dias (mantém tldr/alertas/oportunidades/recomendacoes; só zera payload bruto).
 *
 * Auth: CRON_SECRET obrigatório (bypass via x-vercel-cron).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { log } from '@/lib/log'
import { audit } from '@/lib/audit'

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

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const now = Date.now()
  const auditCutoff = new Date(now - 180 * 86400_000).toISOString()
  const loginAttemptsCutoff = new Date(now - 24 * 3600_000).toISOString()
  const botsCutoff = new Date(now - 30 * 86400_000).toISOString()
  const aiCutoff = new Date(now - 90 * 86400_000).toISOString().slice(0, 10) // ai_insights.data é date

  const out: Record<string, unknown> = {}

  // audit_log: delete > 180d
  try {
    const { count } = await sb
      .from('audit_log')
      .delete({ count: 'exact' })
      .lt('occurred_at', auditCutoff) as { count: number | null }
    out.audit_log_deleted = count ?? 0
  } catch (err) {
    out.audit_log_error = err instanceof Error ? err.message : 'unknown'
  }

  // login_attempts: delete > 24h e sem lock ativo
  try {
    const { count } = await sb
      .from('login_attempts')
      .delete({ count: 'exact' })
      .lt('last_attempt', loginAttemptsCutoff)
      .is('locked_until', null) as { count: number | null }
    out.login_attempts_deleted = count ?? 0
  } catch (err) {
    out.login_attempts_error = err instanceof Error ? err.message : 'unknown'
  }

  // bot_fingerprints: delete > 30d (tabela pode não existir em alguns ambientes)
  try {
    const { count, error } = await sb
      .from('bot_fingerprints')
      .delete({ count: 'exact' })
      .lt('created_at', botsCutoff) as { count: number | null; error: { message: string } | null }
    if (error) out.bot_fingerprints_error = error.message
    else out.bot_fingerprints_deleted = count ?? 0
  } catch (err) {
    out.bot_fingerprints_error = err instanceof Error ? err.message : 'unknown'
  }

  // ai_insights: scrubar metricas_contexto > 90d (preserva resumo)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (sb.from('ai_insights') as any)
      .update({ metricas_contexto: null }, { count: 'exact' })
      .lt('data', aiCutoff)
      .not('metricas_contexto', 'is', null) as { count: number | null; error: { message: string } | null }
    if (error) out.ai_insights_error = error.message
    else out.ai_insights_scrubbed = count ?? 0
  } catch (err) {
    out.ai_insights_error = err instanceof Error ? err.message : 'unknown'
  }

  // Se qualquer sub-etapa falhou (chave *_error), NÃO devolve ok:true com 200 —
  // senão um monitor por status code não enxerga o pipeline morto (triage Fase 6).
  const hadError = Object.keys(out).some((k) => k.endsWith('_error'))
  if (hadError) log.error('[cron/data-retention] falha parcial', out)
  else log.info('[cron/data-retention] ok', out)
  await audit({
    action: 'cron.data_retention',
    resource: '/api/cron/data-retention',
    metadata: out,
  })

  return NextResponse.json({ ok: !hadError, ...out }, { status: hadError ? 500 : 200 })
}
