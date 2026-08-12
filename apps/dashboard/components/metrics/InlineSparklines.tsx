'use client'

/**
 * Versão FIXA (não-hover) dos dois minigráficos, pra ficar abaixo dos cards da
 * Visão Geral: histórico 7d (sólido) + projeção 7d (tracejada + banda). Mesma
 * matemática de projeção do hover (projetarMetrica).
 */

import { useMemo } from 'react'
import { projetarMetrica, ultimosAtivos, type SeriePonto } from '@/lib/metrics/sparkline'
import { formatCurrency, formatCurrencyCompact, formatPercent, formatRoas, formatNumber } from '@/lib/formatters'

// Server Component NÃO pode passar função pra Client Component → recebemos uma
// chave de formato (string, serializável) e formatamos aqui.
export type SparkFormat = 'currency' | 'currencyCompact' | 'percent' | 'roas' | 'integer' | 'decimal'
function fmt(kind: SparkFormat, n: number): string {
  switch (kind) {
    case 'currency': return formatCurrency(n)
    case 'currencyCompact': return formatCurrencyCompact(n)
    case 'percent': return formatPercent(n)
    case 'roas': return formatRoas(n)
    case 'integer': return String(Math.round(n))
    case 'decimal': return formatNumber(n, 2)
  }
}

const W = 120
const H = 38
const PAD = 3

function scaleY(v: number, min: number, max: number): number {
  if (max === min) return H / 2
  return H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD)
}
function linePath(vals: (number | null)[], min: number, max: number): string {
  const n = vals.length
  const stepX = n > 1 ? (W - 2 * PAD) / (n - 1) : 0
  let d = ''; let pen = false
  vals.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { pen = false; return }
    const x = PAD + i * stepX; const y = scaleY(v, min, max)
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `; pen = true
  })
  return d.trim()
}
function bandPath(lo: number[], hi: number[], min: number, max: number): string {
  const n = lo.length; if (n === 0) return ''
  const stepX = n > 1 ? (W - 2 * PAD) / (n - 1) : 0
  let top = ''; let bot = ''
  for (let i = 0; i < n; i++) {
    const x = PAD + i * stepX
    top += `${i ? 'L' : 'M'}${x.toFixed(1)},${scaleY(hi[i], min, max).toFixed(1)} `
    bot = `L${x.toFixed(1)},${scaleY(lo[i], min, max).toFixed(1)} ` + bot
  }
  return `${top}${bot}Z`
}

function Chart({ titulo, vals, min, max, band, dashed, cor }: {
  titulo: string; vals: (number | null)[]; min: number; max: number
  band?: { lo: number[]; hi: number[] }; dashed?: boolean; cor: string
}) {
  return (
    <div className="flex-1">
      <p className="text-[8px] uppercase tracking-wider text-gray-400 mb-0.5">{titulo}</p>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
        {band && <path d={bandPath(band.lo, band.hi, min, max)} fill={cor} fillOpacity={0.12} />}
        <path d={linePath(vals, min, max)} fill="none" stroke={cor} strokeWidth={1.4}
          strokeDasharray={dashed ? '3 2' : undefined} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

export default function InlineSparklines({ history, hoje, dowFatores, format }: {
  history: SeriePonto[]; hoje: string; dowFatores?: number[]; format: SparkFormat
}) {
  const proj = useMemo(() => projetarMetrica(history, { hoje, dowFatores, horizon: 7 }), [history, hoje, dowFatores])
  // Últimos 7 dias ATIVOS (não calendário): ativo que não rodou na semana ainda
  // mostra a última janela em que rodou.
  const hist7 = useMemo(() => ultimosAtivos(history, 7), [history])
  const { min, max } = useMemo(() => {
    const nums: number[] = []
    for (const p of hist7) if (p.value != null && Number.isFinite(p.value)) nums.push(p.value)
    for (const p of proj.projection) nums.push(p.value, p.lo, p.hi)
    if (!nums.length) return { min: 0, max: 1 }
    let mn = Math.min(...nums); let mx = Math.max(...nums)
    if (mn === mx) { mn -= 1; mx += 1 }
    return { min: mn, max: mx }
  }, [hist7, proj])

  const temHist = hist7.length > 0
  if (!temHist) return null
  const projFim = proj.projection[proj.projection.length - 1]?.value ?? 0
  const projHoje = proj.projection[0]?.value ?? 0
  const tend = projFim > projHoje * 1.02 ? '↗' : projFim < projHoje * 0.98 ? '↘' : '→'
  const fimJanela = hist7[hist7.length - 1]?.date ?? ''
  const janelaAntiga = !!fimJanela && fimJanela < hoje
  const tituloHist = `Hist. ${hist7.length}d ativos${janelaAntiga ? `·até ${fimJanela.slice(8, 10)}/${fimJanela.slice(5, 7)}` : ''}`

  return (
    <div className="mt-2 pt-2 border-t border-[#1F2937]/70">
      <div className="flex items-end gap-2">
        <Chart titulo={tituloHist} vals={hist7.map((p) => p.value)} min={min} max={max} cor="#22d3ee" />
        <Chart titulo={`Proj. 7d ${tend}`} vals={proj.projection.map((p) => p.value)} min={min} max={max}
          band={{ lo: proj.projection.map((p) => p.lo), hi: proj.projection.map((p) => p.hi) }} dashed cor="#a78bfa" />
      </div>
      <p className="mt-1 text-[9px] text-gray-400 tabular-nums flex justify-between">
        <span>em 7d: <span className="text-purple-300">{fmt(format, projFim)}</span></span>
        <span>conf. {Math.round(proj.confidence * 100)}%</span>
      </p>
    </div>
  )
}
