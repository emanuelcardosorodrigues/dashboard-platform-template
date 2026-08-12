'use client'

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  ZAxis,
} from 'recharts'
import { formatPercent, formatCurrencyCompact, formatRoas, formatCurrency } from '@/lib/formatters'
import type { CriativoAgregado } from '@/types'
import { SEMAFORO_DOT_COLOR, getSemaforoColor } from '@/lib/thresholds'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { ArrowUp, Minus, ArrowDown } from 'lucide-react'

export interface BubbleChartProps {
  data: CriativoAgregado[]
  xKey?: keyof CriativoAgregado
  yKey?: keyof CriativoAgregado
  bubbleKey?: keyof CriativoAgregado
  xLabel?: string
  yLabel?: string
  xRef?: number
  yRef?: number
}

const METRIC_FORMAT: Partial<Record<keyof CriativoAgregado, (v: number) => string>> = {
  hookRate:        (v) => formatPercent(v),
  retencaoRate:    (v) => formatPercent(v),
  convClique:      (v) => formatPercent(v),
  txConversaoPagina: (v) => formatPercent(v),
  ctr:             (v) => formatPercent(v),
  roas:            (v) => formatRoas(v),
  cpa:             (v) => formatCurrency(v),
  cpa24h:          (v) => formatCurrency(v),
  investimento:    (v) => formatCurrencyCompact(v),
  lucro:           (v) => formatCurrencyCompact(v),
  vendasFront:     (v) => String(Math.round(v)),
}

function fmt(key: keyof CriativoAgregado, v: number): string {
  return METRIC_FORMAT[key]?.(v) ?? String(v)
}

const CustomTooltip = ({
  active, payload, xKey = 'hookRate', yKey = 'retencaoRate', bubbleKey = 'investimento',
}: {
  active?: boolean
  payload?: Array<{ payload: CriativoAgregado }>
  xKey?: keyof CriativoAgregado
  yKey?: keyof CriativoAgregado
  bubbleKey?: keyof CriativoAgregado
}) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-[#1F2937] border border-[#374151] rounded-lg p-3 shadow-xl text-xs max-w-52">
      <p className="text-white font-semibold mb-2 truncate">{d.criativo}</p>
      <div className="space-y-1 text-gray-300">
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">X ({String(xKey)})</span>
          <span className="text-white">{fmt(xKey, Number(d[xKey] ?? 0))}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">Y ({String(yKey)})</span>
          <span className="text-white">{fmt(yKey, Number(d[yKey] ?? 0))}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">Bolha ({String(bubbleKey)})</span>
          <span className="text-white">{fmt(bubbleKey, Number(d[bubbleKey] ?? 0))}</span>
        </div>
        <div className="flex justify-between gap-4 pt-1 border-t border-[#374151]">
          <span>ROAS</span>
          <span className="text-white">{formatRoas(d.roas)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Investimento</span>
          <span className="text-white">{formatCurrencyCompact(d.investimento)}</span>
        </div>
      </div>
    </div>
  )
}

