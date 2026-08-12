'use client'

import { useEffect, useState } from 'react'
import { Download, X, Share } from 'lucide-react'

interface BIPEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'pwa-install-dismissed'

/**
 * Banner discreto pra instalar o app. Android/desktop usam o beforeinstallprompt
 * nativo; iOS (que não expõe o evento) recebe a instrução manual. Some quando já
 * está instalado (standalone) ou depois de dispensado.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // já instalado?
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    if (standalone) return
    if (localStorage.getItem(DISMISS_KEY) === '1') return

    const ua = window.navigator.userAgent
    const ios = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua)
    setIsIOS(ios)

    const onBIP = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BIPEvent)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onBIP)

    // iOS não dispara beforeinstallprompt → mostra a dica manual
    if (ios) setShow(true)

    return () => window.removeEventListener('beforeinstallprompt', onBIP)
  }, [])

  if (!show) return null

  const dismiss = () => {
    setShow(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice.catch(() => null)
    setDeferred(null)
    dismiss()
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,420px)] rounded-xl border border-purple-400/30 bg-[#111827] shadow-2xl px-4 py-3 flex items-center gap-3">
      <div className="shrink-0 h-9 w-9 rounded-lg bg-purple-500/15 flex items-center justify-center text-purple-300">
        <Download size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">Instalar o app</p>
        {isIOS ? (
          <p className="text-[12px] text-gray-400 flex items-center gap-1">
            Toque em <Share size={12} className="inline" /> e “Adicionar à Tela de Início”.
          </p>
        ) : (
          <p className="text-[12px] text-gray-400">Acesso rápido na tela inicial, em tela cheia.</p>
        )}
      </div>
      {!isIOS && (
        <button
          onClick={install}
          className="shrink-0 text-[13px] px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-400/40 text-purple-200 hover:bg-purple-500/30"
        >
          Instalar
        </button>
      )}
      <button onClick={dismiss} title="Dispensar" className="shrink-0 p-1 rounded text-gray-500 hover:text-white">
        <X size={16} />
      </button>
    </div>
  )
}
