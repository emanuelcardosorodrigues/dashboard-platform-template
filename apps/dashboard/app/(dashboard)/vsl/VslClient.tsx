'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ChevronDown, Play, Target, TrendingUp, DollarSign, Users, Clock, Check } from 'lucide-react'
import KpiCard from '@/components/cards/KpiCard'
import VslPresetBar from '@/components/vsl/VslPresetBar'
import { cn } from '@/lib/cn'
import type {
  VturbPlayer,
  VturbSessionStats,
  VturbDailyStat,
  VturbTrafficStat,
  VturbLeaderboardGroup,
} from '@/lib/vturb'

interface TrafficByUtm {
  key: string
  count: number
  rows: VturbTrafficStat[]
  error: string | null
}

interface VslClientProps {
  players: VturbPlayer[]
  viewsByPlayer?: Record<string, number>
  selectedPlayers: VturbPlayer[]
  stats: VturbSessionStats | null
  statsError: string | null
  daily: VturbDailyStat[]
  traffics: TrafficByUtm[]
  utmsCatalogError: string | null
  leaderboard: VturbLeaderboardGroup[]
  engagement: {
    average_watched_time: number
    engagement_rate: number
    grouped_timed: Array<{ timed: number; total_users: number }>
  } | null
  adIdToName: Record<string, string>
  from: string
  to: string
}

const AD_ID_ATTRS = new Set(['utm_id', 'utm_content', 'utm_term'])
const PRIORITY_ATTRS = ['utm_id', 'utm_content', 'utm_term', 'utm_source', 'utm_medium', 'utm_campaign']

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR')
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1).replace('.', ',')}%`
}

function fmtPctRaw(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1).replace('.', ',')}%`
}

