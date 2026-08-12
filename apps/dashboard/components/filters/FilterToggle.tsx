'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Filter } from 'lucide-react'
import DateRangePicker from '@/components/layout/DateRangePicker'
import { todayBR, daysAgoBR } from '@/lib/formatters'
import { useFunilOptions } from '@/lib/useFunis'

// MESMO modelo visual/UX do Header (pills de funil + presets + date pickers).
const todayStr = () => todayBR()
const daysAgoStr = (n: number) => daysAgoBR(n)

const PRESETS = [
  { label: 'Hoje', de: () => todayStr(), ate: () => todayStr() },
  { label: 'Ontem', de: () => daysAgoStr(1), ate: () => daysAgoStr(1) },
  { label: '7d', de: () => daysAgoStr(7), ate: () => todayStr() },
  { label: '30d', de: () => daysAgoStr(30), ate: () => todayStr() },
  { label: '90d', de: () => daysAgoStr(90), ate: () => todayStr() },
  { label: 'Tudo', de: () => '2026-01-01', ate: () => todayStr() },
]

/**
 * Filtro próprio da aba (data + funil) com o MESMO visual/UX do Header.
 * Checkbox "usar filtro geral": ON (default) segue de/ate/funil globais e os controles
 * ficam inertes (mostrando o valor do topo); OFF ativa o filtro exclusivo da aba,
 * persistido na URL com prefixo (`${p}De/${p}Ate/${p}Funil/${p}UsarGeral`).
 */
export default function FilterToggle({ prefix, showFunil = true }: { prefix: string; showFunil?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const funilOptions = useFunilOptions()
  const k = (s: string) => `${prefix}${s}`

  const usarGeral = (sp.get(k('UsarGeral')) ?? 'on') !== 'off'
  const gDe = sp.get('de') ?? ''
  const gAte = sp.get('ate') ?? ''
  const gFunil = sp.get('funil') ?? 'all'
  const de = usarGeral ? gDe : (sp.get(k('De')) ?? gDe)
  const ate = usarGeral ? gAte : (sp.get(k('Ate')) ?? gAte)
  const funil = usarGeral ? gFunil : (sp.get(k('Funil')) ?? gFunil)

  function set(updates: Record<string, string>) {
    const params = new URLSearchParams(sp.toString())
    for (const [kk, v] of Object.entries(updates)) {
      if (v === '') params.delete(kk)
      else params.set(kk, v)
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }
  const isPresetActive = (p: typeof PRESETS[0]) => de === p.de() && ate === p.ate()
  const inert = usarGeral

  return (
    <div className="flex items-center flex-wrap gap-3 bg-[#0A0F1E] border border-[#1F2937] rounded-xl px-4 py-2.5">
      {/* Toggle usar geral */}
      <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none pr-1">
        <input
          type="checkbox"
          checked={usarGeral}
          onChange={(e) => set({ [k('UsarGeral')]: e.target.checked ? '' : 'off' })}
          className="accent-cyan-500"
        />
        Usar filtro geral
      </label>

      <div className={`flex items-center flex-wrap gap-3 ${inert ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* Funil — mesmas pills do Header */}
        {showFunil && (
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-gray-500" />
            <div className="flex items-center rounded-lg bg-[#111827] border border-[#1F2937] overflow-hidden">
              {funilOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set({ [k('Funil')]: opt.value })}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    funil === opt.value ? 'bg-[#374151] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Presets — mesma barra do Header */}
        <div className="flex items-center rounded-lg bg-[#111827] border border-[#1F2937] overflow-hidden">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => set({ [k('De')]: p.de(), [k('Ate')]: p.ate() })}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                isPresetActive(p)
                  ? 'bg-cyan-500/20 text-cyan-400 border-x border-cyan-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Date pickers — mesmos do Header */}
        <DateRangePicker value={de} onChange={(v) => set({ [k('De')]: v })} ariaLabel="Data de início (aba)" />
        <span className="text-xs text-gray-500">até</span>
        <DateRangePicker value={ate} onChange={(v) => set({ [k('Ate')]: v })} ariaLabel="Data de fim (aba)" />
      </div>
    </div>
  )
}
