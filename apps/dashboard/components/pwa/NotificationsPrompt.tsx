'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const DISMISS = 'push-prompt-dismissed'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new ArrayBuffer(raw.length)
  const arr = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

/** Banner discreto pra ativar push. Some se não suportar, já concedeu/negou, ou dispensado. */
export default function NotificationsPrompt() {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !VAPID) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
    if (Notification.permission !== 'default') return // granted (já inscrito) ou denied
    if (localStorage.getItem(DISMISS) === '1') return
    setShow(true)
  }, [])

  if (!show) return null

  const dismiss = () => {
    setShow(false)
    try { localStorage.setItem(DISMISS, '1') } catch { /* ignore */ }
  }

  const enable = async () => {
    if (!VAPID) return
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { dismiss(); return }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      })
      const json = sub.toJSON()
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
      // push de confirmação na hora
      await fetch('/api/push/test', { method: 'POST' }).catch(() => {})
      setShow(false)
    } catch {
      /* ignore — nunca quebra a página */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[min(92vw,360px)] rounded-xl border border-purple-400/30 bg-[#111827] shadow-2xl px-4 py-3 flex items-center gap-3">
      <div className="shrink-0 h-9 w-9 rounded-lg bg-purple-500/15 flex items-center justify-center text-purple-300">
        <Bell size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">Ativar notificações</p>
        <p className="text-[12px] text-gray-400">Vendas, alertas e resumo diário no celular.</p>
      </div>
      <button
        onClick={enable}
        disabled={busy}
        className="shrink-0 text-[13px] px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-400/40 text-purple-200 hover:bg-purple-500/30 disabled:opacity-50"
      >
        {busy ? '…' : 'Ativar'}
      </button>
      <button onClick={dismiss} title="Agora não" className="shrink-0 p-1 rounded text-gray-500 hover:text-white">
        <X size={16} />
      </button>
    </div>
  )
}
