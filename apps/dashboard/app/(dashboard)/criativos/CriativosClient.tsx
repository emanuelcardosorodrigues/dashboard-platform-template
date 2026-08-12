'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import DataTable from '@/components/tables/DataTable'
import BubbleChart from '@/components/charts/BubbleChart'
import type { CriativoAgregado } from '@/types'
import { ORIGEM_COLOR, ORIGEM_LABEL, type Origem } from '@/lib/origem'
import { formatCurrencyCompact, formatRoas, formatPercent, formatCurrency, formatDateBR, getFrontEndLabel } from '@/lib/formatters'
import { SEMAFORO_CSS, SEMAFORO_BG, getSemaforoColorForFunil } from '@/lib/thresholds'
import { Filter, Search, ExternalLink, Leaf, ScrollText, X, Settings2, Trophy, ClipboardCopy, Pause, Play } from 'lucide-react'
import FilterBar from '@/components/filters/FilterBar'
import FilterFooter from '@/components/filters/FilterFooter'
import { useTableFilters } from '@/lib/useTableFilters'
import { applyFilter } from '@/lib/tableFilters'
import { ADS_FILTER_COLUMNS, ADS_AGGREGATES, ADS_CSV_COLUMNS } from '@/lib/adsTableConfig'
import { buildColumns, type BuiltColumn, type Row as ColRow } from '@/lib/metrics/buildColumns'
import { useColumnPresets } from '@/lib/columns/useColumnPresets'
import ColumnManager from '@/components/columns/ColumnManager'
import MetaActionModal, { type MetaActionKind, type MetaActionTarget } from '@/components/meta/MetaActionModal'

export interface OrganicRow {
  fonte: string
  origem: Origem
  faturamento: number
  ticketMedio: number
  vendas: number
  vendasFront: number
  vendasOB1: number
  vendasOB2: number
  vendasOB3: number
  vendasOB4: number
  vendasUpsell: number
  vendasDownsell: number
}

interface Props {
  criativos: CriativoAgregado[]
  organico?: OrganicRow[]
  funil?: string
  ticketMedioPeriodo?: number
  /** Sessão é admin? (controle de escrita no Meta é admin-only — Fase 8). */
  isAdmin?: boolean
  /** Minigráficos hover (histórico 7d + projeção 7d). */
  hoje?: string
  dowFatores?: number[]
}

type TipoFilter = 'todos' | 'video' | 'imagem'
type StatusFilter = 'todos' | 'ativo' | 'pausado'

type MatrixAxisKey = 'hookRate' | 'retencaoRate' | 'convClique' | 'txConversaoPagina' | 'ctr'
type MatrixBubbleKey = 'lucro' | 'investimento' | 'vendasFront'

const AXIS_OPTIONS: { key: MatrixAxisKey; label: string }[] = [
  { key: 'hookRate',          label: 'Hook Rate' },
  { key: 'convClique',        label: 'Conv. Clique' },
  { key: 'retencaoRate',      label: 'Retenção 95%' },
  { key: 'txConversaoPagina', label: 'Conv. Pág.' },
  { key: 'ctr',               label: 'CTR' },
]
const BUBBLE_OPTIONS: { key: MatrixBubbleKey; label: string }[] = [
  { key: 'lucro',       label: 'Lucro' },
  { key: 'investimento', label: 'Investimento' },
  { key: 'vendasFront', label: 'Vendas Front' },
]

const AXIS_REF: Partial<Record<MatrixAxisKey, number>> = {
  hookRate:          38,
  convClique:        0.5,
  retencaoRate:      15,
  txConversaoPagina: 1.5,
  ctr:               1.0,
}

