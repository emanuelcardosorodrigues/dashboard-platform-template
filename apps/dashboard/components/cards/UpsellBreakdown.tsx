'use client'

import { clsx } from 'clsx'

interface UpsellBreakdownProps {
  vendasFront: number
  vendasUpsell: number
  vendasDownsell: number
  taxaUpsell: number      // vendasUpsell / vendasFront * 100
  taxaDownsell: number    // vendasDownsell / max(vendasFront - vendasUpsell, 0) * 100
  upsellLabel?: string    // ex: "Implementação Lucro Oculto"
  downsellLabel?: string  // ex: "Implementação Express Lucro Oculto"
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '–'
  return `${n.toFixed(1).replace('.', ',')}%`
}

// Verde ≥ 20% (excelente em upsell pós-compra), amarelo ≥ 8%, vermelho < 8%
function colorForRate(rate: number): string {
  if (rate >= 20) return 'text-emerald-400'
  if (rate >= 8) return 'text-amber-300'
  return 'text-gray-400'
}

export default function UpsellBreakdown({
  vendasFront,
  vendasUpsell,
  vendasDownsell,
  taxaUpsell,
  taxaDownsell,
  upsellLabel = 'Upsell',
  downsellLabel = 'Downsell',
}: UpsellBreakdownProps) {
  const elegivelDownsell = Math.max(vendasFront - vendasUpsell, 0)

  return (
    <div className="rounded-xl bg-[#111827] border border-[#1F2937] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1F2937]">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Upsell e Downsell</p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Vendas pós-compra do funil — calculadas em cima de {vendasFront} venda{vendasFront === 1 ? '' : 's'} front
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1F2937]">
        <div className="px-4 py-3">
          <p className="text-[12px] text-gray-300 truncate" title={upsellLabel}>{upsellLabel}</p>
          <p className={clsx('text-2xl font-bold tabular-nums mt-1', colorForRate(taxaUpsell))}>
            {fmtPct(taxaUpsell)}
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {vendasUpsell} de {vendasFront} compradores front
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[12px] text-gray-300 truncate" title={downsellLabel}>{downsellLabel}</p>
          <p className={clsx('text-2xl font-bold tabular-nums mt-1', colorForRate(taxaDownsell))}>
            {fmtPct(taxaDownsell)}
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {vendasDownsell} de {elegivelDownsell} que rejeitaram o upsell
          </p>
        </div>
      </div>
    </div>
  )
}
