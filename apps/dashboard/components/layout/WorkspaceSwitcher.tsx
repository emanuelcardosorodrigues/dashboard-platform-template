'use client'

import { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Check } from 'lucide-react'

export interface WorkspaceLite {
  id: string
  slug: string
  nome: string
  logo_url: string | null
}

/** Iniciais do projeto (antes do travessão): "Cliente Exemplo — dashboard-demo" → "LS". */
function initials(nome: string): string {
  const base = nome.replace(/[—–-].*$/, '').trim()
  const words = base.split(/\s+/).filter(Boolean)
  const ini = words.slice(0, 2).map((w) => w[0]).join('')
  return (ini || base.slice(0, 2)).toUpperCase()
}

/** Nome curto pra exibição (antes do travessão). */
function shortName(nome: string): string {
  return nome.replace(/\s*[—–-]\s*.*$/, '').trim() || nome
}

const ACTIVE_WS_COOKIE = 'active_ws'

export default function WorkspaceSwitcher({
  active,
  workspaces,
  expanded,
}: {
  active: WorkspaceLite | null
  workspaces: WorkspaceLite[]
  expanded: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const canSwitch = workspaces.length > 1

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function select(id: string) {
    if (id === active?.id) { setOpen(false); return }
    // O cookie é só PREFERÊNCIA — o servidor valida contra a membership
    // (getActiveWorkspaceId). Por isso pode ser setado no client sem risco.
    document.cookie = `${ACTIVE_WS_COOKIE}=${id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    // INTENCIONAL: full reload garante que o router cache do client não vaza
    // dados entre workspaces (não trocar por router.refresh()).
    window.location.reload()
  }

  const Logo = active?.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={active.logo_url} alt={active.nome} className="w-7 h-7 rounded object-cover shrink-0" />
  ) : (
    <span className="text-sm font-bold text-white font-[family-name:var(--font-heading)] shrink-0 w-7 h-7 grid place-items-center rounded bg-[#1F2937] select-none">
      {active ? initials(active.nome) : '—'}
    </span>
  )

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => canSwitch && setOpen((v) => !v)}
        disabled={!canSwitch}
        className={clsx(
          'flex items-center gap-3 w-full overflow-hidden rounded-md px-1 py-1 -mx-1 transition-colors',
          canSwitch && 'hover:bg-[#1F2937] cursor-pointer',
        )}
        title={active ? `${active.nome}${canSwitch ? ' · trocar projeto' : ''}` : 'Projeto'}
        aria-label="Projeto ativo"
      >
        {Logo}
        <span
          className={clsx(
            'text-sm font-semibold text-white truncate font-[family-name:var(--font-heading)] flex-1 text-left transition-all duration-200',
            expanded ? 'opacity-100' : 'opacity-0 w-0',
          )}
        >
          {active ? shortName(active.nome) : 'Projeto'}
        </span>
        {expanded && canSwitch && <ChevronDown size={14} className="shrink-0 text-gray-500" />}
      </button>

      {open && canSwitch && (
        <div className="absolute left-0 top-full mt-1 w-56 z-50 rounded-lg border border-[#1F2937] bg-[#0F172A] shadow-xl py-1">
          <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">Projetos</p>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => select(w.id)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-200 hover:bg-[#131c2e] text-left"
            >
              {w.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.logo_url} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
              ) : (
                <span className="w-5 h-5 grid place-items-center rounded bg-[#1F2937] text-[10px] font-bold shrink-0">{initials(w.nome)}</span>
              )}
              <span className="truncate flex-1">{shortName(w.nome)}</span>
              {w.id === active?.id && <Check size={13} className="text-emerald-400 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