export default function CriativosClient({ criativos, organico, funil, ticketMedioPeriodo, isAdmin, hoje, dowFatores }: Props) {
  const router = useRouter()
  const [tipo, setTipo] = useState<TipoFilter>('todos')
  const [status, setStatus] = useState<StatusFilter>('todos')
  const [view, setView] = useState<'tabela' | 'matriz'>('tabela')
  const [search, setSearch] = useState('')
  const [reelRecap, setReelRecap] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Controle Meta (Fase 8.3): só pra admin E com o flag NEXT_PUBLIC_META_WRITE_UI=1.
  // O servidor reforça (admin-only + travas de dinheiro) — o flag/role aqui é só UX.
  const metaWriteEnabled = Boolean(isAdmin) && process.env.NEXT_PUBLIC_META_WRITE_UI === '1'
  const [metaAction, setMetaAction] = useState<{ kind: MetaActionKind; target: MetaActionTarget } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])
  const [matrixX, setMatrixX] = useState<MatrixAxisKey>('hookRate')
  const [matrixY, setMatrixY] = useState<MatrixAxisKey>('convClique')
  const [matrixBubble, setMatrixBubble] = useState<MatrixBubbleKey>('lucro')

  const { filter: advFilter, setFilter: setAdvFilter } = useTableFilters({ storageKey: 'ads-filter' })

  const preFiltered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return criativos.filter((c) => {
      if (tipo !== 'todos' && c.tipo?.toLowerCase() !== tipo) return false
      if (status !== 'todos' && c.status?.toLowerCase() !== status) return false
      if (q && !c.criativo?.toLowerCase().includes(q) && !c.campaign_name?.toLowerCase().includes(q) && !c.adset_name?.toLowerCase().includes(q) && !c.adId?.includes(q)) return false
      return true
    })
  }, [criativos, tipo, status, search])

  const filtered = useMemo(
    () => applyFilter(preFiltered as unknown as Record<string, unknown>[], advFilter) as unknown as typeof preFiltered,
    [preFiltered, advFilter]
  )

  const reelRecapData = reelRecap ? criativos.find((c) => c.criativo === reelRecap) : null
  const reelRecapUrl = process.env.NEXT_PUBLIC_REEL_RECAP_URL

  type Row = CriativoAgregado & Record<string, unknown>

  // Colunas customizáveis (Fase 3.3): layout/preset do usuário (localStorage).
  // Preset default "Tudo (legado)" reproduz a tabela anterior.
  const colState = useColumnPresets('criativos')
  const baseColumns = buildColumns(colState.visibleIds, {
    scope: 'criativos',
    funil,
    ticketMedioPeriodo,
    hoje,
    dowFatores,
    onReelRecap: (name) => setReelRecap(name),
    onCopyLink: (link) => {
      try { navigator.clipboard.writeText(link) } catch { /* fallback silencioso */ }
      setToast('Link copiado! Cole no campo do site para transcrever.')
      if (reelRecapUrl) window.open(reelRecapUrl, '_blank')
    },
  })

  // Coluna de Controle Meta (escrita) — anexada só pra admin com o flag ligado.
  const columns: BuiltColumn[] = useMemo(() => {
    if (!metaWriteEnabled) return baseColumns
    const acoesCol: BuiltColumn = {
      key: '__metaAcoes',
      label: 'Controle',
      align: 'center',
      sortable: false,
      width: 84,
      info: 'Pausar/ativar o anúncio no Meta (admin). Orçamento não existe por anúncio — ajuste em Campanhas ou Conjuntos. Toda ação pede confirmação e é registrada na auditoria.',
      render: (_v, row) => {
        const c = row as ColRow & CriativoAgregado
        const adId = c.adId
        if (!adId) return <span className="text-gray-400 text-xs" title="Sem ad_id sincronizado">–</span>
        const ativo = c.statusMeta ? c.statusMeta === 'ACTIVE' : c.status === 'ativo'
        const target: MetaActionTarget = { adId, nome: c.criativo, escopo: 'criativo' }
        return (
          <div className="flex items-center justify-center gap-1">
            {ativo ? (
              <button
                onClick={(e) => { e.stopPropagation(); setMetaAction({ kind: 'pausar', target }) }}
                title="Pausar anúncio"
                className="p-1.5 rounded-md text-amber-400 hover:bg-amber-500/15 transition-colors cursor-pointer"
              >
                <Pause size={13} />
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setMetaAction({ kind: 'ativar', target }) }}
                title="Ativar anúncio"
                className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/15 transition-colors cursor-pointer"
              >
                <Play size={13} />
              </button>
            )}
          </div>
        )
      },
    }
    return [...baseColumns, acoesCol]
  }, [baseColumns, metaWriteEnabled])

  // ── Rankings Top 5 ────────────────────────────────────────────────────────
  const topLucro     = [...criativos].filter((c) => c.investimento > 50 && c.lucro > 0).sort((a, b) => b.lucro - a.lucro).slice(0, 5)
  const topHookRate  = [...criativos].filter((c) => c.investimento > 50 && c.hookRate > 0).sort((a, b) => b.hookRate - a.hookRate).slice(0, 5)
  const topConvClique = [...criativos].filter((c) => (c.convClique ?? 0) > 0 && c.investimento > 50).sort((a, b) => (b.convClique ?? 0) - (a.convClique ?? 0)).slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Reel Recap Modal */}
      {reelRecapData && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setReelRecap(null)}
        >
          <div
            className="bg-[#111827] border border-[#1F2937] rounded-2xl p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-2">
                <ScrollText size={16} className="text-purple-400 shrink-0" />
                <h2 className="text-sm font-semibold text-white truncate max-w-72" title={reelRecapData.criativo}>
                  {reelRecapData.criativo}
                </h2>
              </div>
              <button onClick={() => setReelRecap(null)} className="text-gray-500 hover:text-white transition-colors ml-2 shrink-0 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            {/* KPIs principais */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: 'ROAS Bruto', value: formatRoas(reelRecapData.roas), color: 'text-gray-200' },
                { label: 'ROAS Líq.', value: formatRoas(reelRecapData.roasLiquido ?? 0), color: SEMAFORO_CSS[getSemaforoColorForFunil('roasLiquido', reelRecapData.roasLiquido ?? 0, funil)] },
                { label: 'CPA', value: reelRecapData.cpa > 0 ? formatCurrency(reelRecapData.cpa) : '–', color: reelRecapData.cpa > 0 ? SEMAFORO_CSS[getSemaforoColorForFunil('cpa', reelRecapData.cpa, funil, ticketMedioPeriodo)] : 'text-gray-500' },
                { label: 'Conv. Clique', value: reelRecapData.convClique ? formatPercent(reelRecapData.convClique) : '–', color: reelRecapData.convClique ? SEMAFORO_CSS[getSemaforoColorForFunil('txConversaoClique', reelRecapData.convClique, funil)] : 'text-gray-500' },
                { label: 'Hook Rate', value: formatPercent(reelRecapData.hookRate), color: SEMAFORO_CSS[getSemaforoColorForFunil('taxaGancho', reelRecapData.hookRate, funil)] },
                { label: 'Retenção', value: formatPercent(reelRecapData.retencaoRate), color: SEMAFORO_CSS[getSemaforoColorForFunil('taxaRetencao', reelRecapData.retencaoRate, funil)] },
                { label: 'Conv. Pág.', value: reelRecapData.txConversaoPagina > 0 ? formatPercent(reelRecapData.txConversaoPagina) : '–', color: reelRecapData.txConversaoPagina > 0 ? SEMAFORO_CSS[getSemaforoColorForFunil('txConversaoPagina', reelRecapData.txConversaoPagina, funil)] : 'text-gray-500' },
              ].map((m) => (
                <div key={m.label} className="bg-[#1F2937] rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-gray-500 mb-1">{m.label}</p>
                  <p className={clsx('text-sm font-bold tabular-nums', m.color)}>{m.value}</p>
                </div>
              ))}
            </div>

            {/* Investimento / Lucro */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-[#1F2937] rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-1">Investimento</p>
                <p className="text-sm font-semibold text-white">{formatCurrencyCompact(reelRecapData.investimento)}</p>
              </div>
              <div className="bg-[#1F2937] rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-1">Lucro</p>
                <p className={clsx('text-sm font-semibold', reelRecapData.lucro >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{formatCurrencyCompact(reelRecapData.lucro)}</p>
              </div>
              <div className="bg-[#1F2937] rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-1">{getFrontEndLabel(funil)}</p>
                <p className="text-sm font-semibold text-cyan-400">{reelRecapData.vendasFront ?? 0}</p>
              </div>
              <div className="bg-[#1F2937] rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-1">Ticket Médio</p>
                <p className="text-sm font-semibold text-white">{reelRecapData.ticketMedio ? formatCurrency(reelRecapData.ticketMedio) : '–'}</p>
              </div>
            </div>

            {/* Qualificação / Mentoria / Último dia */}
            <div className="border-t border-[#1F2937] pt-3 grid grid-cols-3 gap-2">
              <div>
                <p className="text-[10px] text-gray-500 mb-0.5">% Qualif.</p>
                <p className={clsx('text-sm font-semibold', reelRecapData.pctQualificados ? (reelRecapData.pctQualificados >= 20 ? 'text-emerald-400' : reelRecapData.pctQualificados >= 10 ? 'text-amber-400' : 'text-rose-400') : 'text-gray-500')}>
                  {reelRecapData.pctQualificados ? formatPercent(reelRecapData.pctQualificados) : '–'}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 mb-0.5">Mentoria</p>
                <p className={clsx('text-sm font-semibold', (reelRecapData.alunosMentoria ?? 0) > 0 ? 'text-purple-400' : 'text-gray-500')}>
                  {(reelRecapData.alunosMentoria ?? 0) > 0
                    ? `${reelRecapData.alunosMentoria} (${formatCurrencyCompact(reelRecapData.receitaMentoria ?? 0)})`
                    : '–'}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 mb-0.5">Último Dia</p>
                <p className="text-sm font-semibold text-gray-300">
                  {reelRecapData.ultimoDia ? formatDateBR(reelRecapData.ultimoDia) : '–'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por criativo, campanha, conjunto ou ad_id..."
          className="w-full pl-9 pr-4 py-2 bg-[#111827] border border-[#1F2937] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Filter size={14} />
          <span>Filtros:</span>
        </div>
        <div className="flex gap-1 bg-[#111827] border border-[#1F2937] rounded-lg p-1">
          {(['todos', 'video', 'imagem'] as TipoFilter[]).map((t) => (
            <button key={t} onClick={() => setTipo(t)}
              className={clsx('px-3 py-1.5 text-xs rounded-md capitalize transition-colors duration-200 cursor-pointer',
                tipo === t ? 'bg-cyan-500 text-white' : 'text-gray-400 hover:text-white')}>
              {t === 'todos' ? 'Todos os tipos' : t}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-[#111827] border border-[#1F2937] rounded-lg p-1">
          {(['todos', 'ativo', 'pausado'] as StatusFilter[]).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={clsx('px-3 py-1.5 text-xs rounded-md capitalize transition-colors duration-200 cursor-pointer',
                status === s ? 'bg-cyan-500 text-white' : 'text-gray-400 hover:text-white')}>
              {s === 'todos' ? 'Todos os status' : s}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {view === 'tabela' && (
            <ColumnManager
              scope="criativos"
              visibleIds={colState.visibleIds}
              setVisibleIds={colState.setVisibleIds}
              presets={colState.presets}
              activeName={colState.activeName}
              isDirty={colState.isDirty}
              applyPreset={colState.applyPreset}
              savePreset={colState.savePreset}
              deletePreset={colState.deletePreset}
            />
          )}
          <div className="flex gap-1 bg-[#111827] border border-[#1F2937] rounded-lg p-1">
            <button onClick={() => setView('tabela')}
              className={clsx('px-3 py-1.5 text-xs rounded-md transition-colors duration-200 cursor-pointer',
                view === 'tabela' ? 'bg-cyan-500 text-white' : 'text-gray-400 hover:text-white')}>
              Tabela
            </button>
            <button onClick={() => setView('matriz')}
              className={clsx('px-3 py-1.5 text-xs rounded-md transition-colors duration-200 cursor-pointer',
                view === 'matriz' ? 'bg-cyan-500 text-white' : 'text-gray-400 hover:text-white')}>
              Matriz
            </button>
          </div>
        </div>
      </div>

      <FilterBar
        columns={ADS_FILTER_COLUMNS}
        filter={advFilter}
        setFilter={setAdvFilter}
        csvColumns={ADS_CSV_COLUMNS}
        csvRows={filtered as unknown as Record<string, unknown>[]}
        csvFilename={`criativos-${new Date().toISOString().slice(0, 10)}.csv`}
        hint={
          <span>
            {filtered.length} de {preFiltered.length} criativo{preFiltered.length !== 1 ? 's' : ''}
          </span>
        }
      />

      {view === 'tabela' ? (
        <>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <DataTable
            columns={columns}
            data={filtered as unknown as Row[]}
            pageSize={25}
            rowKey={(_, i) => i}
            storageKey="criativos"
          />
        </div>
        <FilterFooter rows={filtered as unknown as Record<string, unknown>[]} specs={ADS_AGGREGATES} label={`Totais Criativos (${filtered.length})`} />
        </>
      ) : (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
          {/* Matrix config */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Settings2 size={13} />
              <span>Configurar eixos:</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">X:</span>
              <select value={matrixX} onChange={(e) => setMatrixX(e.target.value as MatrixAxisKey)}
                className="bg-[#1F2937] border border-[#374151] rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-cyan-500/50 cursor-pointer">
                {AXIS_OPTIONS.filter((o) => o.key !== matrixY).map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Y:</span>
              <select value={matrixY} onChange={(e) => setMatrixY(e.target.value as MatrixAxisKey)}
                className="bg-[#1F2937] border border-[#374151] rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-cyan-500/50 cursor-pointer">
                {AXIS_OPTIONS.filter((o) => o.key !== matrixX).map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Bolha:</span>
              <select value={matrixBubble} onChange={(e) => setMatrixBubble(e.target.value as MatrixBubbleKey)}
                className="bg-[#1F2937] border border-[#374151] rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-cyan-500/50 cursor-pointer">
                {BUBBLE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">
              Matriz: {AXIS_OPTIONS.find((o) => o.key === matrixX)?.label} × {AXIS_OPTIONS.find((o) => o.key === matrixY)?.label}
            </h2>
            <p className="text-xs text-gray-400">
              Bolha = {BUBBLE_OPTIONS.find((o) => o.key === matrixBubble)?.label} · Cor = ROAS
            </p>
          </div>

          <BubbleChart
            data={filtered}
            xKey={matrixX}
            yKey={matrixY}
            bubbleKey={matrixBubble}
            xLabel={AXIS_OPTIONS.find((o) => o.key === matrixX)?.label}
            yLabel={AXIS_OPTIONS.find((o) => o.key === matrixY)?.label}
            xRef={AXIS_REF[matrixX]}
            yRef={AXIS_REF[matrixY]}
          />

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-3">
            {[
              { color: 'bg-emerald-400', label: 'ROAS ≥ 1.5x' },
              { color: 'bg-amber-400',   label: 'ROAS 1.0–1.5x' },
              { color: 'bg-rose-500',    label: 'ROAS < 1.0x' },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-2 text-xs text-gray-400">
                <span className={clsx('w-2.5 h-2.5 rounded-full', l.color)} />
                {l.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Rankings Top 5 ─────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {(
          [
            {
              title: 'Mais Lucrativo',
              color: 'text-amber-400',
              data: topLucro,
              metricLabel: 'Lucro',
              metricRender: (c: CriativoAgregado) => <span className={c.lucro >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrencyCompact(c.lucro)}</span>,
            },
            {
              title: 'Melhor Hook Rate',
              color: 'text-purple-400',
              data: topHookRate,
              metricLabel: 'Hook Rate',
              metricRender: (c: CriativoAgregado) => <span className={clsx(SEMAFORO_CSS[getSemaforoColorForFunil('taxaGancho', c.hookRate, funil)])}>{formatPercent(c.hookRate)}</span>,
            },
            {
              title: 'Melhor Conv. Clique',
              color: 'text-cyan-400',
              data: topConvClique,
              metricLabel: 'Conv. Clique',
              metricRender: (c: CriativoAgregado) => <span className={clsx(SEMAFORO_CSS[getSemaforoColorForFunil('txConversaoClique', c.convClique ?? 0, funil)])}>{formatPercent(c.convClique ?? 0)}</span>,
            },
          ] as const
        ).map((ranking) => (
          <div key={ranking.title} className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1F2937] flex items-center gap-2">
              <Trophy size={13} className={ranking.color} />
              <h3 className="text-xs font-medium text-gray-400 uppercase tracking-widest">{ranking.title}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1F2937]">
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-6">#</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Criativo</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">{ranking.metricLabel}</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Faturamento</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Investimento</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Lucro</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">ROAS Bruto</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">ROAS Líq.</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">CPA</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">TM</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.data.map((c, i) => (
                    <tr key={c.criativo} className="border-b border-[#1F2937]/60 hover:bg-[#1F2937]/40 transition-colors">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-gray-300 truncate max-w-64" title={c.criativo}>{c.criativo}</span>
                          {c.link && (
                            <>
                              <a href={c.link} target="_blank" rel="noopener noreferrer" className="shrink-0 text-gray-400 hover:text-cyan-400 transition-colors">
                                <ExternalLink size={11} />
                              </a>
                              <button
                                onClick={() => {
                                  try { navigator.clipboard.writeText(c.link!) } catch { /* noop */ }
                                  setToast('Link copiado! Cole no campo do site para transcrever.')
                                  if (reelRecapUrl) window.open(reelRecapUrl, '_blank')
                                }}
                                className="shrink-0 text-gray-400 hover:text-cyan-400 transition-colors cursor-pointer"
                              >
                                <ClipboardCopy size={11} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{ranking.metricRender(c)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-300">{formatCurrencyCompact(c.faturamento)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-400">{formatCurrencyCompact(c.investimento)}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><span className={c.lucro >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrencyCompact(c.lucro)}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-200">{formatRoas(c.roas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><span className={clsx(SEMAFORO_CSS[getSemaforoColorForFunil('roasLiquido', c.roasLiquido ?? 0, funil)])}>{formatRoas(c.roasLiquido ?? 0)}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.cpa > 0 ? <span className={clsx(SEMAFORO_CSS[getSemaforoColorForFunil('cpa', c.cpa, funil, ticketMedioPeriodo)])}>{formatCurrency(c.cpa)}</span> : <span className="text-gray-400">–</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-400">{(c.ticketMedio ?? 0) > 0 ? formatCurrency(c.ticketMedio ?? 0) : '–'}</td>
                    </tr>
                  ))}
                  {ranking.data.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-4 text-center text-gray-400">Sem dados suficientes</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de controle Meta (escrita — admin only) */}
      {metaAction && (
        <MetaActionModal
          kind={metaAction.kind}
          target={metaAction.target}
          onClose={() => setMetaAction(null)}
          onDone={(msg) => {
            setMetaAction(null)
            setToast(msg)
            router.refresh() // re-busca dados do servidor (status/orçamento atualizam na próxima sync)
          }}
        />
      )}

      {/* Organic table */}
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F2937] border border-[#374151] text-white text-xs px-4 py-2.5 rounded-lg shadow-xl">
          {toast}
        </div>
      )}

      {organico && organico.length > 0 && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1F2937] flex items-center gap-2">
            <Leaf size={14} className="text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Orgânico</h2>
            <span className="text-xs text-gray-500 ml-1">— vendas sem gasto em tráfego pago confirmado</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1F2937]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-widest">Fonte / UTM</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">Faturamento</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">TM</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">Vendas</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">{getFrontEndLabel(funil)}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">OB1</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">OB2</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">OB3</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">OB4</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">Upsell</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">Downsell</th>
                </tr>
              </thead>
              <tbody>
                {organico.map((row) => {
                  const isFallback = row.fonte.startsWith('* ')
                  const isHotmart = row.fonte.startsWith('HOTMART_')
                  return (
                    <tr key={row.fonte} className="border-b border-[#1F2937] hover:bg-[#1F2937]/40 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded shrink-0 border"
                            style={{ color: ORIGEM_COLOR[row.origem], borderColor: `${ORIGEM_COLOR[row.origem]}55`, background: `${ORIGEM_COLOR[row.origem]}1a` }}
                          >
                            {ORIGEM_LABEL[row.origem]}
                          </span>
                          {isFallback && <span className="text-[10px] text-gray-500 shrink-0">*</span>}
                          {isHotmart && <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded shrink-0">Hotmart</span>}
                          <span className={clsx('truncate max-w-64', isFallback ? 'text-gray-500 italic' : isHotmart ? 'text-orange-300' : 'text-gray-200')} title={row.fonte}>
                            {isFallback ? row.fonte.slice(2) : row.fonte}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-emerald-400 tabular-nums font-medium">{formatCurrencyCompact(row.faturamento)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">{row.ticketMedio > 0 ? formatCurrency(row.ticketMedio) : '–'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">{row.vendas}</td>
                      <td className="px-4 py-2.5 text-right text-cyan-400 tabular-nums">{row.vendasFront > 0 ? row.vendasFront : '–'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums">{row.vendasOB1 > 0 ? row.vendasOB1 : '–'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums">{row.vendasOB2 > 0 ? row.vendasOB2 : '–'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums">{row.vendasOB3 > 0 ? row.vendasOB3 : '–'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums">{row.vendasOB4 > 0 ? row.vendasOB4 : '–'}</td>
                      <td className="px-4 py-2.5 text-right text-purple-300 tabular-nums">{row.vendasUpsell > 0 ? row.vendasUpsell : '–'}</td>
                      <td className="px-4 py-2.5 text-right text-purple-300 tabular-nums">{row.vendasDownsell > 0 ? row.vendasDownsell : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[10px] text-gray-400 border-t border-[#1F2937]">
            * Sem utm_content registrado — canal inferido pelo utm_medium/source de último impacto.
            Entradas Hotmart são vendas dentro do ecossistema da plataforma (upsell, club, recomendação).
          </p>
        </div>
      )}
    </div>
  )
}
