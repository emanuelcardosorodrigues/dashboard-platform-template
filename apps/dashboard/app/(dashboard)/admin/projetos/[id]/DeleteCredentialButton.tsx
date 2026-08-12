'use client'

import { useState, useTransition } from 'react'
import { Trash2, Check, X } from 'lucide-react'
import { deleteCredentialAction } from '../actions'

/**
 * Remove a credencial de integração de um provider — ação destrutiva e
 * IRREVERSÍVEL num segredo que pode estar em uso (integração viva). Exige
 * confirmação de dois cliques on-theme antes de disparar a server action.
 */
export default function DeleteCredentialButton({
  workspaceId,
  provider,
}: {
  workspaceId: string
  provider: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  const confirmar = () => {
    const fd = new FormData()
    fd.set('workspace_id', workspaceId)
    fd.set('provider', provider)
    startTransition(() => {
      deleteCredentialAction(fd)
    })
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 text-xs text-rose-400/80 hover:text-rose-400"
      >
        <Trash2 size={12} /> remover credenciais
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-rose-300">Confirmar?</span>
      <button
        type="button"
        onClick={confirmar}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Check size={11} /> {pending ? 'Removendo…' : 'Sim'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-gray-400 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X size={11} /> Cancelar
      </button>
    </span>
  )
}
