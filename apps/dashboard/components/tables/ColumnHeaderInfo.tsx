'use client'

/**
 * Botão de ajuda no cabeçalho da coluna (Fase 3.2). Ao passar o mouse (ou focar/
 * clicar) aparece um popover explicando a métrica. Posicionado via position:fixed
 * + getBoundingClientRect (portal no body) para NÃO ser cortado pelo overflow-x-auto
 * da tabela. stopPropagation garante que clicar no "i" não dispara a ordenação.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

const OPEN_DELAY_MS = 300

export default function ColumnHeaderInfo({ text }: { text: string }) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // clampa à direita pra não vazar da viewport (largura máx ~240)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 248))
    setCoords({ top: r.bottom + 6, left })
  }, [])

  const openNow = useCallback(() => { place(); setOpen(true) }, [place])

  const onEnter = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(openNow, OPEN_DELAY_MS)
  }, [openNow])

  const onLeave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!pinned) setOpen(false)
  }, [pinned])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setPinned(false) } }
    const onDocClick = () => { setOpen(false); setPinned(false) }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => window.addEventListener('click', onDocClick), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onDocClick)
      clearTimeout(t)
    }
  }, [open])

  return (
    <span className="relative inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        aria-label="Como esta métrica é calculada"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={openNow}
        onBlur={() => { setOpen(false); setPinned(false) }}
        onClick={(e) => { e.stopPropagation(); setPinned((p) => !p); openNow() }}
        className="text-gray-400 hover:text-cyan-400 focus:text-cyan-400 focus:outline-none transition-colors cursor-help"
      >
        <Info size={11} />
      </button>
      {mounted && open && coords && createPortal(
        <div
          role="tooltip"
          style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 60 }}
          className="max-w-[240px] bg-[#1F2937] border border-[#374151] rounded-lg shadow-xl px-3 py-2 text-xs leading-snug text-gray-200 normal-case font-normal tracking-normal"
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  )
}
