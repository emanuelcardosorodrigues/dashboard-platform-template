/**
 * GET /api/cron/connect-rate-health — reconcilia os dois streams do connect rate
 * (route_clicks × impressions) por experimento de página ATIVO, num dia fechado (ontem).
 *
 * Pega quebra silenciosa que o número sozinho esconde:
 *   - o 302 parou de gravar route_clicks (roteamento/insert quebrado) → views sem cliques
 *   - o beacon da página parou (página nova sem a tag, ou página que não carrega) →
 *     muitos roteados, quase ninguém chega.
 * A lógica de decisão é pura e testada em lib/connectRateHealth.ts.
 *
 * Blindagem de aquecimento: route_clicks só existe desde o deploy do Worker (10/07/2026).
 * Avaliar um dia ANTERIOR a isso daria falso-positivo (views sem cliques por design).
 * Então, se ontem < primeiro dia com route_clicks, responde 200 "aquecendo" — sem alarme.
 *
 * Resposta:
 *   200 { ok: true, ... }             — reconciliado (ou ainda aquecendo)
 *   503 { ok: false, issues, rows }   — algum stream caiu (ou erro ao verificar)
 *
 * Auth: Authorization: Bearer CRON_SECRET (ou x-vercel-cron). Sob /api/cron/.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reconcileConnectStreams, type StreamRow } from '@/lib/connectRateHealth'
import { CONNECT_RATE_MIN_CLICKS } from '@/lib/experimentPassthrough'

export const dynamic = 'force-dynamic'

const FLOOR_PCT = 50   // connect rate abaixo disto, com amostra, é suspeito
const VIEWS_FLOOR = 5  // ignora trickle: só acusa "roteamento parado" acima disto

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

/** YYYY-MM-DD (fuso BR) de N dias atrás. */
function brDayAgo(n: number): string {
  const ms = Date.now() - n * 86_400_000
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = supa()
  const ontem = brDayAgo(1)

  try {
    // Blindagem de aquecimento: menor `dia` com route_clicks. Se ontem for antes disso,
    // não dá pra reconciliar (o stream de cliques nem existia) → não alarma.
    const { data: firstRc, error: firstErr } = await sb
      .from('route_clicks').select('dia').order('dia', { ascending: true }).limit(1).maybeSingle()
    if (firstErr) throw new Error(`route_clicks: ${firstErr.message}`)
    const primeiroDiaRc = (firstRc as { dia?: string } | null)?.dia ?? null
    if (!primeiroDiaRc || ontem < primeiroDiaRc) {
      return NextResponse.json(
        { ok: true, aquecendo: true, ontem, primeiroDiaRc, nota: 'route_clicks ainda não cobre ontem — sem reconciliação' },
        { status: 200 },
      )
    }

    // Experimentos de página ativos.
    const { data: exps, error: expErr } = await sb
      .from('experiments').select('id, name').eq('type', 'page').eq('status', 'active')
    if (expErr) throw new Error(`experiments: ${expErr.message}`)
    const active = (exps ?? []) as { id: string; name: string }[]
    if (active.length === 0) {
      return NextResponse.json({ ok: true, ontem, rows: [], nota: 'nenhum experimento de página ativo' }, { status: 200 })
    }
    const ids = active.map((e) => e.id)

    // Cliques roteados (ontem) e views do beacon (ontem), por experimento — uids distintos.
    const [rcRes, impRes] = await Promise.all([
      sb.from('route_clicks').select('experiment_id, uid').eq('dia', ontem).in('experiment_id', ids),
      sb.from('impressions').select('experiment_id, uid, timestamp')
        .gte('timestamp', `${ontem}T00:00:00-03:00`).lt('timestamp', `${brDayAgo(0)}T00:00:00-03:00`)
        .in('experiment_id', ids),
    ])
    if (rcRes.error) throw new Error(`route_clicks janela: ${rcRes.error.message}`)
    if (impRes.error) throw new Error(`impressions janela: ${impRes.error.message}`)

    // uids por experimento em cada stream.
    const routedByExp = new Map<string, Set<string>>()
    for (const r of (rcRes.data ?? []) as { experiment_id: string; uid: string }[]) {
      if (!routedByExp.has(r.experiment_id)) routedByExp.set(r.experiment_id, new Set())
      routedByExp.get(r.experiment_id)!.add(r.uid)
    }
    const viewedByExp = new Map<string, Set<string>>()
    for (const r of (impRes.data ?? []) as { experiment_id: string; uid: string }[]) {
      if (!viewedByExp.has(r.experiment_id)) viewedByExp.set(r.experiment_id, new Set())
      viewedByExp.get(r.experiment_id)!.add(r.uid)
    }

    const rows: StreamRow[] = active.map((e) => {
      const routed = routedByExp.get(e.id) ?? new Set<string>()
      const viewed = viewedByExp.get(e.id) ?? new Set<string>()
      let landed = 0
      for (const uid of routed) if (viewed.has(uid)) landed++
      return { experimentId: e.id, name: e.name, routed: routed.size, landed, views: viewed.size }
    })

    const issues = reconcileConnectStreams(rows, {
      minSample: CONNECT_RATE_MIN_CLICKS, floorPct: FLOOR_PCT, viewsFloor: VIEWS_FLOOR,
    })
    const ok = issues.length === 0
    return NextResponse.json(
      { ok, ontem, issues, rows, verificadoEm: new Date().toISOString() },
      { status: ok ? 200 : 503 },
    )
  } catch (e) {
    // Fail-safe: erro ao verificar = 503 (melhor um alarme falso que um silêncio real).
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : String(e), verificadoEm: new Date().toISOString() },
      { status: 503 },
    )
  }
}
