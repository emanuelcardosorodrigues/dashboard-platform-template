export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import {
  listPlayers,
  sessionStats,
  sessionStatsByDay,
  trafficStats,
  validUtms,
  eventsLeaderboard,
  userEngagement,
  aggregateStats,
  aggregateDaily,
  aggregateTraffic,
  type VturbPlayer,
  type VturbTrafficStat,
  type VturbSessionStats,
  type VturbDailyStat,
} from '@/lib/vturb'
import { fetchMetaAds, getDateRange } from '@/lib/supabase'
import { loadColumnPresets } from '@/app/actions/columnPresets'
import VslClient from './VslClient'

interface SearchParamsShape {
  de?: string
  ate?: string
  player?: string
}

export default async function VslPage({ searchParams }: { searchParams: Promise<SearchParamsShape> }) {
  const { de = '', ate = '', player } = await searchParams

  if (!process.env.VTURB_API_TOKEN) {
    return (
      <div className="flex flex-col h-full">
        <Header title="VSLs" subtitle="vTurb Analytics" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="glass-panel rounded-[20px] p-8 text-center text-text-secondary">
            <p className="text-lg font-medium text-text-primary mb-2">VTURB_API_TOKEN ausente</p>
            <p className="text-sm">Defina a variável de ambiente VTURB_API_TOKEN na Vercel para habilitar este painel.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="VSLs" subtitle="vTurb Analytics" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="glass-panel rounded-[20px] h-96 animate-pulse" />}>
          <VslContent de={de} ate={ate} player={player} />
        </Suspense>
      </div>
    </div>
  )
}

/**
 * Parse de `player` query: aceita single id, "all", ou csv "id1,id2,id3".
 * Retorna lista de players selecionados (validados contra a lista real).
 */
function resolveSelected(player: string | undefined, players: VturbPlayer[]): VturbPlayer[] {
  if (!player || player === '') return [players[0]]
  if (player === 'all') return players
  const ids = player.split(',').map((s) => s.trim()).filter(Boolean)
  const matched = ids.map((id) => players.find((p) => p.id === id)).filter((p): p is VturbPlayer => Boolean(p))
  return matched.length > 0 ? matched : [players[0]]
}

