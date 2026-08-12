/**
 * Cron: vTurb por criativo (Fase 4 / Tier B).
 *
 * Para cada player vTurb, busca trafficStats segmentado por utm_id (= ad.id) e
 * utm_content (= ad_name), DIA A DIA, e faz upsert em vturb_creative_daily
 * (contagens absolutas; taxas re-derivadas na leitura). Idempotente (PK
 * player_id,day,match_key,match_kind). Default: ontem. `?days=N` backfilla.
 *
 * Env: VTURB_API_TOKEN, CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Requer a migration 0019 aplicada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { listPlayers, trafficStats, validUtms, userEngagementByTrafficOrigin, usersReachedSecond } from '@/lib/vturb'
import { brazilDateStr } from '@/lib/brazilDate'
import { getVturbConfig } from '@/lib/integrations/factory'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const QUERY_KEYS = ['utm_id', 'utm_content'] as const

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  const url = new URL(req.url)
  const daysParam = parseInt(url.searchParams.get('days') ?? '2', 10)
  const days = Number.isFinite(daysParam) ? Math.min(30, Math.max(1, daysParam)) : 2
  // Dias a sincronizar: de (days-1) atrás até ontem (não inclui hoje, que ainda muda).
  const dayList: string[] = []
  for (let n = days; n >= 1; n--) dayList.push(brazilDateStr(n))

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const rows: Record<string, unknown>[] = []
  let errors = 0
  const utmKeysFound = new Set<string>()
  const rangeStart = dayList[0]
  const rangeEnd = dayList[dayList.length - 1]

  // Dispatcher por projeto: DEMO default (cron → DEMO, cai no env) + workspaces com
  // cred 'vturb' própria. Pra DEMO-only = [DEMO] via env → idêntico.
  const defaultWs = await getActiveWorkspaceId()
  const credWs = await listWorkspacesWithProvider('vturb')
  const workspaceIds = [...new Set([defaultWs, ...credWs])]
  const perWs: Record<string, unknown> = {}

  for (const workspaceId of workspaceIds) {
   const cfg = await getVturbConfig(workspaceId)
   if (!cfg) { perWs[workspaceId] = { skipped: 'vTurb não configurado' }; continue }
   const apiToken = cfg.apiToken
   let players
   try {
     // Lista TODOS os players do projeto (recorte por dia é no trafficStats).
     players = await listPlayers({ apiToken })
   } catch (e) {
     perWs[workspaceId] = { error: `listPlayers: ${e instanceof Error ? e.message : String(e)}` }
     continue
   }
   perWs[workspaceId] = { players: players.length }

   for (const p of players) {
    // Descobre quais UTMs o player de fato tem na janela (igual /vsl). Cravar
    // utm_id/utm_content e consultar cego devolve vazio quando a conta não usa
    // aquela dimensão. Só consultamos as chaves-alvo que existem.
    let available: Record<string, number> = {}
    try {
      available = await validUtms({ playerId: p.id, startDate: rangeStart, endDate: rangeEnd, apiToken })
    } catch { errors++ }
    for (const k of Object.keys(available)) if ((available[k] ?? 0) > 0) utmKeysFound.add(k)

    const keysToQuery = QUERY_KEYS.filter((k) => (available[k] ?? 0) > 0)
    if (keysToQuery.length === 0) continue

    for (const day of dayList) {
      for (const queryKey of keysToQuery) {
        try {
          const stats = await trafficStats({
            playerId: p.id, startDate: day, endDate: day, queryKey,
            videoDuration: p.duration, pitchTime: p.pitch_time, apiToken,
          })
          // 1º minuto por criativo: retenção por tempo agrupada por utm (endpoint
          // dedicado — o /times/user_engagement comum ignora utm). usersReachedSecond(...,60)
          // = quantos alcançaram >= 60s. Falha → fica 0 (coluna mostra n/d).
          const firstMinByValue: Record<string, number> = {}
          try {
            const values = stats.map((s) => s.value).filter((v): v is string => Boolean(v))
            if (values.length > 0) {
              const eng = await userEngagementByTrafficOrigin({
                playerId: p.id, queryKey, values, startDate: day, endDate: day, videoDuration: p.duration, apiToken,
              })
              for (const g of eng) firstMinByValue[g.group_key] = usersReachedSecond(g.group_values, 60)
            }
          } catch { /* sem 1º minuto nesse dia */ }
          for (const s of stats) {
            if (!s.value) continue
            rows.push({
              workspace_id: workspaceId,
              player_id: p.id, day, match_key: s.value, match_kind: queryKey,
              total_viewed: Math.round(s.total_viewed || 0),
              total_started: Math.round(s.total_started || 0),
              total_finished: Math.round(s.total_finished || 0),
              total_clicked: Math.round(s.total_clicked || 0),
              total_conversions: Math.round(s.total_conversions || 0),
              // A API (/traffic_origin/stats) já devolve over/under pitch POR UTM —
              // antes gravávamos 0 fixo, descartando o dado. Captura pra destravar
              // as métricas de pitch (retenção até pitch, conv pitch, custo/pitch).
              total_over_pitch: Math.round(s.total_over_pitch || 0),
              total_under_pitch: Math.round(s.total_under_pitch || 0),
              total_first_minute: Math.round(firstMinByValue[s.value] || 0),
              synced_at: new Date().toISOString(),
            })
          }
        } catch { errors++ }
      }
    }
   }
  }

  // Defensivo: se a coluna total_first_minute ainda não existe (migration não
  // aplicada), tira ela do payload pra não quebrar o upsert. O resto sincroniza igual.
  let hasFirstMin = true
  try {
    const probe = await supabase.from('vturb_creative_daily').select('total_first_minute').limit(1)
    if (probe.error) hasFirstMin = false
  } catch { hasFirstMin = false }
  if (!hasFirstMin) for (const r of rows) delete (r as Record<string, unknown>).total_first_minute

  let inseridos = 0
  if (rows.length > 0) {
    // Upsert em lotes (idempotente pela PK composta).
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500)
      const { error } = await supabase
        .from('vturb_creative_daily')
        .upsert(batch, { onConflict: 'player_id,day,match_key,match_kind', ignoreDuplicates: false })
      if (error) return NextResponse.json({ error: error.message, hint: 'aplicou a migration 0019?' }, { status: 500 })
      inseridos += batch.length
    }
    revalidateTag('sb-vturb', { expire: 0 })
  }

  // Pipeline morto (erros e nada inserido) → status 500 pro monitor enxergar; erros
  // com alguma inserção → 200 degraded. Triage Fase 6 (falha silenciosa via errors++).
  const totalFail = errors > 0 && inseridos === 0
  return NextResponse.json({
    ok: errors === 0,
    degraded: errors > 0 && inseridos > 0,
    workspaces: perWs,
    dias: dayList,
    inseridos,
    errosVturb: errors,
    debug: { utmKeysFound: [...utmKeysFound].sort(), queryKeysAlvo: QUERY_KEYS },
  }, { status: totalFail ? 500 : 200 })
}
