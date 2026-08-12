'use client'

import { useState } from 'react'
import { Bookmark, ChevronDown, Save, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { FilterState, Preset } from '@/lib/tableFilters'

interface Props {
  presets: Preset[]
  currentFilter: FilterState
  onApply: (state: FilterState) => void
  onSave: (name: string, state: FilterState) => void
  onDelete: (id: string) => void
}

export default function FilterPresets({ presets, currentFilter, onApply, onSave, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [name, setName] = useState('')

  const hasFilter = currentFilter.groups.some((g) => g.rules.length > 0)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111827] border border-[#1F2937] hover:border-cyan-500/40 rounded-lg text-xs text-gray-300 cursor-pointer transition-colors"
      >
        <Bookmark size={12} className="text-cyan-400" />
        Presets
        <ChevronDown size={12} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setShowSave(false) }} />
          <div className="absolute top-full mt-1 right-0 w-72 bg-[#0B1220] border border-[#1F2937] rounded-xl shadow-2xl z-50 p-2 max-h-96 overflow-y-auto">
            {presets.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1F2937]/60 cursor-pointer"
              >
                <button
                  onClick={() => { onApply(p.state); setOpen(false) }}
                  className="flex-1 text-left text-xs text-gray-200 cursor-pointer"
                >
                  {p.name}
                </button>
                {!p.builtin && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(p.id) }}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-rose-400 transition-opacity cursor-pointer"
                    title="Remover preset"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            ))}

            <div className="border-t border-[#1F2937] mt-2 pt-2">
              {!showSave ? (
                <button
                  disabled={!hasFilter}
                  onClick={() => setShowSave(true)}
                  className={clsx(
                    'flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors',
                    hasFilter ? 'text-cyan-400 hover:bg-cyan-500/10' : 'text-gray-400 cursor-not-allowed'
                  )}
                >
                  <Save size={11} /> Salvar filtro atual como preset
                </button>
              ) : (
                <div className="flex items-center gap-1 px-1">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && name.trim()) {
                        onSave(name.trim(), currentFilter)
                        setName(''); setShowSave(false)
                      } else if (e.key === 'Escape') {
                        setName(''); setShowSave(false)
                      }
                    }}
                    placeholder="Nome do preset"
                    className="flex-1 bg-[#1F2937] border border-[#374151] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500/50"
                  />
                  <button
                    onClick={() => { if (name.trim()) { onSave(name.trim(), currentFilter); setName(''); setShowSave(false) } }}
                    className="text-cyan-400 hover:text-cyan-300 cursor-pointer p-1"
                  >
                    <Save size={11} />
                  </button>
                  <button onClick={() => { setShowSave(false); setName('') }} className="text-gray-500 hover:text-rose-400 cursor-pointer p-1">
                    <X size={11} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
