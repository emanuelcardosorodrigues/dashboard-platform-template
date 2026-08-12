'use client'

/**
 * E5 — Pull-to-refresh (plano mobile v2, Onda 4).
 *
 * Hook REUTILIZÁVEL de gesto: transforma "puxar pra baixo no topo" em um refresh.
 * Ele NÃO sabe o que "refresh" significa — quem chama passa `onRefresh` (disparado
 * ao soltar além do threshold) e `refreshing` (verdadeiro enquanto o refresh está
 * em voo). Isso desacopla o gesto do Next: no dashboard, o wrapper liga o
 * `onRefresh` a `router.refresh()` via `useTransition` e passa o `isPending` como
 * `refreshing`. Em qualquer outra tela, liga no que quiser.
 *
 * Regras (do escopo E5):
 *  - Só toque: touchstart / touchmove / touchend / touchcancel. Sem mouse, sem wheel.
 *  - Só quando o scroll REAL está no topo. O container de scroll não é o <main>
 *    (as páginas são `h-full` e rolam num div interno próprio), então descobrimos o
 *    scroller subindo a partir do alvo do toque — funciona pra qualquer layout.
 *  - Só quando habilitado (o wrapper passa `enabled={isMobile}`). No desktop nada
 *    é anexado, nada dispara.
 *  - Respeita `prefers-reduced-motion`: expõe `reduceMotion` pra quem desenha o
 *    indicador cortar a rotação/animação. (O globals.css já neutraliza
 *    transition/animation via !important; aqui é o reforço no JS.)
 *
 * O hook só mede a distância e a fase; o desenho do indicador é do componente.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMediaQuery } from './useMediaQuery'

export type PullPhase = 'idle' | 'pulling' | 'ready' | 'refreshing'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

interface UsePullToRefreshOptions {
  /** Disparado UMA vez ao soltar o dedo além do threshold. */
  onRefresh: () => void
  /** Verdadeiro enquanto o refresh está em voo — segura o indicador aberto. */
  refreshing: boolean
  /** Liga o gesto (o wrapper passa `isMobile`). Default `true`. */
  enabled?: boolean
  /** Distância (px de tela) que arma o refresh. Default 72. */
  threshold?: number
  /** Teto do arraste visual. Default 120. */
  maxPull?: number
}

interface UsePullToRefreshResult {
  /** Anexe no elemento que ENVOLVE o conteúdo rolável. */
  rootRef: React.RefObject<HTMLDivElement | null>
  /** Distância atual em px (0..maxPull) — dirige o indicador. */
  pull: number
  phase: PullPhase
  reduceMotion: boolean
}

/**
 * Sobe a partir de `start` até o `wrapper` procurando o ancestral que realmente
 * rola (overflow-y auto/scroll e conteúdo maior que a caixa). Se nenhum dentro da
 * subárvore do wrapper rolar, o próprio <main> (pai do wrapper) é o scroller.
 */
function findScrollContainer(start: Element | null, wrapper: HTMLElement | null): HTMLElement | null {
  let el = start as HTMLElement | null
  while (el && el !== wrapper) {
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el
    el = el.parentElement
  }
  return (wrapper?.parentElement as HTMLElement | null) ?? null
}

export function usePullToRefresh({
  onRefresh,
  refreshing,
  enabled = true,
  threshold = 72,
  maxPull = 120,
}: UsePullToRefreshOptions): UsePullToRefreshResult {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const reduceMotion = useMediaQuery(REDUCED_MOTION)

  // Espelhos em ref: os listeners nativos são anexados uma vez e não podem
  // enxergar props/estado "frescos" via closure sem re-anexar a cada render.
  const pullRef = useRef(0)
  const startYRef = useRef(0)
  const engagedRef = useRef(false) // puxando de fato (pra baixo, no topo)
  const candidateRef = useRef(false) // toque começou no topo, aguardando direção
  const scrollElRef = useRef<HTMLElement | null>(null)
  const refreshingRef = useRef(refreshing)
  const onRefreshRef = useRef(onRefresh)

  useEffect(() => { refreshingRef.current = refreshing }, [refreshing])
  useEffect(() => { onRefreshRef.current = onRefresh }, [onRefresh])

  const setPullSafe = useCallback((v: number) => {
    pullRef.current = v
    setPull(v)
  }, [])

  // Enquanto o refresh roda, segura o indicador aberto no threshold; quando
  // termina, recolhe pra 0. Isso é o "estado de carregando" do gesto.
  useEffect(() => {
    if (refreshing) setPullSafe(threshold)
    else if (!engagedRef.current) setPullSafe(0)
  }, [refreshing, threshold, setPullSafe])

  useEffect(() => {
    if (!enabled) return
    const node = rootRef.current
    if (!node) return

    // Curva de resistência: 1:1 amortecido até o threshold, mais duro depois,
    // com teto em maxPull. Dá a sensação de "elástico".
    const resist = (dy: number): number => {
      const raw = dy * 0.55
      const eased = raw <= threshold ? raw : threshold + (raw - threshold) * 0.4
      return Math.min(maxPull, eased)
    }

    const reset = () => {
      candidateRef.current = false
      engagedRef.current = false
    }

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return
      const scrollEl = findScrollContainer(e.target as Element | null, node)
      if (!scrollEl || scrollEl.scrollTop > 0) return // precisa começar no topo
      scrollElRef.current = scrollEl
      startYRef.current = e.touches[0].clientY
      candidateRef.current = true
      engagedRef.current = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!candidateRef.current || refreshingRef.current) return
      const scrollEl = scrollElRef.current
      const dy = e.touches[0].clientY - startYRef.current

      // Subiu o dedo, ou o conteúdo saiu do topo → devolve o gesto pro scroll nativo.
      if (dy <= 0 || (scrollEl && scrollEl.scrollTop > 0)) {
        if (engagedRef.current) setPullSafe(0)
        reset()
        return
      }

      engagedRef.current = true
      // Só agora tomamos o gesto: barra o overscroll/refresh nativo do browser.
      if (e.cancelable) e.preventDefault()
      setPullSafe(resist(dy))
    }

    const onTouchEnd = () => {
      candidateRef.current = false
      if (!engagedRef.current) return
      engagedRef.current = false
      if (pullRef.current >= threshold) {
        // Arma o refresh; o efeito de `refreshing` assume e segura o indicador.
        onRefreshRef.current()
      } else {
        setPullSafe(0) // não chegou lá: recolhe.
      }
    }

    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    node.addEventListener('touchend', onTouchEnd, { passive: true })
    node.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      node.removeEventListener('touchstart', onTouchStart)
      node.removeEventListener('touchmove', onTouchMove)
      node.removeEventListener('touchend', onTouchEnd)
      node.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [enabled, threshold, maxPull, setPullSafe])

  const phase: PullPhase = refreshing
    ? 'refreshing'
    : pull >= threshold
      ? 'ready'
      : pull > 0
        ? 'pulling'
        : 'idle'

  return { rootRef, pull, phase, reduceMotion }
}
