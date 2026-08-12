'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { CriativoTag } from '@/types/criativos'

interface CatalogTag {
  id: number
  namespace: CriativoTag['namespace']
  slug: string
  label: string
  color: string | null
}

/**
 * Pill "+" que abre um popover pra adicionar/criar uma tag manual e aplicá-la a
 * um conjunto de ad_ids (o grupo-por-nome do card, ou uma seleção em lote).
 * Aplica via POST /api/criativos/tags e chama onApplied pra atualizar o card.
 */
export function TagAdder({
  adRefs,
  applied,
  onApplied,
  label,
}: {
  adRefs: string[]
  applied: CriativoTag[]
  onApplied: (t: CriativoTag) => void
  /** se definido, renderiza um botão rotulado (uso em lote) em vez da pill "+" */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CatalogTag[] | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || catalog) return
    fetch('/api/criativos/tags')
      .then((r) => r.json())
      .then((d) => setCatalog((d?.tags as CatalogTag[]) ?? []))
      .catch(() => setCatalog([]))
  }, [open, catalog])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const appliedIds = new Set(applied.map((t) => t.id))
  const q = input.trim().toLowerCase()
  const filtered = (catalog ?? []).filter((t) => !appliedIds.has(t.id) && t.label.toLowerCase().includes(q))
  const canCreate = !!input.trim() && !filtered.some((t) => t.label.toLowerCase() === input.trim().toLowerCase())

  async function apply(body: { create?: { label: string }; tagIds?: number[] }) {
    if (busy || !adRefs.length) return
    setBusy(true)
    try {
      const res = await fetch('/api/criativos/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, adRefs }),
      })
      const d = await res.json()
      if (res.ok) {
        if (d.tag) {
          const t = d.tag as CatalogTag
          onApplied({ id: t.id, slug: t.slug, label: t.label, color: t.color, namespace: 'manual', source: 'manual' })
          setCatalog((c) => (c ? [...c.filter((x) => x.id !== t.id), t] : c))
        } else if (body.tagIds) {
          for (const id of body.tagIds) {
            const t = catalog?.find((x) => x.id === id)
            if (t) onApplied({ id: t.id, slug: t.slug, label: t.label, color: t.color, namespace: t.namespace, source: 'manual' })
          }
        }
        setInput('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title="Adicionar tag"
        className={
          label
            ? 'inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md bg-purple-500 text-white hover:bg-purple-600'
            : 'text-[10px] w-4 h-4 rounded-full bg-black/50 text-white/70 border border-white/15 flex items-center justify-center hover:bg-black/70'
        }
      >
        <Plus className={label ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'} />
        {label}
      </button>
      {open && (
        <div
          className="absolute z-30 bottom-6 left-0 w-52 rounded-md border border-border bg-surface shadow-xl p-2"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) apply({ create: { label: input.trim() } })
            }}
            placeholder="Nova tag ou buscar…"
            className="w-full text-xs px-2 py-1 rounded bg-bg-base border border-border text-text-primary mb-1 outline-none"
          />
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {catalog === null && <div className="text-[10px] text-text-secondary px-1 py-1">carregando…</div>}
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                onClick={() => apply({ tagIds: [t.id] })}
                className="w-full flex items-center gap-1.5 text-left text-xs px-1.5 py-1 rounded hover:bg-bg-base disabled:opacity-50"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color ?? '#8b5cf6' }} />
                <span className="truncate">{t.label}</span>
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                disabled={busy}
                onClick={() => apply({ create: { label: input.trim() } })}
                className="w-full flex items-center gap-1.5 text-left text-xs px-1.5 py-1 rounded hover:bg-bg-base text-purple-300 disabled:opacity-50"
              >
                <Plus className="h-3 w-3 shrink-0" /> Criar “{input.trim()}”
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