async function VslContent({ de, ate, player }: { de: string; ate: string; player?: string }) {
  const { from, to } = getDateRange(de, ate)
  const startDate = from || '2026-01-01'
  const endDate = to || new Date().toISOString().slice(0, 10)

  let players: VturbPlayer[] = []
  try {
    players = await listPlayers()
  } catch (err) {
    return <ErrorPanel error={err} />
  }

  if (players.length === 0) {
    return (
      <div className="glass-panel rounded-[20px] p-8 text-center text-text-secondary">
        Nenhum VSL encontrado nesta conta vTurb.
      </div>
    )
  }

  // Default: sem ?player na URL → (1) predefinição PADRÃO do usuário, se houver;
  // senão (2) abre no player com MAIS tráfego no período (players[0] costuma ser
  // um VSL de lead sem play → tela "sem dados").
  // Views por player no período (pro seletor mostrar QUAIS VSLs têm dado +
  // escolher o default). Cacheado pelo fetch do vTurb.
  const allStats = await Promise.allSettled(players.map((p) =>
    sessionStats({ playerId: p.id, startDate, endDate, videoDuration: p.duration, pitchTime: p.pitch_time })
  ))
  const viewsByPlayer: Record<string, number> = {}
  players.forEach((p, i) => {
    const r = allStats[i]
    viewsByPlayer[p.id] = r.status === 'fulfilled' ? Number(r.value?.total_viewed) || 0 : 0
  })

  let selectedPlayers: VturbPlayer[]
  if (!player || player === '') {
    let defaultIds: string[] = []
    try {
      const presets = await loadColumnPresets('vsl')
      const def = presets.find((p) => p.isDefault)
      if (def) defaultIds = def.ids.filter((id) => players.some((p) => p.id === id))
    } catch { /* tabela/scope ausente → ignora */ }

    if (defaultIds.length > 0) {
      selectedPlayers = players.filter((p) => defaultIds.includes(p.id))
    } else {
      let bestId = players[0].id, best = -1
      for (const p of players) { if (viewsByPlayer[p.id] > best) { best = viewsByPlayer[p.id]; bestId = p.id } }
      selectedPlayers = players.filter((p) => p.id === bestId)
    }
  } else {
    selectedPlayers = resolveSelected(player, players)
  }
  const isMulti = selectedPlayers.length > 1
  const primaryPlayer = selectedPlayers[0]

  // Fetch stats/daily/utms para CADA player selecionado em paralelo
  const perPlayerResults = await Promise.all(
    selectedPlayers.map(async (p) => {
      const [stats, daily, utms] = await Promise.allSettled([
        sessionStats({
          playerId: p.id,
          startDate,
          endDate,
          videoDuration: p.duration,
          pitchTime: p.pitch_time,
        }),
        sessionStatsByDay({
          playerId: p.id,
          startDate,
          endDate,
          videoDuration: p.duration,
          pitchTime: p.pitch_time,
        }),
        validUtms({ playerId: p.id, startDate, endDate }),
      ])
      return {
        playerId: p.id,
        stats: stats.status === 'fulfilled' ? stats.value : null,
        statsError: stats.status === 'rejected' ? String(stats.reason).slice(0, 200) : null,
        daily: daily.status === 'fulfilled' ? daily.value : [],
        utms: utms.status === 'fulfilled' ? utms.value : {},
        utmsError: utms.status === 'rejected' ? String(utms.reason).slice(0, 200) : null,
      }
    }),
  )

  // Engagement: só faz sentido com um único player (durações diferentes não combinam)
  const engagement = isMulti
    ? null
    : await userEngagement({
        playerId: primaryPlayer.id,
        startDate,
        endDate,
        videoDuration: primaryPlayer.duration,
      }).catch(() => null)

  const [leaderboard, metaAds] = await Promise.allSettled([
    process.env.VTURB_COMPANY_ID
      ? eventsLeaderboard({
          companyId: process.env.VTURB_COMPANY_ID,
          startDate,
          endDate,
          events: ['started', 'clicked', 'finished'],
          limit: 10,
        })
      : Promise.resolve([]),
    fetchMetaAds(),
  ])

  // Agrega stats e daily across todos os players selecionados
  const validStats = perPlayerResults.map((r) => r.stats).filter((s): s is VturbSessionStats => s !== null)
  const aggregatedStats: VturbSessionStats | null = validStats.length > 0 ? aggregateStats(validStats) : null
  const dailyArrays: VturbDailyStat[][] = perPlayerResults.map((r) => r.daily)
  const aggregatedDaily = aggregateDaily(dailyArrays)
  const firstStatsError = perPlayerResults.find((r) => r.statsError)?.statsError ?? null

  // Une catálogos de UTMs (soma counts) — fica a chave/UTM e quantas ocorrências há somando todos os players
  const utmsCatalog: Record<string, number> = {}
  let utmsCatalogError: string | null = null
  for (const r of perPlayerResults) {
    if (r.utmsError && !utmsCatalogError) utmsCatalogError = r.utmsError
    for (const [k, v] of Object.entries(r.utms)) {
      if (typeof v === 'number' && v > 0) utmsCatalog[k] = (utmsCatalog[k] ?? 0) + v
    }
  }

  const utmsAvailable: Array<{ key: string; count: number }> = Object.entries(utmsCatalog)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)

  // Para cada UTM disponível: fetch traffic_stats por player e agrega
  const trafficResults = await Promise.all(
    utmsAvailable.map(async (u) => {
      const perPlayer = await Promise.allSettled(
        selectedPlayers.map((p) =>
          trafficStats({
            playerId: p.id,
            startDate,
            endDate,
            queryKey: u.key,
            videoDuration: p.duration,
            pitchTime: p.pitch_time,
          }),
        ),
      )
      const fulfilled: VturbTrafficStat[][] = perPlayer
        .filter((r): r is PromiseFulfilledResult<VturbTrafficStat[]> => r.status === 'fulfilled')
        .map((r) => r.value)
      const errors = perPlayer.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
      const errorMsg = errors.length > 0 ? String(errors[0].reason).slice(0, 160) : null
      return {
        key: u.key,
        count: u.count,
        rows: aggregateTraffic(fulfilled),
        error: errorMsg,
      }
    }),
  )

  const adIdToName: Record<string, string> = {}
  if (metaAds.status === 'fulfilled') {
    for (const row of metaAds.value) {
      if (row.ad_id && row.ad_name) adIdToName[row.ad_id] = row.ad_name
    }
  }

  return (
    <VslClient
      players={players}
      viewsByPlayer={viewsByPlayer}
      selectedPlayers={selectedPlayers}
      stats={aggregatedStats}
      statsError={firstStatsError}
      daily={aggregatedDaily}
      traffics={trafficResults}
      utmsCatalogError={utmsCatalogError}
      leaderboard={leaderboard.status === 'fulfilled' ? leaderboard.value : []}
      engagement={engagement}
      adIdToName={adIdToName}
      from={startDate}
      to={endDate}
    />
  )
}

function ErrorPanel({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="glass-panel rounded-[20px] p-8 text-center">
      <p className="text-lg font-medium text-text-primary mb-2">Erro ao consultar vTurb</p>
      <p className="text-sm text-text-secondary break-all">{msg}</p>
    </div>
  )
}
