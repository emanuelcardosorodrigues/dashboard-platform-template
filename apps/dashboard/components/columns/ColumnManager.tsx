'use client'

/**
 * Seletor de colunas (Fase 3.3) — botão + dropdown de presets + painel slide-over
 * para adicionar / remover / reordenar colunas. Apresentacional: recebe o estado
 * do hook useColumnPresets. Reorder via ↑/↓ (a11y); colunas de Identificação
 * (Status, nome) ficam travadas no topo.
 */

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Columns3, X, ChevronUp, ChevronDown, Plus, Search, Bookmark, Trash2, ArrowDownToLine, GripVertical } from 'lucide-react'
import { METRIC_BY_ID, metricsForScope, type MetricScope, type MetricGroup } from '@/lib/metrics/registry'
import type { ColumnPreset } from '@/lib/columns/useColumnPresets'

const LOCKED = new Set(['semaforo', 'criativo'])
const GROUP_ORDER: MetricGroup[] = ['Retornos', 'Conversões', 'Custos', 'Entrega', 'Vendas', 'Qualificação', 'VSL', 'Metadados', 'Identificação']

interface Props {
  scope: MetricScope
  visibleIds: string[]
  setVisibleIds: (ids: string[]) => void
  presets: ColumnPreset[]
  activeName: string
  isDirty: boolean
  applyPreset: (name: string) => void
  savePreset: (name: string) => void
  deletePreset: (name: string) => void
}

