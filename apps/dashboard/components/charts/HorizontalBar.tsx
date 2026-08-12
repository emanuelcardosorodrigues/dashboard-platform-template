'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts'
import { formatPercent } from '@/lib/formatters'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'

interface HorizontalBarItem {
  label: string
  value: number
  color?: string
}

interface HorizontalBarProps {
  data: HorizontalBarItem[]
  valueFormatter?: (v: number) => string
  height?: number
  color?: string
}

const DEFAULT_COLOR = '#06B6D4'

const CustomTooltip = ({
  active,
  payload,
  valueFormatter,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number }>
  valueFormatter?: (v: number) => string
}) => {
  if (active && payload && payload.length) {
    const fmt = valueFormatter ?? ((v: number) => String(v))
    return (
      <div className="bg-[#1F2937] border border-[#1F2937] rounded-lg p-3 shadow-xl text-sm">
        <span className="text-white font-semibold">{fmt(payload[0].value)}</span>
      </div>
    )
  }
  return null
}

export default function HorizontalBar({
  data,
  valueFormatter = formatPercent,
  height,
  color = DEFAULT_COLOR,
}: HorizontalBarProps) {
  // C3 — eixos legíveis no mobile (fonte 12, decimação do eixo numérico e faixa
  // de rótulos mais estreita pra sobrar largura de barra em 360px). A altura já
  // é proporcional às linhas (não achata), então C2 não se aplica aqui.
  const isMobile = useIsMobile()
  const h = height ?? Math.max(200, data.length * 36)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 5, right: 60, left: 0, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: '#9CA3AF', fontSize: isMobile ? 12 : 11 }}
          axisLine={{ stroke: '#1F2937' }}
          tickLine={false}
          tickFormatter={valueFormatter}
          interval={isMobile ? 'preserveStartEnd' : undefined}
          minTickGap={isMobile ? 32 : undefined}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: '#9CA3AF', fontSize: isMobile ? 12 : 11 }}
          axisLine={false}
          tickLine={false}
          width={isMobile ? 104 : 140}
        />
        <Tooltip
          content={(props) => (
            <CustomTooltip
              active={props.active}
              payload={props.payload as unknown as Array<{ name: string; value: number }> | undefined}
              valueFormatter={valueFormatter}
            />
          )}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={20}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color ?? color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
