'use client'

import { useCallback, useEffect, useState, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  type FilterState, type Preset, EMPTY_FILTER, encodeFilter, decodeFilter, builtinPresets,
} from './tableFilters'

/**
 * Hook que gerencia o estado de filtros sincronizando com URL (?f=) e
 * (opcionalmente) localStorage pra persistir entre rotas (ex.: Criativos↔Campanhas).
 */
export function useTableFilters(opts?: { storageKey?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const storageKey = opts?.storageKey

  // Estado inicial: URL > localStorage > vazio
  const [filter, setFilterState] = useState<FilterState>(() => {
    if (typeof window === 'undefined') return EMPTY_FILTER
    const fromUrl = params?.get('f')
    if (fromUrl) return decodeFilter(fromUrl)
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) return JSON.parse(raw) as FilterState
      } catch { /* ignore */ }
    }
    return EMPTY_FILTER
  })

  // Sync state ↔ URL
  const updateUrl = useCallback((next: FilterState) => {
    const sp = new URLSearchParams(Array.from(params?.entries() ?? []))
    const enc = encodeFilter(next)
    if (enc) sp.set('f', enc)
    else sp.delete('f')
    const qs = sp.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [router, pathname, params])

  const setFilter = useCallback((next: FilterState | ((prev: FilterState) => FilterState)) => {
    setFilterState((prev) => {
      const computed = typeof next === 'function' ? (next as (p: FilterState) => FilterState)(prev) : next
      updateUrl(computed)
      if (storageKey) {
        try { localStorage.setItem(storageKey, JSON.stringify(computed)) } catch { /* ignore */ }
      }
      return computed
    })
  }, [updateUrl, storageKey])

  // Re-sync se a URL mudou externamente (ex.: voltar do browser)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const fromUrl = params?.get('f')
    const decoded = fromUrl ? decodeFilter(fromUrl) : EMPTY_FILTER
    setFilterState((prev) => {
      // Comparação rasa por encoded value pra evitar loop
      return encodeFilter(decoded) === encodeFilter(prev) ? prev : decoded
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.get('f')])

  const clear = useCallback(() => setFilter(EMPTY_FILTER), [setFilter])

  return { filter, setFilter, clear }
}

/**
 * Hook auxiliar pra gerenciar presets — built-in + customs (localStorage).
 */
export function usePresets(storageKey = 'demo-filter-presets') {
  const [customs, setCustoms] = useState<Preset[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setCustoms(JSON.parse(raw) as Preset[])
    } catch { /* ignore */ }
  }, [storageKey])

  const persist = useCallback((list: Preset[]) => {
    setCustoms(list)
    try { localStorage.setItem(storageKey, JSON.stringify(list)) } catch { /* ignore */ }
  }, [storageKey])

  const all = useMemo(() => [...builtinPresets(), ...customs], [customs])

  const save = useCallback((name: string, state: FilterState) => {
    const preset: Preset = { id: Math.random().toString(36).slice(2, 10), name, state }
    persist([...customs, preset])
    return preset
  }, [customs, persist])

  const remove = useCallback((id: string) => {
    persist(customs.filter((p) => p.id !== id))
  }, [customs, persist])

  const rename = useCallback((id: string, name: string) => {
    persist(customs.map((p) => p.id === id ? { ...p, name } : p))
  }, [customs, persist])

  return { presets: all, save, remove, rename }
}
