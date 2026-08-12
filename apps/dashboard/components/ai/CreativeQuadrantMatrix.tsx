'use client'

import { useMemo, useState } from 'react'
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
  Cell,
} from 'recharts'
import { clsx } from 'clsx'
import {
  buildQuadrantMatrix,
  quadrantFor,
  QUADRANT_COLOR,
  QUADRANT_DESCRIPTION,
  QUADRANT_LABEL,
  type CreativeStats,
  type QuadrantMetric,
  type Quadrant,
} from '@/lib/creativeAnalysis'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters'

interface Props {
  creatives: CreativeStats[]
  onPickCreative?: (c: CreativeStats) => void
}

const METRIC_OPTIONS: Array<{ key: QuadrantMetric; label: string }> = [
  { key: 'conv_pagina', label: 'Conv. página' },
  { key: 'roas', label: 'ROAS' },
  { key: 'cpa', label: 'CPA' },
]

export default function CreativeQuadrantMatrix({ creatives, onPickCreative }: Props) {
  const [metric, setMetric] = useState<QuadrantMetric>('conv_pagina')
  const matrix = useMemo(() => buildQuadrantMatrix(creatives, metric), [creatives, metric])

  const points = useMemo(() => {
    return creatives
      .filter((c) => c.landing_views > 0)
      .map((c) => {
        const y =
          metric === 'conv_pagina' ? c.conv_pagina * 100 :
          metric === 'roas' ? c.roas :
          c.cpa ?? 0
        const q = quadrantFor(c, metric, matrix)
        return {
          ...c,
          x: c.landing_views,
          y,
          quadrant: q ?? 'dead',
        }
      })
  }, [creatives, metric, matrix])

  const yLabel =
    metric === 'conv_pagina' ? 'Conv. página (%)' :
    metric === 'roas' ? 'ROAS' :
    'CPA (R$)'

  const totalByQuadrant: Record<Quadrant, number> = {
    champion: matrix.cells.champion.length,
    hidden_gem: matrix.cells.hidden_gem.length,
    magnet: matrix.cells.magnet.length,
    dead: matrix.cells.dead.length,
  }

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Matriz de criativos · 2×2</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Volume (LPV) × {yLabel.split(' ')[0]} — split pela mediana do período
          </p>
        </div>
        <div className="flex items-center rounded-lg bg-[#0F172A] border border-[#1F2937] overflow-hidden">
          {METRIC_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => setMetric(o.key)}
              className={clsx(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                metric === o.key
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-gray-400 hover:text-white',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {points.length === 0 ? (
        <p className="text-gray-500 text-sm py-12 text-center">
          Sem criativos com landing views no período.
        </p>
      ) : (
        <>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, bottom: 32, left: 16 }}>
                <CartesianGrid stroke="#1F2937" strokeDasharray="3 3" />
                <XAxis
                  dataKey="x"
                  type="number"
                  name="LPV"
                  stroke="#9CA3AF"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Landing Page Views', position: 'insideBottom', offset: -10, fill: '#6B7280', fontSize: 11 }}
                />
                <YAxis
                  dataKey="y"
                  type="number"
                  name={yLabel}
                  stroke="#9CA3AF"
                  tick={{ fontSize: 11 }}
                  label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11 }}
                />
                <ReferenceLine x={matrix.medianLpv} stroke="#4B5563" strokeDasharray="4 4" />
                <ReferenceLine y={metric === 'conv_pagina' ? matrix.medianMetric * 100 : matrix.medianMetric} stroke="#4B5563" strokeDasharray="4 4" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload as (typeof points)[number]
                    return (
                      <div className="bg-[#0F172A] border border-[#1F2937] rounded-lg p-3 text-xs space-y-1 shadow-xl">
                        <p className="font-semibold text-white truncate max-w-[260px]">{p.criativo}</p>
                        <p className="text-gray-400">
                          Quadrante:{' '}
                          <span style={{ color: QUADRANT_COLOR[p.quadrant as Quadrant] }} className="font-medium">
                            {QUADRANT_LABEL[p.quadrant as Quadrant]}
                          </span>
                        </p>
                        <p className="text-gray-400">LPV: <span className="text-gray-200">{formatNumber(p.landing_views)}</span></p>
                        <p className="text-gray-400">Compras: <span className="text-gray-200">{p.compras}</span></p>
                        <p className="text-gray-400">ROAS: <span className="text-gray-200">{formatNumber(p.roas, 2)}</span></p>
                        <p className="text-gray-400">CPA: <span className="text-gray-200">{p.cpa != null ? formatCurrency(p.cpa) : '—'}</span></p>
                        <p className="text-gray-400">Conv. pág: <span className="text-gray-200">{formatPercent(p.conv_pagina * 100, 2)}</span></p>
                      </div>
                    )
                  }}
                />
                <Scatter data={points} onClick={(d) => onPickCreative?.(d as unknown as CreativeStats)} style={{ cursor: onPickCreative ? 'pointer' : 'default' }}>
                  {points.map((p, i) => (
                    <Cell key={i} fill={QUADRANT_COLOR[p.quadrant as Quadrant]} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            {(Object.keys(QUADRANT_LABEL) as Quadrant[]).map((q) => (
              <div
                key={q}
                className="border border-[#1F2937] rounded-lg p-3 text-xs"
                style={{ borderLeftColor: QUADRANT_COLOR[q], borderLeftWidth: 3 }}
              >
                <p className="font-semibold text-white">
                  {QUADRANT_LABEL[q]}{' '}
                  <span className="text-gray-500 font-normal">({totalByQuadrant[q]})</span>
                </p>
                <p className="text-gray-500 mt-1 leading-snug">{QUADRANT_DESCRIPTION[q]}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
