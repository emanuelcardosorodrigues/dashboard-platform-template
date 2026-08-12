'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'

interface TakeRateBreakdownProps {
  takeRateOB: number
  takeRateOB1: number
  takeRateOB2: number
  takeRateOB3: number
  takeRateOB4: number
  vendasFront: number
  vendasOB1: number
  vendasOB2: number
  vendasOB3: number
  vendasOB4: number
}

const OB_LABEL: Record<'ob1' | 'ob2' | 'ob3' | 'ob4', string> = {
  ob1: 'OB1 — Script Anti-Desconto',
  ob2: 'OB2 — Lucro Tributário',
  ob3: 'OB3 — Dentista Parceiro',
  ob4: 'OB4 — Manual Lucro Oculto',
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '–'
  return `${n.toFixed(1).replace('.', ',')}%`
}

export default function TakeRateBreakdown({
  takeRateOB,
  takeRateOB1,
  takeRateOB2,
  takeRateOB3,
  takeRateOB4,
  vendasFront,
  vendasOB1,
  vendasOB2,
  vendasOB3,
  vendasOB4,
}: TakeRateBreakdownProps) {
  const [open, setOpen] = useState(false)
  const items = [
    { key: 'ob1' as const, rate: takeRateOB1, vendas: vendasOB1 },
    { key: 'ob2' as const, rate: takeRateOB2, vendas: vendasOB2 },
    { key: 'ob3' as const, rate: takeRateOB3, vendas: vendasOB3 },
    { key: 'ob4' as const, rate: takeRateOB4, vendas: vendasOB4 },
  ].sort((a, b) => b.rate - a.rate)

  return (
    <div className="rounded-xl bg-[#111827] border border-[#1F2937] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#1F2937]/60 transition-colors"
        aria-expanded={open}
      >
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Take Rate OBs</p>
          <p className="text-2xl font-bold tabular-nums text-white mt-0.5">{fmtPct(takeRateOB)}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {vendasOB1 + vendasOB2 + vendasOB3 + vendasOB4} OBs / {vendasFront} vendas FE
          </p>
        </div>
        {open ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-[#1F2937] divide-y divide-[#1F2937]">
          {items.map((it) => (
            <div key={it.key} className="px-4 py-2.5 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-gray-300 truncate">{OB_LABEL[it.key]}</p>
                <p className="text-[10px] text-gray-500">{it.vendas} vendas</p>
              </div>
              <span
                className={clsx(
                  'text-sm font-semibold tabular-nums shrink-0',
                  it.rate >= 30 ? 'text-emerald-400' : it.rate >= 10 ? 'text-amber-300' : 'text-gray-400'
                )}
              >
                {fmtPct(it.rate)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
