'use client'

/**
 * Predefinições de seleção de VSL (scope='vsl' na tabela column_presets;
 * payload = { ids: [player_id...] }). Reusa os server actions dos presets de
 * coluna. Permite: aplicar (1 clique), salvar a seleção atual, marcar PADRÃO
 * (carrega sozinho ao abrir /vsl) e excluir.
 *
 * Degrada graciosamente: se a migration 0023 (scope 'vsl') não foi aplicada,
 * loadColumnPresets retorna vazio e salvar mostra um aviso.
 */

import { useState, useEffect, useCallback } from 'react'
import { Star, Trash2, Plus, Loader2 } from 'lucide-react'
import {
  loadColumnPresets,
  saveColumnPresetAction,
  deleteColumnPresetAction,
  setDefaultColumnPresetAction,
} from '@/app/actions/columnPresets'

interface Preset { name: string; ids: string[]; shared: boolean; isDefault: boolean; owner: boolean }

export default function VslPresetBar({ currentIds, onApply }: { currentIds: string[]; onApply: (ids: string[]) => void }) {
  const [presets, setPresets] = useState<Preset[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try { setPresets(await loadColumnPresets('vsl')) } catch { setPresets([]) }
  }, [])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t) }, [msg])

  const save = async () => {
    if (currentIds.length === 0) { setMsg('Selecione ao menos uma VSL antes de salvar.'); return }
    const name = window.prompt('Nome da predefinição de VSL:')?.trim()
    if (!name) return
    setBusy(true)
    const r = await saveColumnPresetAction('vsl', name, currentIds).catch(() => ({ ok: false, error: 'falha' }))
    if (!r.ok) setMsg('Não salvou (a migration 0023 já foi aplicada no Supabase?).')
    await reload(); setBusy(false)
  }
  const del = async (name: string) => {
    if (!window.confirm(`Excluir a predefinição "${name}"?`)) return
    setBusy(true); await deleteColumnPresetAction('vsl', name).catch(() => {}); await reload(); setBusy(false)
  }
  const mark = async (name: string) => {
    setBusy(true); await setDefaultColumnPresetAction('vsl', name).catch(() => {}); await reload(); setBusy(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Predefinições</span>

      {presets.map((p) => (
        <span key={p.name} className="group inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 pl-2.5 pr-1.5 py-1 text-xs">
          <button onClick={() => onApply(p.ids)} title={`Aplicar (${p.ids.length} VSLs)`} className="inline-flex items-center gap-1 text-gray-200 hover:text-white cursor-pointer">
            {p.isDefault && <Star size={11} className="text-amber-400 fill-amber-400" />}
            {p.name}<span className="text-gray-500">·{p.ids.length}</span>
          </button>
          {p.owner && (
            <>
              <button onClick={() => mark(p.name)} title="Marcar como padrão (abre sozinha)" className="text-gray-500 hover:text-amber-400 cursor-pointer">
                <Star size={11} className={p.isDefault ? 'fill-amber-400 text-amber-400' : ''} />
              </button>
              <button onClick={() => del(p.name)} title="Excluir" className="text-gray-500 hover:text-rose-400 cursor-pointer">
                <Trash2 size={11} />
              </button>
            </>
          )}
        </span>
      ))}

      <button onClick={save} disabled={busy} title="Salvar a seleção atual como predefinição"
        className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 cursor-pointer">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Salvar VSLs
      </button>

      {msg && <span className="text-[11px] text-amber-400">{msg}</span>}
    </div>
  )
}