function fmtBRL(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtSec(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—'
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

function sortUtmsForDisplay(traffics: TrafficByUtm[]): TrafficByUtm[] {
  return [...traffics].sort((a, b) => {
    const ai = PRIORITY_ATTRS.indexOf(a.key)
    const bi = PRIORITY_ATTRS.indexOf(b.key)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return b.count - a.count
  })
}

export default function VslClient({
  players,
  viewsByPlayer,
  selectedPlayers,
  stats,
  statsError,
  daily,
  traffics,
  utmsCatalogError,
  leaderboard,
  engagement,
  adIdToName,
  from,
  to,
}: VslClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const isMulti = selectedPlayers.length > 1
  const primaryPlayer = selectedPlayers[0]
  const selectedIds = useMemo(() => new Set(selectedPlayers.map((p) => p.id)), [selectedPlayers])

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === null || value === '') params.delete(key)
    else params.set(key, value)
    router.push(`${pathname}?${params.toString()}`)
  }

  function setPlayerSelection(ids: string[]) {
    if (ids.length === 0) setParam('player', null)
    else if (ids.length === players.length) setParam('player', 'all')
    else setParam('player', ids.join(','))
  }

  const orderedTraffics = useMemo(() => sortUtmsForDisplay(traffics), [traffics])

  const totalDailyViews = useMemo(() => daily.reduce((s, d) => s + (d.total_viewed || 0), 0), [daily])
  const maxDailyViews = useMemo(() => Math.max(1, ...daily.map((d) => d.total_viewed || 0)), [daily])
  const maxDailyConv = useMemo(() => Math.max(1, ...daily.map((d) => d.total_conversions || 0)), [daily])

  const maxRetentionUsers = useMemo(() =>
    engagement ? Math.max(1, ...engagement.grouped_timed.map((g) => g.total_users)) : 1,
    [engagement],
  )

  return (
    <div className="space-y-6">
      {/* ── Toolbar: player ─────────────────────────────────────────────── */}
      <div className="glass-panel rounded-[20px] p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-brand-blue" strokeWidth={2.5} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {isMulti ? `${selectedPlayers.length} VSLs` : 'VSL'}
          </span>
        </div>
        <MultiPlayerSelect
          players={players}
          viewsByPlayer={viewsByPlayer}
          selectedIds={selectedIds}
          onApply={setPlayerSelection}
        />

        <div className="w-full" />
        <VslPresetBar currentIds={selectedPlayers.map((p) => p.id)} onApply={setPlayerSelection} />

        <div className="ml-auto text-[11px] text-gray-500 tabular-nums">
          {from} → {to}
          {!isMulti && (
            <> · duração {fmtSec(primaryPlayer.duration)} · pitch {fmtSec(primaryPlayer.pitch_time)}</>
          )}
        </div>
      </div>

      {statsError && (
        <div className="glass-panel rounded-[20px] p-4 text-sm text-red-400 border border-red-500/30">
          vTurb retornou erro: {statsError}
        </div>
      )}

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Views" value={fmtNumber(stats.total_viewed)} icon={<Play className="w-4 h-4" />} />
          <KpiCard label="Plays" value={fmtNumber(stats.total_started)} subtext={`Play rate: ${fmtPct(stats.play_rate)}`} icon={<Users className="w-4 h-4" />} />
          <KpiCard label="Engajamento" value={fmtPct(stats.engagement_rate)} subtext={`Finished: ${fmtNumber(stats.total_finished)}`} icon={<TrendingUp className="w-4 h-4" />} />
          <KpiCard label="Cliques" value={fmtNumber(stats.total_clicked)} subtext={`Pitch+: ${fmtNumber(stats.total_over_pitch)}`} icon={<Target className="w-4 h-4" />} />
          <KpiCard label="Conversões" value={fmtNumber(stats.total_conversions)} subtext={`CVR: ${fmtPct(stats.overall_conversion_rate)}`} icon={<TrendingUp className="w-4 h-4" />} />
          <KpiCard label="Receita" value={fmtBRL(stats.total_amount_brl)} subtext={stats.total_amount_usd ? `USD ${fmtNumber(stats.total_amount_usd)}` : undefined} icon={<DollarSign className="w-4 h-4" />} />
        </div>
      )}

      {/* ── Curva diária ──────────────────────────────────────────────── */}
      <div className="glass-panel rounded-[20px] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-text-primary">Evolução diária</h3>
          <span className="text-[11px] text-gray-500">{daily.length} dias · {fmtNumber(totalDailyViews)} views</span>
        </div>
        {daily.length === 0 ? (
          <p className="text-sm text-gray-500">Sem dados para o período.</p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-1 items-end h-32">
              {daily.slice(-30).map((d) => {
                const viewH = ((d.total_viewed || 0) / maxDailyViews) * 100
                const convH = ((d.total_conversions || 0) / maxDailyConv) * 100
                return (
                  <div key={d.day} className="flex flex-col gap-0.5 items-center group relative">
                    <div className="absolute -top-12 hidden group-hover:block z-10 bg-bg-base text-text-primary border border-border text-[10px] rounded px-2 py-1 whitespace-nowrap">
                      {d.day}<br />Views: {fmtNumber(d.total_viewed)}<br />Conv: {fmtNumber(d.total_conversions)}
                    </div>
                    <div className="w-full bg-brand-blue/30 rounded-t" style={{ height: `${viewH}%` }} />
                    <div className="w-full bg-emerald-500/70 rounded-b" style={{ height: `${convH * 0.3}%` }} />
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500 pt-2">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-brand-blue/30 rounded" />Views</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500/70 rounded" />Conversões</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Retenção (engajamento por tempo) ──────────────────────────── */}
      {engagement && engagement.grouped_timed.length > 0 && (
        <div className="glass-panel rounded-[20px] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-text-primary">Curva de retenção</h3>
            <div className="flex items-center gap-4 text-[11px] text-gray-500">
              <span><Clock className="w-3 h-3 inline mr-1" />Tempo médio: <strong className="text-text-primary">{fmtSec(engagement.average_watched_time)}</strong></span>
              <span>Engagement: <strong className="text-text-primary">{fmtPctRaw(engagement.engagement_rate)}</strong></span>
            </div>
          </div>
          <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${engagement.grouped_timed.length}, minmax(0, 1fr))` }}>
            {engagement.grouped_timed.map((g) => {
              const h = (g.total_users / maxRetentionUsers) * 100
              return (
                <div key={g.timed} className="group relative">
                  <div className="h-24 flex items-end">
                    <div
                      className="w-full bg-gradient-to-t from-brand-blue/60 to-brand-blue/20 rounded-sm"
                      style={{ height: `${h}%`, minHeight: '2px' }}
                    />
                  </div>
                  <div className="absolute -top-12 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 bg-bg-base text-text-primary border border-border text-[10px] rounded px-2 py-1 whitespace-nowrap">
                    {fmtSec(g.timed)} · {fmtNumber(g.total_users)} users
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 pt-1">
            <span>0:00</span>
            <span>{fmtSec(Math.floor(primaryPlayer.pitch_time))} (pitch)</span>
            <span>{fmtSec(primaryPlayer.duration)}</span>
          </div>
        </div>
      )}

      {/* ── Atribuição: TODAS UTMs disponíveis simultaneamente ─────────── */}
      {utmsCatalogError && (
        <div className="glass-panel rounded-[20px] p-4 text-sm text-red-400 border border-red-500/30">
          Não foi possível listar UTMs com dados: {utmsCatalogError}
        </div>
      )}

      {orderedTraffics.length === 0 && !utmsCatalogError && (
        <div className="glass-panel rounded-[20px] p-6">
          <p className="text-sm text-gray-500">
            vTurb não capturou nenhuma UTM ou query custom nesse período. Verifique se a página da VSL
            está propagando UTMs no carregamento do player.
          </p>
        </div>
      )}

      {orderedTraffics.map((bucket) => (
        <UtmSection
          key={bucket.key}
          bucket={bucket}
          adIdToName={adIdToName}
        />
      ))}

      {/* ── Leaderboard cross-VSL (se VTURB_COMPANY_ID estiver setado) ─── */}
      {leaderboard.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {leaderboard.map((board) => (
            <div key={board.event} className="glass-panel rounded-[20px] p-5">
              <h4 className="text-sm font-semibold text-text-primary mb-3 capitalize">Top {board.event}</h4>
              <ol className="space-y-2">
                {board.leaderboards.slice(0, 8).map((entry, idx) => {
                  const p = players.find((pl) => pl.id === entry.player_id)
                  return (
                    <li key={entry.player_id} className="flex items-center gap-2 text-[12px]">
                      <span className="w-5 text-gray-400 tabular-nums">{idx + 1}.</span>
                      <button
                        onClick={() => setPlayerSelection([entry.player_id])}
                        className="flex-1 text-left truncate hover:text-brand-blue transition-colors"
                        title={p?.name || entry.player_id}
                      >
                        {p?.name || entry.player_id.slice(0, 8)}
                      </button>
                      <span className="tabular-nums font-medium">{fmtNumber(entry.total_plays)}</span>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UtmSection({ bucket, adIdToName }: { bucket: TrafficByUtm; adIdToName: Record<string, string> }) {
  const [expanded, setExpanded] = useState(PRIORITY_ATTRS.indexOf(bucket.key) <= 2)
  const isAdIdAttr = AD_ID_ATTRS.has(bucket.key)
  const sorted = useMemo(
    () => [...bucket.rows].sort((a, b) => (b.total_amount_brl || 0) - (a.total_amount_brl || 0)),
    [bucket.rows],
  )
  const visibleRows = expanded ? sorted.slice(0, 50) : sorted.slice(0, 5)

  return (
    <div className="glass-panel rounded-[20px] p-6">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between mb-4 group"
      >
        <div className="text-left">
          <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
            <Target className="w-4 h-4 text-brand-blue" strokeWidth={2.5} />
            {bucket.key}
            <span className="text-[11px] font-normal text-gray-400 tabular-nums">({bucket.count} ocorrências)</span>
          </h3>
          <p className="text-[11px] text-gray-500 mt-1">
            {isAdIdAttr
              ? 'Cruzado com meta_ads.ad_id → nome do criativo do gerenciador'
              : 'Atribuição direta sem cruzamento'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          {sorted.length > 5 && (
            <span>{expanded ? 'mostrar menos' : `mostrar todos (${sorted.length})`}</span>
          )}
          <ChevronDown className={cn('w-4 h-4 transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {bucket.error && (
        <p className="text-sm text-red-400 mb-3">Erro ao buscar dados: {bucket.error}</p>
      )}

      {sorted.length === 0 ? (
        <p className="text-sm text-gray-500">Sem dados detalhados pra essa UTM.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-gray-500">
                <th className="text-left py-2 pr-3 font-semibold">{bucket.key}</th>
                {isAdIdAttr && <th className="text-left py-2 pr-3 font-semibold">Criativo</th>}
                <th className="text-right py-2 px-3 font-semibold">Views</th>
                <th className="text-right py-2 px-3 font-semibold">Plays</th>
                <th className="text-right py-2 px-3 font-semibold">Engaj.</th>
                <th className="text-right py-2 px-3 font-semibold">Cliques</th>
                <th className="text-right py-2 px-3 font-semibold">Conv.</th>
                <th className="text-right py-2 px-3 font-semibold">CVR</th>
                <th className="text-right py-2 pl-3 font-semibold">Receita</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const name = isAdIdAttr && adIdToName[row.value] ? adIdToName[row.value] : null
                return (
                  <tr key={row.value} className="border-b border-border/60 hover:bg-white/5 transition-colors">
                    <td className="py-2 pr-3 font-mono text-[11px] text-gray-400 max-w-[140px] truncate" title={row.value}>
                      {row.value || '—'}
                    </td>
                    {isAdIdAttr && (
                      <td className="py-2 pr-3 text-text-primary max-w-[300px] truncate" title={name ?? '(não vinculado)'}>
                        {name ?? <span className="text-gray-400">—</span>}
                      </td>
                    )}
                    <td className="py-2 px-3 text-right tabular-nums">{fmtNumber(row.total_viewed)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtNumber(row.total_started)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtPct(row.engagement_rate)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtNumber(row.total_clicked)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtNumber(row.total_conversions)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtPct(row.overall_conversion_rate)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-medium text-text-primary">{fmtBRL(row.total_amount_brl)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MultiPlayerSelect({ players, viewsByPlayer, selectedIds, onApply }: {
  players: VturbPlayer[]
  viewsByPlayer?: Record<string, number>
  selectedIds: Set<string>
  onApply: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<string>>(selectedIds)

  // Ordena por views desc (VSLs COM dado primeiro) quando temos a contagem.
  const orderedPlayers = useMemo(() => {
    if (!viewsByPlayer) return players
    return [...players].sort((a, b) => (viewsByPlayer[b.id] ?? 0) - (viewsByPlayer[a.id] ?? 0))
  }, [players, viewsByPlayer])

  // Re-sincroniza draft quando o selectedIds externo muda (após apply ou nav).
  // Comparação por size+iteração — Sets não comparam por referência.
  const sameAsExternal = useMemo(() => {
    if (draft.size !== selectedIds.size) return false
    for (const id of draft) if (!selectedIds.has(id)) return false
    return true
  }, [draft, selectedIds])

  function openDropdown() {
    setDraft(new Set(selectedIds))
    setOpen(true)
  }

  function toggle(id: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAll() { setDraft(new Set(players.map((p) => p.id))) }
  function clearAll() { setDraft(new Set()) }
  function apply() { onApply([...draft]); setOpen(false) }

  const label = (() => {
    if (selectedIds.size === 0) return 'Nenhuma'
    if (selectedIds.size === 1) {
      const p = players.find((pl) => selectedIds.has(pl.id))
      return p?.name ?? '1 VSL'
    }
    if (selectedIds.size === players.length) return `Todas (${players.length})`
    return `${selectedIds.size} VSLs`
  })()

  return (
    <div className="relative">
      <button
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border hover:border-brand-blue/40 transition-colors text-sm text-text-primary"
      >
        <span className="truncate max-w-[280px]">{label}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-[380px] bg-surface border border-border rounded-lg shadow-2xl z-20 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border text-[11px]">
              <span className="text-gray-500 tabular-nums">{draft.size} de {players.length} selecionadas</span>
              <div className="flex gap-3">
                <button onClick={selectAll} className="text-brand-blue hover:underline">Todas</button>
                <button onClick={clearAll} className="text-gray-500 hover:underline">Limpar</button>
              </div>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {orderedPlayers.map((p) => {
                const checked = draft.has(p.id)
                const views = viewsByPlayer?.[p.id] ?? 0
                const semDado = viewsByPlayer !== undefined && views === 0
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors flex items-center gap-2',
                      checked && 'bg-brand-blue/10',
                      semDado && !checked && 'opacity-45',
                    )}
                  >
                    <span className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                      checked ? 'bg-brand-blue border-brand-blue text-white' : 'border-border bg-transparent',
                    )}>
                      {checked && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    <span className="truncate flex-1 text-text-primary">{p.name}</span>
                    {viewsByPlayer !== undefined && (
                      <span className={cn('text-[10px] tabular-nums shrink-0', views > 0 ? 'text-emerald-400' : 'text-gray-400')}>
                        {fmtNumber(views)} views
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{fmtSec(p.duration)}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
              <button
                onClick={() => setOpen(false)}
                className="text-[12px] text-text-secondary hover:text-text-primary px-2 py-1"
              >
                Cancelar
              </button>
              <button
                onClick={apply}
                disabled={draft.size === 0 || sameAsExternal}
                className={cn(
                  'text-[12px] px-3 py-1 rounded-md font-medium transition-colors',
                  draft.size === 0 || sameAsExternal
                    ? 'bg-surface border border-border text-text-tertiary cursor-not-allowed'
                    : 'bg-brand-blue text-white hover:bg-brand-blue/90',
                )}
              >
                Aplicar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
