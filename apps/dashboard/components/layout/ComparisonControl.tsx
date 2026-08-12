'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { GitCompare, ChevronDown, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { type CompareMode, COMPARE_MODE_LABEL, parseCompareMode, computeComparisonRange } from '@/lib/comparePeriods'
import DateRangePicker from './DateRangePicker'

const OPTIONS: CompareMode[] = ['none', 'prev', 'prev_month', 'prev_year', 'custom']

export default function ComparisonControl() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const mode = parseCompareMode(params.get('cmp'))
  const cmpDe = params.get('cmpDe') ?? ''
  const cmpAte = params.get('cmpAte') ?? ''
  const de = params.get('de') ?? ''
  const ate = params.get('ate') ?? ''

  const previewRange = computeComparisonRange(de, ate, mode, cmpDe, cmpAte)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function update(patch: Record<string, string>) {
    const sp = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === '') sp.delete(k); else sp.set(k, v)
    }
    router.push(`${pathname}?${sp.toString()}`)
  }

  function setMode(next: CompareMode) {
    if (next === 'none') {
      update({ cmp: '', cmpDe: '', cmpAte: '' })
    } else if (next === 'custom') {
      // garante que tem valores iniciais — usa current range como fallback
      update({ cmp: 'custom', cmpDe: cmpDe || de, cmpAte: cmpAte || ate })
    } else {
      update({ cmp: next, cmpDe: '', cmpAte: '' })
    }
  }

  const active = mode !== 'none'

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer',
          active
            ? 'bg-cyan-500/15 border border-cyan-500/40 text-cyan-300'
            : 'bg-[#111827] border border-[#1F2937] text-gray-300 hover:border-cyan-500/40'
        )}
        title={previewRange ? `Comparando com ${previewRange.from} → ${previewRange.to}` : 'Ativar comparação entre períodos'}
      >
        <GitCompare size={12} />
        <span>{active ? COMPARE_MODE_LABEL[mode] : 'Comparar'}</span>
        <ChevronDown size={12} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-50 w-72 bg-[#0A0F1E] border border-[#1F2937] rounded-xl shadow-2xl p-1.5">
          {OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => { setMode(opt); if (opt !== 'custom') setOpen(false) }}
              className={clsx(
                'flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors',
                mode === opt ? 'bg-cyan-500/15 text-cyan-300' : 'text-gray-300 hover:bg-[#1F2937]/60'
              )}
            >
              <span>{COMPARE_MODE_LABEL[opt]}</span>
              {mode === opt && <Check size={11} className="text-cyan-400" />}
            </button>
          ))}

          {mode === 'custom' && (
            <div className="border-t border-[#1F2937] mt-1.5 pt-2 px-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 w-8">de</span>
                <DateRangePicker value={cmpDe} onChange={(v) => update({ cmpDe: v })} ariaLabel="Comparação de" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 w-8">até</span>
                <DateRangePicker value={cmpAte} onChange={(v) => update({ cmpAte: v })} ariaLabel="Comparação até" />
              </div>
            </div>
          )}

          {previewRange && (
            <div className="border-t border-[#1F2937] mt-1.5 pt-2 px-2.5 pb-1">
              <p className="text-[10px] text-gray-500">Comparando com</p>
              <p className="text-xs text-cyan-300 tabular-nums">{previewRange.from} → {previewRange.to}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
