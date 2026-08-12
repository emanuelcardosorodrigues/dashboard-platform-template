'use client'

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
  type PieLabelRenderProps,
} from 'recharts'
import { formatPercent } from '@/lib/formatters'

interface DonutDataItem {
  name: string
  value: number
  color: string
}

interface DonutChartProps {
  data: DonutDataItem[]
  title?: string
  showLegend?: boolean
  centerLabel?: string
  centerValue?: string
  height?: number
}

const CustomTooltip = ({ active, payload }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: DonutDataItem }>
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1F2937] border border-[#1F2937] rounded-lg p-3 shadow-xl">
        <div className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full" style={{ background: payload[0].payload.color }} />
          <span className="text-gray-300">{payload[0].name}:</span>
          <span className="font-semibold text-white">{payload[0].value}</span>
        </div>
      </div>
    )
  }
  return null
}

const RADIAN = Math.PI / 180
const renderCustomLabel = (props: PieLabelRenderProps) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props
  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    typeof midAngle !== 'number' ||
    typeof innerRadius !== 'number' ||
    typeof outerRadius !== 'number' ||
    typeof percent !== 'number'
  ) return null
  if (percent < 0.05) return null
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11}>
      {formatPercent(percent * 100, 0)}
    </text>
  )
}

export default function DonutChart({
  data,
  title,
  showLegend = true,
  centerLabel,
  centerValue,
  height = 240,
}: DonutChartProps) {
  return (
    <div>
      {title && (
        <p className="text-sm font-medium text-gray-300 mb-3">{title}</p>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={height * 0.25}
            outerRadius={height * 0.38}
            paddingAngle={3}
            dataKey="value"
            labelLine={false}
            label={renderCustomLabel}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          {showLegend && (
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
