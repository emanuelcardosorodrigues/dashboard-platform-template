'use client'

/**
 * F0.1 — Hook de media query (plano mobile v2, Onda 1).
 *
 * Pré-requisito de toda a seção C: Recharts precisa de PROPS (interval, aspect,
 * fontSize, activeDot) e não só de CSS, então a variante mobile de um gráfico só
 * existe se o React souber, em runtime, se está abaixo do breakpoint `md`.
 *
 * SSR-safe SEM mismatch de hidratação: usamos `useSyncExternalStore`. Durante a
 * hidratação o React renderiza com `getServerSnapshot()` (sempre `false`),
 * casando byte-a-byte com o HTML do servidor; logo após, ele re-renderiza com o
 * valor real de `matchMedia`. A diferença NÃO vira erro de hidratação — vira um
 * re-render agendado, que é exatamente o contrato do `useSyncExternalStore`.
 *
 * Consequência de design: o primeiro paint no celular mostra o layout "desktop"
 * por um frame e então reflui pro mobile. É o preço de não ter mismatch, e é
 * imperceptível porque os gráficos (ResponsiveContainer) só medem o container no
 * cliente de qualquer jeito.
 */

import { useSyncExternalStore, useCallback } from 'react'

function subscribeTo(query: string) {
  return (onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mql = window.matchMedia(query)
    // Safari < 14 só tem addListener; cobrimos os dois caminhos.
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }
}

/**
 * Retorna `true` quando a media query bate. Estável no servidor (`false`) e
 * reativo no cliente.
 *
 * @example const isMobile = useMediaQuery('(max-width: 767.98px)')
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(subscribeTo(query), [query])

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  }, [query])

  // Servidor e primeiro render do cliente: sempre desktop → nunca há mismatch.
  const getServerSnapshot = () => false

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Breakpoint canônico do app. O Tailwind usa `md = 768px`, e todo `md:` do
 * projeto vale a partir de 768px; logo "mobile" é estritamente `< 768px`.
 * Manter este número casado com o `@media (min-width: 768px)` do globals.css é
 * o que garante que JS e CSS concordem sobre onde o desktop começa.
 */
export const MOBILE_MAX_WIDTH = '(max-width: 767.98px)'

/**
 * Açúcar pra `useMediaQuery(MOBILE_MAX_WIDTH)`. Use este nos gráficos: quando
 * `false`, o componente DEVE renderizar exatamente o que o desktop já via.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MAX_WIDTH)
}