export default function ColumnManager({
  scope, visibleIds, setVisibleIds, presets, activeName, isDirty, applyPreset, savePreset, deletePreset,
}: Props) {
  const [open, setOpen] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const q = norm(search.trim())

  const label = (id: string) => METRIC_BY_ID[id]?.label ?? id
  const removable = visibleIds.filter((id) => !LOCKED.has(id))

  // Disponíveis = métricas do escopo que não estão visíveis, agrupadas.
  const available = useMemo(() => {
    const visSet = new Set(visibleIds)
    const list = metricsForScope(scope).filter((m) => !visSet.has(m.id) && !LOCKED.has(m.id))
    const byGroup = new Map<MetricGroup, typeof list>()
    for (const m of list) {
      if (q && !norm(m.label).includes(q)) continue
      if (!byGroup.has(m.group)) byGroup.set(m.group, [])
      byGroup.get(m.group)!.push(m)
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, items: byGroup.get(g)! }))
  }, [scope, visibleIds, q])

  const move = (id: string, dir: -1 | 1) => {
    const i = visibleIds.indexOf(id)
    const firstMovable = visibleIds.findIndex((x) => !LOCKED.has(x))
    const j = i + dir
    if (i < 0 || j < firstMovable || j >= visibleIds.length) return
    const next = [...visibleIds]
    ;[next[i], next[j]] = [next[j], next[i]]
    setVisibleIds(next)
  }
  const remove = (id: string) => setVisibleIds(visibleIds.filter((x) => x !== id))
  const add = (id: string) => setVisibleIds([...visibleIds, id])
  const addGroup = (items: { id: string }[]) => setVisibleIds([...visibleIds, ...items.map((m) => m.id)])

  // Reordenar arrastando: move `fromId` pra posição de `toId`. Colunas fixas
  // (LOCKED) ficam no início e não entram no arraste.
  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId || LOCKED.has(fromId) || LOCKED.has(toId)) return
    const next = visibleIds.filter((x) => x !== fromId)
    const idx = next.indexOf(toId)
    if (idx < 0) return
    next.splice(idx, 0, fromId)
    setVisibleIds(next)
  }

  return (
    <div className="flex items-center gap-2">
      {/* Botão Colunas */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#111827] border border-[#1F2937] text-gray-300 hover:border-cyan-500/40 hover:text-white transition-colors cursor-pointer"
      >
        <Columns3 size={13} />
        Colunas
        <span className="ml-0.5 px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] tabular-nums">{removable.length}</span>
      </button>

      {/* Presets */}
      <div className="relative">
        <button
          onClick={() => setPresetsOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#111827] border border-[#1F2937] text-gray-300 hover:border-cyan-500/40 hover:text-white transition-colors cursor-pointer"
        >
          <Bookmark size={13} />
          <span className="max-w-32 truncate">{activeName}{isDirty ? ' •' : ''}</span>
          <ChevronDown size={12} />
        </button>
        {presetsOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPresetsOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-64 bg-[#0B1220] border border-[#1F2937] rounded-xl shadow-2xl z-50 p-1.5">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-400">Predefinições</p>
              {presets.map((p) => (
                <div key={p.name} className="group flex items-center rounded-lg hover:bg-[#1F2937]/60">
                  <button
                    onClick={() => { applyPreset(p.name); setPresetsOpen(false) }}
                    className={clsx('flex-1 text-left px-2 py-1.5 text-xs truncate cursor-pointer', activeName === p.name ? 'text-cyan-400 font-medium' : 'text-gray-300')}
                  >
                    {p.name}{!p.builtin && <span className="text-gray-400"> (meu)</span>}
                  </button>
                  {!p.builtin && (
                    <button onClick={() => deletePreset(p.name)} title="Excluir preset" className="opacity-0 group-hover:opacity-100 px-2 text-gray-500 hover:text-rose-400 cursor-pointer">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
              <div className="border-t border-[#1F2937] mt-1 pt-1">
                {saving ? (
                  <div className="flex items-center gap-1 px-1">
                    <input
                      autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { savePreset(newName); setSaving(false); setNewName(''); setPresetsOpen(false) } if (e.key === 'Escape') { setSaving(false); setNewName('') } }}
                      placeholder="Nome do preset…"
                      className="flex-1 bg-[#111827] border border-[#1F2937] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500/50"
                    />
                    <button onClick={() => { if (newName.trim()) { savePreset(newName); setSaving(false); setNewName(''); setPresetsOpen(false) } }} className="px-2 py-1 text-xs text-cyan-400 cursor-pointer">OK</button>
                  </div>
                ) : (
                  <button onClick={() => setSaving(true)} className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-gray-400 hover:text-white cursor-pointer">
                    <ArrowDownToLine size={12} /> Salvar colunas atuais…
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Painel slide-over */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setOpen(false)} />
          <aside className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] bg-[#0B1220] border-l border-[#1F2937] shadow-2xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-[#1F2937] shrink-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Columns3 size={15} /> Colunas</div>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white cursor-pointer"><X size={16} /></button>
            </div>

            <div className="px-4 py-3 border-b border-[#1F2937] shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar métrica…"
                  className="w-full pl-8 pr-3 py-1.5 bg-[#111827] border border-[#1F2937] rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {/* Visíveis */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Visíveis ({removable.length}) <span className="normal-case tracking-normal text-gray-700">— arraste para reordenar</span></p>
                <ul className="space-y-0.5">
                  {visibleIds.map((id) => {
                    const locked = LOCKED.has(id)
                    return (
                      <li
                        key={id}
                        draggable={!locked}
                        onDragStart={(e) => { if (locked) { e.preventDefault(); return } setDragId(id); e.dataTransfer.effectAllowed = 'move' }}
                        onDragOver={(e) => { if (!locked && dragId && dragId !== id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
                        onDrop={(e) => { e.preventDefault(); if (dragId) reorder(dragId, id); setDragId(null) }}
                        onDragEnd={() => setDragId(null)}
                        className={clsx(
                          'group flex items-center gap-1 rounded-lg px-2 py-1.5 bg-[#111827] border transition-colors',
                          dragId === id ? 'border-cyan-500/60 opacity-50' : 'border-[#1F2937]',
                          !locked && 'cursor-grab active:cursor-grabbing'
                        )}
                      >
                        {!locked
                          ? <GripVertical size={13} className="text-gray-400 group-hover:text-gray-400 shrink-0" />
                          : <span className="w-[13px] shrink-0" />}
                        <span className={clsx('flex-1 text-xs truncate', locked ? 'text-gray-500' : 'text-gray-200')}>
                          {label(id)}{locked && <span className="text-gray-400"> (fixa)</span>}
                        </span>
                        {!locked && (
                          <>
                            <button onClick={() => move(id, -1)} title="Subir" className="text-gray-400 hover:text-white cursor-pointer"><ChevronUp size={13} /></button>
                            <button onClick={() => move(id, 1)} title="Descer" className="text-gray-400 hover:text-white cursor-pointer"><ChevronDown size={13} /></button>
                            <button onClick={() => remove(id)} title="Remover" className="text-gray-400 hover:text-rose-400 cursor-pointer"><X size={13} /></button>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* Disponíveis */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Disponíveis</p>
                {available.length === 0 && <p className="text-xs text-gray-400 px-1">Tudo já está visível.</p>}
                {available.map(({ group, items }) => (
                  <div key={group} className="mb-2">
                    <div className="flex items-center justify-between px-1 mb-0.5">
                      <span className="text-[10px] uppercase tracking-wider text-gray-500">{group} ({items.length})</span>
                      <button onClick={() => addGroup(items)} className="text-[10px] text-cyan-400 hover:text-cyan-300 cursor-pointer">+ Tudo</button>
                    </div>
                    <ul className="space-y-0.5">
                      {items.map((m) => (
                        <li key={m.id}>
                          <button onClick={() => add(m.id)} className="flex items-center gap-1.5 w-full text-left rounded-lg px-2 py-1.5 text-xs text-gray-300 hover:bg-[#1F2937]/60 hover:text-white cursor-pointer">
                            <Plus size={12} className="text-gray-400 shrink-0" />
                            <span className="truncate">{m.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
