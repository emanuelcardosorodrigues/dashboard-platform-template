'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export const PERFORMANCE_HISTORY_METRICS = [
  { key: 'hook_rate', label: 'Hook Rate', format: 'percent' },
  { key: 'conv_body', label: 'Conv. Body', format: 'percent' },
  { key: 'cpc_link', label: 'CPC Link', format: 'currency' },
  { key: 'hold_rate', label: 'Hold Rate', format: 'percent' },
] as const

type MetricKey = (typeof PERFORMANCE_HISTORY_METRICS)[number]['key']
type ValueFormat = (typeof PERFORMANCE_HISTORY_METRICS)[number]['format']

/**
 * Contrato da rota GET /api/criativos/historico. O ranking é feito no servidor;
 * a UI apenas desenha as séries que a rota devolve para cada métrica.
 */
export type PerformanceHistoryResponse = {
  metrics: Partial<Record<MetricKey, {
    series: Array<{
      adId: string
      name: string
      points: Array<{ date: string; value: number | null }>
    }>
  }>>
}

type Props = {
  de: string
  ate: string
  funil: string
  conta: string
  /** IDs de anúncios de todos os cards que passaram pelos filtros compartilhados. */
  adIds: string[]
}

const COLORS = ['#a78bfa', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#f97316', '#e879f9', '#a3e635', '#f472b6']
const TOP_OPTIONS = [3, 5, 10, 20]

function compactName(name: string) {
  return name.length > 32 ? `${name.slice(0, 29)}…` : name
}

function valueLabel(value: number | null | undefined, format: ValueFormat) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (format === 'percent') return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}

function dateLabel(value: string) {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}` : value
}

function MetricChart({
  metric,
  series,
}: {
  metric: (typeof PERFORMANCE_HISTORY_METRICS)[number]
  series: NonNullable<PerformanceHistoryResponse['metrics'][MetricKey]>['series']
}) {
  const data = useMemo(() => {
    const byDay = new Map<string, Record<string, string | number | null>>()
    for (const line of series) {
      for (const point of line.points) {
        const row = byDay.get(point.date) ?? { date: point.date }
        row[line.adId] = point.value
        byDay.set(point.date, row)
      }
    }
    return [...byDay.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [series])

  if (series.length === 0 || data.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text-primary">{metric.label}</h3>
        <p className="py-16 text-center text-sm text-text-secondary">Sem dados suficientes para esta métrica no período.</p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-text-primary">{metric.label}</h3>
      <div className="h-72 w-full" role="img" aria-label={`Série temporal de ${metric.label}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={dateLabel}
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              tickFormatter={(value) => valueLabel(Number(value), metric.format)}
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={metric.format === 'currency' ? 74 : 52}
            />
            <Tooltip
              labelFormatter={(value) => dateLabel(String(value))}
              formatter={(value, _name, item) => [valueLabel(typeof value === 'number' ? value : null, metric.format), item.name]}
              contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#d1d5db' }}
              itemStyle={{ color: '#f3f4f6' }}
            />
            <Legend
              formatter={(value) => <span className="text-xs text-text-secondary">{compactName(String(value))}</span>}
              wrapperStyle={{ paddingTop: 12 }}
            />
            {series.map((line, index) => (
              <Line
                key={line.adId}
                type="monotone"
                dataKey={line.adId}
                name={line.name}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export default function HistoryPerformanceTab({ de, ate, funil, conta, adIds }: Props) {
  const [top, setTop] = useState(5)
  const [response, setResponse] = useState<PerformanceHistoryResponse | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')

  const idsKey = useMemo(() => [...new Set(adIds)].sort().join(','), [adIds])

  useEffect(() => {
    if (!idsKey) {
      setResponse(null)
      setState('idle')
      return
    }

    const controller = new AbortController()
    const params = new URLSearchParams({ de, ate, funil, conta, adIds: idsKey, top: String(top) })
    setState('loading')
    setResponse(null)
    fetch(`/api/criativos/historico?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`histórico ${res.status}`)
        return res.json() as Promise<PerformanceHistoryResponse>
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setResponse(data)
          setState('idle')
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error')
      })
    return () => controller.abort()
  }, [de, ate, funil, conta, idsKey, top])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Histórico de Performance</h2>
          <p className="mt-0.5 text-xs text-text-secondary">Evolução diária dos criativos que passam pelos filtros atuais.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          Top
          <select
            value={top}
            onChange={(event) => setTop(Number(event.target.value))}
            className="rounded-md border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary outline-none focus:border-purple-400"
            aria-label="Quantidade de melhores criativos por métrica"
          >
            {TOP_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <span>por métrica</span>
        </label>
      </div>

      {!idsKey && <p className="py-16 text-center text-sm text-text-secondary">Nenhum criativo passa pelos filtros atuais.</p>}
      {state === 'loading' && <p className="py-16 text-center text-sm text-text-secondary">Carregando séries de performance…</p>}
      {state === 'error' && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">Não foi possível carregar o histórico. Tente novamente.</p>}
      {state === 'idle' && response && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {PERFORMANCE_HISTORY_METRICS.map((metric) => (
            <MetricChart key={metric.key} metric={metric} series={response.metrics[metric.key]?.series ?? []} />
          ))}
        </div>
      )}
    </div>
  )
}
