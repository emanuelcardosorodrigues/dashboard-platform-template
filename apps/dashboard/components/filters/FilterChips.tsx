'use client'

import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { type FilterState, type FilterableColumn, OP_LABEL, NEEDS_VALUE } from '@/lib/tableFilters'

interface Props {
  filter: FilterState
  columns: FilterableColumn[]
  setFilter: (next: FilterState) => void
}

export default function FilterChips({ filter, columns, setFilter }: Props) {
  if (!filter.groups.length) return null

  const colLabel = (key: string) => columns.find((c) => c.key === key)?.label ?? key
  const colFormat = (key: string, v: number) => {
    const c = columns.find((c) => c.key === key)
    return c?.format ? c.format(v) : String(v)
  }

  const removeRule = (gid: string, rid: string) => {
    setFilter({
      groups: filter.groups
        .map((g) => g.id === gid ? { ...g, rules: g.rules.filter((r) => r.id !== rid) } : g)
        .filter((g) => g.rules.length > 0),
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filter.groups.map((g, gi) => (
        <div key={g.id} className="flex flex-wrap items-center gap-1">
          {gi > 0 && <span className="text-[10px] text-amber-400 font-semibold px-1">OU</span>}
          {g.rules.map((r, ri) => {
            const needs = NEEDS_VALUE[r.op]
            return (
              <div key={r.id} className="inline-flex items-center gap-1">
                {ri > 0 && <span className="text-[10px] text-cyan-400">E</span>}
                <span className={clsx(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]',
                  'bg-cyan-500/10 border border-cyan-500/30 text-cyan-300'
                )}>
                  <span className="text-gray-300">{colLabel(r.column)}</span>
                  <span className="text-gray-500">{OP_LABEL[r.op]}</span>
                  {needs === 'one' && <span className="text-white tabular-nums">{colFormat(r.column, r.value)}{(r.op === 'top_pct' || r.op === 'bottom_pct') && '%'}</span>}
                  {needs === 'two' && (
                    <span className="text-white tabular-nums">
                      {colFormat(r.column, r.value)} – {colFormat(r.column, r.value2 ?? r.value)}
                    </span>
                  )}
                  <button
                    onClick={() => removeRule(g.id, r.id)}
                    className="ml-0.5 hover:text-rose-400 cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      ))}
      <button
        onClick={() => setFilter({ groups: [] })}
        className="text-[10px] text-gray-500 hover:text-rose-400 ml-2 cursor-pointer"
      >
        limpar todos
      </button>
    </div>
  )
}
