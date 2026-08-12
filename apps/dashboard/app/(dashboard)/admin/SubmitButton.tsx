'use client'

import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Botão de submit com estado pending — evita duplo clique disparando a action
 * 2x (ex.: reset de senha, revogar sessão, salvar perfil). Precisa ser filho
 * de um <form action={...}>; useFormStatus só lê o form ancestral.
 */
export default function SubmitButton({
  children,
  pendingLabel,
  className = '',
}: {
  children: ReactNode
  pendingLabel: string
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {pending ? (
        <>
          <Loader2 size={13} className="animate-spin shrink-0" /> {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  )
}
