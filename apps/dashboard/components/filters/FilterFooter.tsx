'use client'

import { aggregate, type AggregateSpec } from '@/lib/tableFilters'

interface Props<T extends Record<string, unknown>> {
  rows: T[]
  specs: AggregateSpec[]
  label?: string
}

export default function FilterFooter<T extends Record<string, unknown>>({ rows, specs, label }: Props<T>) {
  if (!rows.length) return null

  return (
    <div className="bg-[#0B1220] border border-[#1F2937] rounded-xl px-4 py-3 mt-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
          {label ?? `Totais (${rows.length} ite${rows.length === 1 ? 'm' : 'ns'})`}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {specs.map((s) => {
          const v = aggregate(rows, s)
          return (
            <div key={s.key + '_' + s.kind} className="bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{s.label}</p>
              <p className="text-sm font-semibold text-white tabular-nums">
                {s.format ? s.format(v) : (Number.isInteger(v) ? String(v) : v.toFixed(2))}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
