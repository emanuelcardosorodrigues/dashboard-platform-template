'use client'

/**
 * B1 — Bottom sheet mobile reutilizável (plano UX mobile v2, Onda 2).
 *
 * Sem dependência nova: gesto por touch nativo, animação por transition CSS.
 * - Overlay full-screen (100svh) com backdrop escuro; tap no backdrop fecha.
 * - Painel sobe de baixo, cantos arredondados no topo. Detent inicial ~50svh,
 *   cresce até ~85svh conforme o conteúdo (o miolo rola sozinho).
 * - Grabber no topo: arrastar pra baixo além de ~80px fecha (touchstart/move/end
 *   nativos, listener não-passivo pra poder `preventDefault` durante o arraste).
 * - Esc fecha. Foco inicial no painel. Respeita `prefers-reduced-motion`.
 *
 * É md:hidden por construção — nunca aparece no desktop. Ainda assim o Header
 * só o monta dentro do wrapper mobile, então no desktop o DOM fica intocado.
 */

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useMediaQuery } from '@/lib/hooks/useMediaQuery'

const CLOSE_THRESHOLD = 80 // px de arraste pra baixo que confirmam o fechar
const ANIM_MS = 300

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  // `mounted` mantém o nó no DOM durante a animação de saída; `shown` dispara a
  // transição de entrada/saída (translateY + opacity).
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragY, setDragY] = useState(0)

  const panelRef = useRef<HTMLDivElement>(null)
  const grabberRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  // Montagem + coreografia da transição.
  useEffect(() => {
    if (open) {
      setDragY(0)
      setMounted(true)
      if (reduceMotion) {
        setShown(true)
        return
      }
      // Dois frames: garante que o browser aplique translateY(100%) antes de
      // transicionar pra translateY(0) — senão o painel "aparece" sem animar.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    // Fechando: dispara a saída e desmonta depois da animação.
    setShown(false)
    if (reduceMotion) {
      setMounted(false)
      return
    }
    const t = setTimeout(() => setMounted(false), ANIM_MS)
    return () => clearTimeout(t)
  }, [open, reduceMotion])

  // Esc fecha + trava o scroll do body enquanto o sheet está montado.
  useEffect(() => {
    if (!mounted) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [mounted, onClose])

  // Foco inicial no painel (acessibilidade / captura de teclado).
  useEffect(() => {
    if (!mounted || !open) return
    const id = requestAnimationFrame(() => panelRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [mounted, open])

  // Gesto de arraste no grabber. Listener nativo NÃO-passivo pra permitir
  // `preventDefault()` (React registra touchmove como passivo no root).
  useEffect(() => {
    const el = grabberRef.current
    if (!el) return
    let startY: number | null = null
    let delta = 0

    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY
      delta = 0
      setDragging(true)
    }
    const onMove = (e: TouchEvent) => {
      if (startY === null) return
      const d = e.touches[0].clientY - startY
      if (d > 0) {
        e.preventDefault() // impede a página/gesto de rolar enquanto puxa pra baixo
        delta = d
        setDragY(d)
      }
    }
    const onEnd = () => {
      if (startY === null) return
      startY = null
      setDragging(false)
      if (delta > CLOSE_THRESHOLD) onClose()
      else setDragY(0) // volta pro lugar (spring-back via transition)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [mounted, onClose])

  if (!mounted) return null

  const translateY = dragging
    ? `translateY(${dragY}px)`
    : shown
      ? 'translateY(0)'
      : 'translateY(100%)'

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:hidden" aria-hidden={!open}>
      {/* Backdrop — tap fecha */}
      <div
        onClick={onClose}
        className={`absolute inset-0 h-[100svh] bg-black/60 transition-opacity duration-300 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Painel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Filtros'}
        tabIndex={-1}
        style={{ transform: translateY }}
        className={`relative flex max-h-[85svh] min-h-[50svh] w-full flex-col rounded-t-2xl border-t border-[#1F2937] bg-[#0A0F1E] shadow-2xl outline-none ${
          dragging ? '' : 'transition-transform duration-300 ease-out'
        }`}
      >
        {/* Grabber (área de arraste) */}
        <div
          ref={grabberRef}
          role="button"
          aria-label="Arraste para baixo para fechar"
          className="tap-target--edge flex shrink-0 cursor-grab touch-none items-center justify-center pb-1 pt-3"
        >
          <span className="h-1.5 w-10 rounded-full bg-[#374151]" />
        </div>

        {/* Título + fechar */}
        {title && (
          <div className="flex shrink-0 items-center justify-between px-4 pb-2">
            <h2 className="text-base font-semibold text-white font-[family-name:var(--font-heading)]">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="tap-target--edge -mr-2 flex items-center justify-center text-gray-400 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>
        )}

        {/* Conteúdo rolável */}
        <div className="flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] pt-1">
          {children}
        </div>
      </div>
    </div>
  )
}
