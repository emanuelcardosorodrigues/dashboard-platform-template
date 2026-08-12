'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Megaphone, Layers, Image as ImageIcon, X } from 'lucide-react'

/**
 * Recorte em cascata Campanha → Conjunto → Anúncio (Meta Ads), estado na URL.
 * Trocar a campanha zera conjunto+anúncio; trocar o conjunto zera o anúncio.
 * As opções já chegam cascateadas do server (buildCascadeOptions).
 */
export default function CascadeFilter({
  campanhas, conjuntos, anuncios, campanha, conjunto, anuncio,
}: {
  campanhas: string[]; conjuntos: string[]; anuncios: string[]
  campanha: string; conjunto: string; anuncio: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  function nav(updates: Record<string, string>, remove: string[] = []) {
    const params = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (!v || v === 'all') params.delete(k)
      else params.set(k, v)
    }
    for (const k of remove) params.delete(k)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const ativo = campanha !== 'all' || conjunto !== 'all' || anuncio !== 'all'

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
      <Campo
        icon={<Megaphone size={13} />}
        label="Campanha"
        value={campanha}
        options={campanhas}
        onChange={(v) => nav({ campanha: v }, ['conjunto', 'anuncio'])}
      />
      <Campo
        icon={<Layers size={13} />}
        label="Conjunto"
        value={conjunto}
        options={conjuntos}
        disabled={campanha === 'all' && conjuntos.length > 40}
        onChange={(v) => nav({ conjunto: v }, ['anuncio'])}
      />
      <Campo
        icon={<ImageIcon size={13} />}
        label="Anúncio"
        value={anuncio}
        options={anuncios}
        onChange={(v) => nav({ anuncio: v })}
      />
      {ativo && (
        <button
          onClick={() => nav({}, ['campanha', 'conjunto', 'anuncio'])}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white transition-colors cursor-pointer"
        >
          <X size={12} /> limpar recorte
        </button>
      )}
    </div>
  )
}

function Campo({
  icon, label, value, options, onChange, disabled = false,
}: {
  icon: React.ReactNode; label: string; value: string; options: string[]
  onChange: (v: string) => void; disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-2 min-w-0">
      <span className="flex items-center gap-1 text-[11px] text-gray-500 shrink-0">{icon}{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        title={value !== 'all' ? value : undefined}
        className="max-w-[220px] truncate bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-cyan-500/60 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <option value="all">Todos{options.length ? ` (${options.length})` : ''}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}
