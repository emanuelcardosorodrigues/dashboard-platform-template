'use client'

import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { clsx } from 'clsx'
import FilterPanel from './FilterPanel'
import FilterChips from './FilterChips'
import FilterPresets from './FilterPresets'
import ExportCsv from './ExportCsv'
import { usePresets } from '@/lib/useTableFilters'
import type { FilterState, FilterableColumn } from '@/lib/tableFilters'

interface Props<T extends Record<string, unknown>> {
  columns: FilterableColumn[]
  filter: FilterState
  setFilter: (next: FilterState) => void
  csvColumns?: { key: string; label: string }[]
  csvRows?: T[]
  csvFilename?: string
  /** Texto pequeno entre o botão e o export — ex.: "57 de 124 criativos" */
  hint?: React.ReactNode
}

export default function FilterBar<T extends Record<string, unknown>>({
  columns, filter, setFilter, csvColumns, csvRows, csvFilename, hint,
}: Props<T>) {
  const { presets, save, remove } = usePresets()
  const [open, setOpen] = useState(false)

  const ruleCount = filter.groups.reduce((sum, g) => sum + g.rules.length, 0)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen(true)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors',
            ruleCount > 0
              ? 'bg-cyan-500/10 border border-cyan-500/40 text-cyan-300'
              : 'bg-[#111827] border border-[#1F2937] text-gray-300 hover:border-cyan-500/40'
          )}
        >
          <SlidersHorizontal size={12} />
          Filtros avançados
          {ruleCount > 0 && (
            <span className="bg-cyan-500 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none ml-0.5">
              {ruleCount}
            </span>
          )}
        </button>

        <FilterPresets
          presets={presets}
          currentFilter={filter}
          onApply={setFilter}
          onSave={save}
          onDelete={remove}
        />

        {hint && <span className="text-xs text-gray-500">{hint}</span>}

        {csvColumns && csvRows && csvFilename && (
          <div className="ml-auto">
            <ExportCsv rows={csvRows} columns={csvColumns} filename={csvFilename} />
          </div>
        )}
      </div>

      {ruleCount > 0 && (
        <div className="bg-[#0B1220] border border-[#1F2937] rounded-xl px-3 py-2.5">
          <FilterChips filter={filter} columns={columns} setFilter={setFilter} />
        </div>
      )}

      <FilterPanel
        open={open}
        onClose={() => setOpen(false)}
        columns={columns}
        filter={filter}
        setFilter={setFilter}
      />
    </div>
  )
}
