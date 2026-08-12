'use client'

import { Download } from 'lucide-react'
import { toCSV, downloadCSV } from '@/lib/tableFilters'

interface Props<T extends Record<string, unknown>> {
  rows: T[]
  columns: { key: string; label: string }[]
  filename: string
}

export default function ExportCsv<T extends Record<string, unknown>>({ rows, columns, filename }: Props<T>) {
  const disabled = rows.length === 0
  return (
    <button
      onClick={() => {
        if (disabled) return
        downloadCSV(filename, toCSV(rows, columns))
      }}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111827] border border-[#1F2937] hover:border-emerald-500/40 rounded-lg text-xs text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
      title={disabled ? 'Sem dados para exportar' : `Exportar ${rows.length} linha(s) em CSV`}
    >
      <Download size={12} className="text-emerald-400" />
      Exportar CSV
    </button>
  )
}
