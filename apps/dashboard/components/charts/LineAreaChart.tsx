'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { formatCurrencyCompact, formatDateBR } from '@/lib/formatters'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'

interface DataPoint {
  date: string
  faturamento: number
  investimento: number
  lucro: number
}

interface LineAreaChartProps {
  data: DataPoint[]
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
            <span className="font-semibold text-white">{formatCurrencyCompact(p.value)}</span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export default function LineAreaChart({ data }: LineAreaChartProps) {
  // C2/C3 — no mobile o gráfico passa a ter proporção (aspect) em vez de altura
  // fixa, e os eixos ganham fonte e espaçamento maiores. Em md+ tudo continua
  // exatamente como era (height={300}, ticks 11px, sem interval/minTickGap).
  const isMobile = useIsMobile()
  return (
    <ResponsiveContainer
      width="100%"
      {...(isMobile ? { aspect: 4 / 3 } : { height: 300 })}
    >
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <defs>
          <linearGradient id="gradFaturamento" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradInvestimento" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#F43F5E" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradLucro" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
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
          tickFormatter={formatCurrencyCompact}
          tick={{ fill: '#9CA3AF', fontSize: isMobile ? 12 : 11 }}
          axisLine={false}
          tickLine={false}
          width={isMobile ? 54 : 70}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="faturamento"
          name="Faturamento"
          stroke="#06B6D4"
          strokeWidth={2}
          fill="url(#gradFaturamento)"
          dot={false}
          activeDot={{ r: 4, fill: '#06B6D4' }}
        />
        <Area
          type="monotone"
          dataKey="investimento"
          name="Investimento"
          stroke="#F43F5E"
          strokeWidth={2}
          fill="url(#gradInvestimento)"
          dot={false}
          activeDot={{ r: 4, fill: '#F43F5E' }}
        />
        <Area
          type="monotone"
          dataKey="lucro"
          name="Lucro"
          stroke="#10B981"
          strokeWidth={2}
          fill="url(#gradLucro)"
          dot={false}
          activeDot={{ r: 4, fill: '#10B981' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
