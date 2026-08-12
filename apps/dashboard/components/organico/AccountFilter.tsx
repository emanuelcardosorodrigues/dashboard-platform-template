'use client'

/**
 * Filtro de conta do Orgânico — pills "Todas" + uma por conta conectada
 * (avatar pequeno + @handle). Seta `?conta=<external_id>` na URL preservando
 * os demais params. Só renderiza com ≥2 contas (1 conta = sem filtro, não polui).
 * Visual = mesmas pills do Header (bg-white/5 border, ativo bg-blue-600).
 */
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export interface AccountFilterAccount {
  id: string
  external_id: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
  platform: string
}

export default function AccountFilter({ accounts }: { accounts: AccountFilterAccount[] }) {
  const router = useRouter()
  const sp = useSearchParams()
  // Conta = contexto global persistido em cookie; destaque segue a URL ou o cookie.
  const [contaCookie, setContaCookie] = useState('')
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)organico_conta=([^;]*)/)
    setContaCookie(m ? decodeURIComponent(m[1]) : '')
  }, [])
  const atual = sp.get('conta') || contaCookie

  // 1 conta (ou nenhuma) = sem filtro pra não poluir.
  if (accounts.length < 2) return null

  // Trocar de conta = trocar de contexto → grava o cookie e vai pra Visão Geral.
  function selecionar(externalId: string) {
    try {
      document.cookie = `organico_conta=${encodeURIComponent(externalId)}; path=/; max-age=${externalId ? 31536000 : 0}`
    } catch { /* ignore */ }
    setContaCookie(externalId)
    router.push(externalId ? `/organico/visao-geral?conta=${encodeURIComponent(externalId)}` : '/organico/visao-geral')
  }

  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs border transition-colors ${active
      ? 'bg-blue-600 border-blue-500 text-white'
      : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'}`

  const rotulo = (a: AccountFilterAccount) =>
    a.handle ? `@${a.handle}` : (a.display_name || a.external_id)

  return (
    <div className="flex items-center flex-wrap gap-1.5">
      <span className="text-[11px] text-gray-500 uppercase tracking-wider mr-1">Conta</span>
      <button onClick={() => selecionar('')} className={pill(atual === '')}>
        Todas
      </button>
      {accounts.map((a) => (
        <button
          key={a.id}
          onClick={() => selecionar(a.external_id)}
          className={pill(atual === a.external_id)}
          title={a.display_name || rotulo(a)}
        >
          {a.avatar_url
            ? // eslint-disable-next-line @next/next/no-img-element
              <img src={a.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
            : <span className="w-4 h-4 rounded-full bg-white/15 inline-block" />}
          <span className="max-w-[10rem] truncate">{rotulo(a)}</span>
        </button>
      ))}
    </div>
  )
}
