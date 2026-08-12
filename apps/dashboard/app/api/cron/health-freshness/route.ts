/**
 * GET /api/cron/health-freshness — dead-man's-switch de frescor dos syncs.
 *
 * Checa se os syncs que alimentam os NÚMEROS principais gravaram dado recente.
 * O risco que motiva isso: sync-vturb grava tudo-ou-nada; se um dia for cortado
 * (>60s sem Fluid Compute), o dia fica ZERO silencioso — e hoje ninguém percebe.
 * Aqui isso vira um 503, que qualquer monitor (UptimeRobot com header Bearer, ou
 * um cron na VPS → Telegram) transforma em ALERTA.
 *
 * Resposta:
 *   200 { ok: true, checks }         — tudo fresco
 *   503 { ok: false, stale, checks } — algum sync velho (ou erro ao verificar)
 *
 * Auth: só Authorization: Bearer CRON_SECRET (ou x-vercel-cron). Sob /api/cron/.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendAlert } from '@/lib/alert'
import { sendPush } from '@/lib/push'

export const dynamic = 'force-dynamic'

// SLA por fonte. vTurb/orgânico rodam ~diariamente (09:00) → 30h tolera a cadência
// + folga; se passar disso, um run foi perdido. Meta roda de 30 em 30min (pg_cron
// days=2) → a última `data` coberta deve ser hoje; >1 dia atrás = atrasado.
const VTURB_SLA_H = 30
const ORGANIC_SLA_H = 30
const META_MAX_LAG_DAYS = 1

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

function authOk(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  if (!s) return false
  return req.headers.get('authorization') === `Bearer ${s}`
}

/** Data de hoje no fuso BR, YYYY-MM-DD (comparável como string ISO). */
function brToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / 3_600_000
}

interface Check {
  fonte: string
  fresco: boolean
  detalhe: string
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = supa()
  const [vturbRes, organicRes, metaRes] = await Promise.all([
    sb.from('vturb_creative_daily').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('organic_posts').select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('meta_ads').select('data').order('data', { ascending: false }).limit(1).maybeSingle(),
  ])

  const checks: Check[] = []

  // vTurb — frescor por synced_at (última gravação). Erro/vazio = trata como velho.
  {
    const err = vturbRes.error
    const last = (vturbRes.data as { synced_at?: string } | null)?.synced_at ?? null
    const h = hoursSince(last)
    const fresco = !err && h !== null && h <= VTURB_SLA_H
    checks.push({
      fonte: 'vturb_creative_daily',
      fresco,
      detalhe: err ? `erro: ${err.message}` : h === null ? 'sem dado' : `synced há ${h.toFixed(1)}h (sla ${VTURB_SLA_H}h)`,
    })
  }

  // Orgânico — frescor por updated_at.
  {
    const err = organicRes.error
    const last = (organicRes.data as { updated_at?: string } | null)?.updated_at ?? null
    const h = hoursSince(last)
    const fresco = !err && h !== null && h <= ORGANIC_SLA_H
    checks.push({
      fonte: 'organic_posts',
      fresco,
      detalhe: err ? `erro: ${err.message}` : h === null ? 'sem dado' : `updated há ${h.toFixed(1)}h (sla ${ORGANIC_SLA_H}h)`,
    })
  }

  // Meta — a última `data` coberta deve ser >= ontem (BR).
  {
    const err = metaRes.error
    const last = (metaRes.data as { data?: string } | null)?.data ?? null
    const hoje = brToday()
    const limite = new Date(new Date(hoje).getTime() - META_MAX_LAG_DAYS * 86_400_000)
      .toISOString().slice(0, 10)
    const fresco = !err && last !== null && last >= limite
    checks.push({
      fonte: 'meta_ads',
      fresco,
      detalhe: err ? `erro: ${err.message}` : last === null ? 'sem dado' : `última data ${last} (limite ${limite})`,
    })
  }

  const stale = checks.filter((c) => !c.fresco).map((c) => c.fonte)
  const ok = stale.length === 0

  // Auto-alerta (inerte sem ALERT_WEBHOOK_URL): não depende mais de um monitor
  // externo. meta_ads velho ~sempre = token do Meta vencido (OAuthException 190).
  if (!ok) {
    const linhas = checks.filter((c) => !c.fresco).map((c) => `• ${c.fonte}: ${c.detalhe}`)
    const metaStale = checks.some((c) => c.fonte === 'meta_ads' && !c.fresco)
    const dica = metaStale
      ? '\n\n⚠️ meta_ads velho geralmente = token do Meta expirado (OAuthException code 190). Renove o token do Meta.'
      : ''
    await sendAlert(`🚨 Dashboard DEMO — sync congelado\n${linhas.join('\n')}${dica}`)
    // + push (canal separado do Telegram; ambos best-effort). F6: UM push consolidado
    // (stale.join) — nunca 1 por fonte — e cai na Saúde de Tráfego, não na home.
    await sendPush(
      { title: '🚨 Sync congelado', body: `${stale.join(', ')} sem atualizar.${metaStale ? ' Token do Meta pode ter vencido.' : ''}`, url: '/saude-trafego', tag: 'sync-congelado' },
    ).catch(() => {})
  }

  return NextResponse.json({ ok, stale, checks, verificadoEm: new Date().toISOString() }, { status: ok ? 200 : 503 })
}
