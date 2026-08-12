'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Auto-save endurecido (§7 do plano): fila sequencial por chave (não debounce puro),
 * último-valor-por-chave vence, retry com backoff, e flush no blur/visibilitychange/
 * beforeunload pra não perder edição pendente. `schedule(key, fn)` agenda um PATCH;
 * mutações de chaves diferentes (ex: cenários distintos) nunca se cancelam.
 */
export function useAutoSave(debounceMs = 300) {
  const pending = useRef(new Map<string, () => Promise<void>>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const running = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [pendingCount, setPendingCount] = useState(0)

  const flush = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (pending.current.size > 0) {
        setStatus('saving')
        const entry = pending.current.entries().next().value
        if (!entry) break
        const [key, fn] = entry
        pending.current.delete(key)
        setPendingCount(pending.current.size)
        let ok = false
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try { await fn(); ok = true } catch { await new Promise((r) => setTimeout(r, 300 * (attempt + 1))) }
        }
        if (!ok) { setStatus('error'); return }
      }
      setStatus(pending.current.size === 0 ? 'saved' : 'saving')
    } finally {
      running.current = false
      if (pending.current.size > 0) void flush() // chegou item durante o flush
    }
  }, [])

  const schedule = useCallback((key: string, fn: () => Promise<void>) => {
    pending.current.set(key, fn)
    setPendingCount(pending.current.size)
    setStatus('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, debounceMs)
  }, [flush, debounceMs])

  useEffect(() => {
    const onHide = () => { if (pending.current.size > 0) void flush() }
    const onVis = () => { if (document.visibilityState === 'hidden') onHide() }
    window.addEventListener('beforeunload', onHide)
    window.addEventListener('blur', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      window.removeEventListener('blur', onHide)
      document.removeEventListener('visibilitychange', onVis)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [flush])

  return { status, pendingCount, schedule, flush }
}
