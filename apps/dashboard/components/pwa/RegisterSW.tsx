'use client'

import { useEffect } from 'react'

/** Registra o service worker (PWA). Falha silenciosa — nunca quebra a página. */
export default function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const onLoad = () => navigator.serviceWorker.register('/sw.js').catch(() => {})
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })
  }, [])
  return null
}