export default function BubbleChart({
  data,
  xKey = 'hookRate',
  yKey = 'convClique',
  bubbleKey = 'lucro',
  xLabel,
  yLabel,
  xRef,
  yRef,
}: BubbleChartProps) {
  const scatterData = data.map((d) => ({
    ...d,
    x: Number(d[xKey] ?? 0),
    y: Number(d[yKey] ?? 0),
    z: Math.max(Math.abs(Number(d[bubbleKey] ?? 0)), 1),
    color: SEMAFORO_DOT_COLOR[getSemaforoColor('roasLiquido', d.roas)],
  }))

  const xVals = scatterData.map((d) => d.x).filter((v) => v > 0)
  const yVals = scatterData.map((d) => d.y).filter((v) => v > 0)
  const xMax = xVals.length ? Math.ceil(Math.max(...xVals) * 1.15) : 100
  const yMax = yVals.length ? Math.ceil(Math.max(...yVals) * 1.15) : 10

  const fmtAxis = (key: keyof CriativoAgregado) => {
    if (['hookRate','retencaoRate','convClique','txConversaoPagina','ctr'].includes(String(key)))
      return (v: number) => `${v}%`
    if (['roas'].includes(String(key))) return (v: number) => `${v}x`
    return (v: number) => String(v)
  }

  // C2/C3 — mobile: scatter vira quadrado (aspect 1/1) em vez de 380px fixo, o
  // que reduz a distorção de sobreplotagem em 360px; eixos com fonte 12.
  // Desktop idêntico (height 380, ticks 11px).
  const isMobile = useIsMobile()

  return (
    <div className="relative">
      <ResponsiveContainer
        width="100%"
        {...(isMobile ? { aspect: 1 } : { height: 380 })}
      >
        <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, xMax]}
            tickFormatter={fmtAxis(xKey)}
            tick={{ fill: '#9CA3AF', fontSize: isMobile ? 12 : 11 }}
            axisLine={{ stroke: '#1F2937' }}
            tickLine={false}
            interval={isMobile ? 'preserveStartEnd' : undefined}
            minTickGap={isMobile ? 32 : undefined}
            label={{ value: xLabel ?? String(xKey), position: 'insideBottom', offset: -20, fill: '#9CA3AF', fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, yMax]}
            tickFormatter={fmtAxis(yKey)}
            tick={{ fill: '#9CA3AF', fontSize: isMobile ? 12 : 11 }}
            axisLine={false}
            tickLine={false}
            width={45}
            label={{ value: yLabel ?? String(yKey), angle: -90, position: 'insideLeft', fill: '#9CA3AF', fontSize: 11 }}
          />
          <ZAxis type="number" dataKey="z" range={[30, 900]} />
          <Tooltip content={<CustomTooltip xKey={xKey} yKey={yKey} bubbleKey={bubbleKey} />} />
          {xRef !== undefined && (
            <ReferenceLine x={xRef} stroke="#374151" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: fmtAxis(xKey)(xRef), fill: '#9CA3AF', fontSize: 10, position: 'top' }} />
          )}
          {yRef !== undefined && (
            <ReferenceLine y={yRef} stroke="#374151" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: fmtAxis(yKey)(yRef), fill: '#9CA3AF', fontSize: 10, position: 'right' }} />
          )}
          <Scatter data={scatterData} shape="circle">
            {scatterData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.8} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* C10 — a cor da bolha (semáforo de ROAS) é, hoje, o ÚNICO sinal de
          melhor/pior. No mobile isso mata (tela pequena, sol, deuteranopia),
          então acrescentamos uma legenda em que a SETA — não a cor — carrega a
          direção: ▲ bom, ─ ok, ▼ ruim. Desktop segue sem legenda (idêntico). */}
      {isMobile && (
        <ul className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-gray-300">
          <li className="flex items-center gap-1">
            <ArrowUp size={12} strokeWidth={2.5} style={{ color: SEMAFORO_DOT_COLOR.green }} aria-hidden />
            <span className="h-2 w-2 rounded-full" style={{ background: SEMAFORO_DOT_COLOR.green }} />
            <span>ROAS bom</span>
          </li>
          <li className="flex items-center gap-1">
            <Minus size={12} strokeWidth={2.5} style={{ color: SEMAFORO_DOT_COLOR.yellow }} aria-hidden />
            <span className="h-2 w-2 rounded-full" style={{ background: SEMAFORO_DOT_COLOR.yellow }} />
            <span>ok</span>
          </li>
          <li className="flex items-center gap-1">
            <ArrowDown size={12} strokeWidth={2.5} style={{ color: SEMAFORO_DOT_COLOR.red }} aria-hidden />
            <span className="h-2 w-2 rounded-full" style={{ background: SEMAFORO_DOT_COLOR.red }} />
            <span>ruim</span>
          </li>
        </ul>
      )}
    </div>
  )
}
