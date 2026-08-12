'use client'

import { useState } from 'react'
import { Copy, Check, AlertTriangle } from 'lucide-react'

type CopyState = 'idle' | 'copied' | 'failed'

export default function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<CopyState>('idle')

  async function handleCopy() {
    let ok = true
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      // navigator.clipboard pode falhar em contextos não-https — o segredo só
      // aparece 1x, então a falha precisa ficar visível (não engolir em silêncio).
      ok = false
      setState('failed')
    }
    // Falha fica visível mais tempo (o admin pode precisar reler antes de agir).
    setTimeout(() => setState('idle'), ok ? 1500 : 4000)
  }

  const label =
    state === 'copied'
      ? 'Copiado!'
      : state === 'failed'
      ? 'Falha ao copiar — selecione o texto acima e copie manualmente'
      : 'Copiar senha'

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`p-2 rounded-lg border transition-colors ${
        state === 'failed'
          ? 'border-rose-500/40 text-rose-300 hover:bg-rose-500/10'
          : 'border-amber-500/30 text-amber-300 hover:bg-amber-500/10'
      }`}
      aria-label={label}
      title={label}
    >
      {state === 'copied' ? <Check size={14} /> : state === 'failed' ? <AlertTriangle size={14} /> : <Copy size={14} />}
    </button>
  )
}
