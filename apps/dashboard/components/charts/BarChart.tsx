'use client'

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
  ReferenceLine,
  Line,
  ComposedChart,
} from 'recharts'
import { formatCurrencyCompact, formatDateBR, formatRoas } from '@/lib/formatters'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'

interface DataPoint {
  date: string
  lucro: number
  roasMedia7d?: number
}

interface BarChartProps {
  data: DataPoint[]
  showRoasLine?: boolean
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1F2937] border border-[#1F2937] rounded-lg p-3 shadow-xl">
        <p className="text-xs text-gray-400 mb-2">{formatDateBR(label ?? '')}</p>
        {payload.map((p) => (
          <div key={p.name} className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-gray-300">{p.name}:</span>
            <span className="font-semibold text-white">
              {p.name === 'ROAS 7d' ? formatRoas(p.value) : formatCurrencyCompact(p.value)}
            </span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export default function BarChartLucro({ data, showRoasLine = false }: BarChartProps) {
  // C2/C3 — mobile: proporção em vez de altura fixa + eixos maiores/decimados.
  // Desktop idêntico (height 280, ticks 11px).
  const isMobile = useIsMobile()
  return (
    <ResponsiveContainer
      width="100%"
      {...(isMobile ? { aspect: 4 / 3 } : { height: 280 })}
    >
      <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => {
            const parts = String(v).split('-')
            return parts.length === 3 ? `${parts[2]}/${parts[1]}` : v
          }}
          tick={{ fill: '#9CA3AF', fontSize: isMobile ? 12 : 11 }}
          axisLine={{ stroke: '#1F2937' }}
          tickLine={false}
          interval={isMobile ? 'preserveStartEnd' : undefined}
          minTickGap={isMobile ? 32 : undefined}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={formatCurrencyCompact}
          tick={{ fill: '#9CA3AF', fontSize: isMobile ? 12 : 11 }}
          axisLine={false}
          tickLine={false}
          width={isMobile ? 54 : 70}
        />
        {showRoasLine && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(v) => `${v}x`}
            tick={{ fill: '#9CA3AF', fontSize: isMobile ? 12 : 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
        )}
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine yAxisId="left" y={0} stroke="#374151" strokeWidth={1} />
        <Bar
          yAxisId="left"
          dataKey="lucro"
          name="Lucro"
          radius={[3, 3, 0, 0]}
          maxBarSize={24}
        >
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.lucro >= 0 ? '#10B981' : '#F43F5E'}
            />
          ))}
        </Bar>
        {showRoasLine && (
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="roasMedia7d"
            name="ROAS 7d"
            stroke="#F59E0B"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
