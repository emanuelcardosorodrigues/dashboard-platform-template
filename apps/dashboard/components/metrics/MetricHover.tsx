'use client'

/**
 * Hover numa célula de métrica → popover com DOIS minigráficos:
 *  • Histórico: últimos 7 dias reais (a partir de ontem) — linha sólida.
 *  • Projeção: próximos 7 dias (a partir de hoje) — linha tracejada + banda de
 *    confiança. Calculada por projetarMetrica (tendência encolhida + sazonalidade).
 *
 * Recebe a série COMPLETA (até ~30 dias) pra ajustar a projeção, mas só exibe os
 * últimos 7 no gráfico de histórico. Popover via portal + position:fixed (não é
 * cortado pelo overflow-x da tabela), igual ColumnHeaderInfo.
 */

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { projetarMetrica, ultimosAtivos, type SeriePonto } from '@/lib/metrics/sparkline'

const OPEN_DELAY_MS = 250
const W = 132
const H = 46
const PAD = 4

interface Props {
  history: SeriePonto[]
  hoje: string
  label: string
  format: (n: number) => string
  dowFatores?: number[]
  /** Valor agregado do período (das métricas que influenciam esta) — base da
   *  projeção quando o ativo não tem nenhum dia com a métrica calculável. */
  fallback?: number | null
  children: ReactNode
}

const fmtDM = (iso: string) => (iso?.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '')

function scaleY(v: number, min: number, max: number): number {
  if (max === min) return H / 2
  return H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD)
}

/** Polyline a partir de valores; quebra em null. */
function linePath(vals: (number | null)[], min: number, max: number): string {
  const n = vals.length
  const stepX = n > 1 ? (W - 2 * PAD) / (n - 1) : 0
  let d = ''
  let pen = false
  vals.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { pen = false; return }
    const x = PAD + i * stepX
    const y = scaleY(v, min, max)
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `
    pen = true
  })
  return d.trim()
}

function bandPath(lo: number[], hi: number[], min: number, max: number): string {
  const n = lo.length
  if (n === 0) return ''
  const stepX = n > 1 ? (W - 2 * PAD) / (n - 1) : 0
  let top = ''
  let bot = ''
  for (let i = 0; i < n; i++) {
    const x = PAD + i * stepX
    top += `${i ? 'L' : 'M'}${x.toFixed(1)},${scaleY(hi[i], min, max).toFixed(1)} `
    bot = `L${x.toFixed(1)},${scaleY(lo[i], min, max).toFixed(1)} ` + bot
  }
  return `${top}${bot}Z`
}

function MiniChart({ titulo, vals, min, max, band, dashed, cor }: {
  titulo: string
  vals: (number | null)[]
  min: number
  max: number
  band?: { lo: number[]; hi: number[] }
  dashed?: boolean
  cor: string
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">{titulo}</p>
      <svg width={W} height={H} className="block">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#1F2937" strokeWidth={1} />
        {band && <path d={bandPath(band.lo, band.hi, min, max)} fill={cor} fillOpacity={0.12} stroke="none" />}
        <path d={linePath(vals, min, max)} fill="none" stroke={cor} strokeWidth={1.5}
          strokeDasharray={dashed ? '3 2' : undefined} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

export default function MetricHover({ history, hoje, label, format, dowFatores, fallback, children }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const proj = useMemo(
    () => projetarMetrica(history, { hoje, dowFatores, horizon: 7, fallback }),
    [history, hoje, dowFatores, fallback],
  )

  // Janela = últimos 7 dias ATIVOS do ativo (não calendário): se ele não rodou
  // nos últimos 7 dias, mostra os últimos 7 em que rodou — ou menos, se rodou menos.
  const hist7 = useMemo(() => ultimosAtivos(history, 7), [history])

  const { min, max } = useMemo(() => {
    const nums: number[] = []
    for (const p of hist7) if (p.value != null && Number.isFinite(p.value)) nums.push(p.value)
    for (const p of proj.projection) { nums.push(p.value, p.lo, p.hi) }
    if (nums.length === 0) return { min: 0, max: 1 }
    let mn = Math.min(...nums)
    let mx = Math.max(...nums)
    if (mn === mx) { mn -= 1; mx += 1 }
    return { min: mn, max: mx }
  }, [hist7, proj])

  const place = useCallback(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 300))
    const top = r.bottom + 6 + 170 > window.innerHeight ? r.top - 176 : r.bottom + 6
    setCoords({ top, left })
  }, [])

  const onEnter = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { place(); setOpen(true) }, OPEN_DELAY_MS)
  }, [place])
  const onLeave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
  }, [])

  const temHist = hist7.length > 0
  const temProjecao = proj.basis !== 'sem-dados'
  const confPct = Math.round(proj.confidence * 100)
  const projHoje = proj.projection[0]?.value ?? 0
  const projFim = proj.projection[proj.projection.length - 1]?.value ?? 0
  const tendencia = projFim > projHoje * 1.02 ? '↗' : projFim < projHoje * 0.98 ? '↘' : '→'
  // Rótulo honesto da janela: "7d ativos"; se a janela acabou antes de ontem,
  // mostra até quando ("até DD/MM") pra deixar claro que o ativo não roda hoje.
  const fimJanela = hist7[hist7.length - 1]?.date ?? ''
  const janelaAntiga = !!fimJanela && fimJanela < hoje
  const tituloHist = `Últimos ${hist7.length}d ativos${janelaAntiga ? ` · até ${fmtDM(fimJanela)}` : ''}`

  return (
    <span ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave} className="inline-flex cursor-help">
      {children}
      {mounted && open && coords && createPortal(
        <div
          style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 70 }}
          className="bg-[#0B1220] border border-[#374151] rounded-xl shadow-2xl p-3 text-left normal-case font-normal tracking-normal"
        >
          <div className="flex items-center justify-between gap-4 mb-1.5">
            <span className="text-xs font-semibold text-white">{label}</span>
            <span className="text-[10px] text-gray-500">conf. {confPct}%</span>
          </div>
          {!temHist && !temProjecao ? (
            <p className="text-[11px] text-gray-500 w-[280px]">Esse ativo ainda não tem dias com essa métrica nem agregado pra projetar.</p>
          ) : (
            <div className="flex items-end gap-3">
              {temHist ? (
                <MiniChart titulo={tituloHist} vals={hist7.map((p) => p.value)} min={min} max={max} cor="#22d3ee" />
              ) : (
                <div className="w-[132px]">
                  <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Histórico</p>
                  <p className="text-[10px] text-gray-400 leading-snug">Sem dias com essa métrica — projeção pelo agregado do período.</p>
                </div>
              )}
              <MiniChart titulo={`Projeção 7d ${tendencia}`} vals={proj.projection.map((p) => p.value)} min={min} max={max}
                band={{ lo: proj.projection.map((p) => p.lo), hi: proj.projection.map((p) => p.hi) }} dashed cor="#a78bfa" />
            </div>
          )}
          {temProjecao && (
            <div className="flex items-center justify-between gap-4 mt-1.5 text-[10px] text-gray-500 tabular-nums">
              <span>hoje: <span className="text-cyan-300">{format(projHoje)}</span></span>
              {proj.basis === 'fallback' && <span className="text-gray-400">base: agregado</span>}
              <span>em 7d: <span className="text-purple-300">{format(projFim)}</span></span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  )
}
