'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DataTable from '@/components/tables/DataTable'
import type { CriativoAgregado } from '@/types'
import { Search, Pause, Play, TrendingUp } from 'lucide-react'
import FilterBar from '@/components/filters/FilterBar'
import FilterFooter from '@/components/filters/FilterFooter'
import { useTableFilters } from '@/lib/useTableFilters'
import { applyFilter } from '@/lib/tableFilters'
import { ADS_FILTER_COLUMNS, ADS_AGGREGATES, ADS_CSV_COLUMNS } from '@/lib/adsTableConfig'
import { buildColumns, type BuiltColumn, type Row as ColRow } from '@/lib/metrics/buildColumns'
import { useColumnPresets } from '@/lib/columns/useColumnPresets'
import ColumnManager from '@/components/columns/ColumnManager'
import MetaActionModal, { type MetaActionKind, type MetaActionTarget, type MetaActionEscopo } from '@/components/meta/MetaActionModal'

interface Props {
  campanhas: CriativoAgregado[]
  conjuntos: CriativoAgregado[]
  funil?: string
  ticketMedioPeriodo?: number
  isAdmin?: boolean
  hoje?: string
  dowFatores?: number[]
}

type Row = CriativoAgregado & Record<string, unknown>

export default function CampanhasClient({ campanhas, conjuntos, funil, ticketMedioPeriodo, isAdmin, hoje, dowFatores }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  // Controle Meta (escrita) — orçamento + pausar/ativar vivem aqui (campanha/conjunto).
  const metaWriteEnabled = Boolean(isAdmin) && process.env.NEXT_PUBLIC_META_WRITE_UI === '1'
  const [metaAction, setMetaAction] = useState<{ kind: MetaActionKind; target: MetaActionTarget } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])
  const { filter: advFilter, setFilter: setAdvFilter } = useTableFilters({ storageKey: 'ads-filter' })

  const preFilteredCampanhas = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return campanhas
    return campanhas.filter((c) => c.criativo?.toLowerCase().includes(q) || c.campaignId?.includes(q))
  }, [campanhas, search])

  const preFilteredConjuntos = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return conjuntos
    return conjuntos.filter((c) => c.criativo?.toLowerCase().includes(q) || c.adsetId?.includes(q) || c.campaignId?.includes(q))
  }, [conjuntos, search])

  const filteredCampanhas = useMemo(
    () => applyFilter(preFilteredCampanhas as unknown as Record<string, unknown>[], advFilter) as unknown as typeof preFilteredCampanhas,
    [preFilteredCampanhas, advFilter]
  )
  const filteredConjuntos = useMemo(
    () => applyFilter(preFilteredConjuntos as unknown as Record<string, unknown>[], advFilter) as unknown as typeof preFilteredConjuntos,
    [preFilteredConjuntos, advFilter]
  )

  // Colunas customizáveis por escopo (Fase 3.3).
  const campState = useColumnPresets('campanhas')
  const conjState = useColumnPresets('conjuntos')
  const campBase = buildColumns(campState.visibleIds, { scope: 'campanhas', funil, ticketMedioPeriodo, hoje, dowFatores })
  const conjBase = buildColumns(conjState.visibleIds, { scope: 'conjuntos', funil, ticketMedioPeriodo, hoje, dowFatores })

  // Coluna de Controle Meta (escrita) — pausar/ativar + orçamento. `escopo` define
  // se o id é de campanha ou conjunto. Anexada só pra admin com o flag.
  const buildControleCol = (escopo: MetaActionEscopo): BuiltColumn => ({
    key: '__metaAcoes',
    label: 'Controle',
    align: 'center',
    sortable: false,
    width: 100,
    info: escopo === 'campanha'
      ? 'Pausar/ativar a campanha e alterar orçamento (CBO). Toda ação pede confirmação e é auditada.'
      : 'Pausar/ativar o conjunto e alterar orçamento (ABO). Toda ação pede confirmação e é auditada.',
    render: (_v, row) => {
      const c = row as ColRow & CriativoAgregado
      const id = escopo === 'campanha' ? c.campaignId : c.adsetId
      if (!id) return <span className="text-gray-400 text-xs" title="Sem id sincronizado">–</span>
      const ativo = c.statusMeta ? c.statusMeta === 'ACTIVE' : c.status === 'ativo'
      const target: MetaActionTarget = { adId: id, nome: c.criativo, escopo }
      return (
        <div className="flex items-center justify-center gap-1">
          {ativo ? (
            <button onClick={(e) => { e.stopPropagation(); setMetaAction({ kind: 'pausar', target }) }}
              title={`Pausar ${escopo}`} className="p-1.5 rounded-md text-amber-400 hover:bg-amber-500/15 transition-colors cursor-pointer"><Pause size={13} /></button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); setMetaAction({ kind: 'ativar', target }) }}
              title={`Ativar ${escopo}`} className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/15 transition-colors cursor-pointer"><Play size={13} /></button>
          )}
          <button onClick={(e) => { e.stopPropagation(); setMetaAction({ kind: 'escalar', target }) }}
            title="Alterar orçamento" className="p-1.5 rounded-md text-cyan-400 hover:bg-cyan-500/15 transition-colors cursor-pointer"><TrendingUp size={13} /></button>
        </div>
      )
    },
  })

  const campColumns: BuiltColumn[] = useMemo(
    () => metaWriteEnabled ? [...campBase, buildControleCol('campanha')] : campBase,
    [campBase, metaWriteEnabled] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const conjColumns: BuiltColumn[] = useMemo(
    () => metaWriteEnabled ? [...conjBase, buildControleCol('conjunto')] : conjBase,
    [conjBase, metaWriteEnabled] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <div className="space-y-8">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por campanha, conjunto ou ID..."
          className="w-full pl-9 pr-4 py-2 bg-[#111827] border border-[#1F2937] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
        />
      </div>

      <FilterBar
        columns={ADS_FILTER_COLUMNS}
        filter={advFilter}
        setFilter={setAdvFilter}
        csvColumns={ADS_CSV_COLUMNS}
        csvRows={[...filteredCampanhas, ...filteredConjuntos] as unknown as Record<string, unknown>[]}
        csvFilename={`campanhas-e-conjuntos-${new Date().toISOString().slice(0, 10)}.csv`}
        hint={
          <span>
            {filteredCampanhas.length}/{preFilteredCampanhas.length} camp. · {filteredConjuntos.length}/{preFilteredConjuntos.length} conj.
          </span>
        }
      />

      {/* Campanhas */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">
            Por Campanha <span className="text-gray-400 font-normal normal-case ml-1">({filteredCampanhas.length})</span>
          </h2>
          <ColumnManager scope="campanhas" visibleIds={campState.visibleIds} setVisibleIds={campState.setVisibleIds} presets={campState.presets} activeName={campState.activeName} isDirty={campState.isDirty} applyPreset={campState.applyPreset} savePreset={campState.savePreset} deletePreset={campState.deletePreset} />
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          {filteredCampanhas.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-gray-400">
              {search ? 'Nenhuma campanha encontrada para esta busca.' : 'Sem dados de campanhas no período.'}
            </p>
          ) : (
            <DataTable
              columns={campColumns}
              data={filteredCampanhas as unknown as Row[]}
              pageSize={25}
              rowKey={(_, i) => i}
              storageKey="campanhas"
            />
          )}
        </div>
        <FilterFooter
          rows={filteredCampanhas as unknown as Record<string, unknown>[]}
          specs={ADS_AGGREGATES}
          label={`Totais Campanhas (${filteredCampanhas.length})`}
        />
      </section>

      {/* Conjuntos */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">
            Por Conjunto de Anúncios <span className="text-gray-400 font-normal normal-case ml-1">({filteredConjuntos.length})</span>
          </h2>
          <ColumnManager scope="conjuntos" visibleIds={conjState.visibleIds} setVisibleIds={conjState.setVisibleIds} presets={conjState.presets} activeName={conjState.activeName} isDirty={conjState.isDirty} applyPreset={conjState.applyPreset} savePreset={conjState.savePreset} deletePreset={conjState.deletePreset} />
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          {filteredConjuntos.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-gray-400">
              {search ? 'Nenhum conjunto encontrado para esta busca.' : 'Sem dados de conjuntos no período.'}
            </p>
          ) : (
            <DataTable
              columns={conjColumns}
              data={filteredConjuntos as unknown as Row[]}
              pageSize={25}
              rowKey={(_, i) => i}
              storageKey="conjuntos"
            />
          )}
        </div>
        <FilterFooter
          rows={filteredConjuntos as unknown as Record<string, unknown>[]}
          specs={ADS_AGGREGATES}
          label={`Totais Conjuntos (${filteredConjuntos.length})`}
        />
      </section>

      {/* Modal de controle Meta (escrita — admin only) */}
      {metaAction && (
        <MetaActionModal
          kind={metaAction.kind}
          target={metaAction.target}
          onClose={() => setMetaAction(null)}
          onDone={(msg) => {
            setMetaAction(null)
            setToast(msg)
            router.refresh()
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F2937] border border-[#374151] text-white text-xs px-4 py-2.5 rounded-lg shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
