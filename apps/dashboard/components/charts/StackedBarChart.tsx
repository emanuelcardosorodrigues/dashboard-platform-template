'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { formatDateBR } from '@/lib/formatters'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'

// C4 — Paleta da pilha. No desktop mantemos a paleta ORIGINAL (com o bug
// histórico dos dois verdes: OB1 #10B981 e OB3 #0E9F6E são o mesmo verde). No
// mobile — tela pequena, sol, sem hover pra desambiguar — trocamos por matizes
// separados por hue E luminância, colorblind-safe: OB3 sai do verde e vira
// violeta, então nenhum par vizinho da pilha colide.
const STACK_COLORS_DESKTOP = {
  frontEnd: '#06B6D4', // cyan
  ob1: '#10B981',      // emerald  ← colidia com ob3
  ob2: '#F59E0B',      // amber
  ob3: '#0E9F6E',      // teal     ← colidia com ob1
  ob4: '#F43F5E',      // rose
} as const
const STACK_COLORS_MOBILE = {
  frontEnd: '#22D3EE', // cyan-400
  ob1: '#34D399',      // emerald-400
  ob2: '#FBBF24',      // amber-400
  ob3: '#A78BFA',      // violet-400  (era verde — agora distinto do OB1)
  ob4: '#FB7185',      // rose-400
} as const

interface DataPoint {
  date: string
  frontEnd: number
  ob1: number
  ob2: number
  ob3: number
  ob4: number
}

interface StackedBarChartProps {
  data: DataPoint[]
  frontEndLabel?: string
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) => {
  if (active && payload && payload.length) {
    const total = payload.reduce((s, p) => s + (p.value || 0), 0)
    return (
      <div className="bg-[#1F2937] border border-[#1F2937] rounded-lg p-3 shadow-xl">
        <p className="text-xs text-gray-400 mb-2">{formatDateBR(label ?? '')}</p>
        {payload.map((p) => (
          <div key={p.name} className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-gray-300">{p.name}:</span>
            <span className="font-semibold text-white">{p.value}</span>
          </div>
        ))}
        <div className="border-t border-[#374151] mt-2 pt-2 flex justify-between text-xs">
          <span className="text-gray-400">Total:</span>
          <span className="text-white font-semibold">{total}</span>
        </div>
      </div>
    )
  }
  return null
}

export default function StackedBarChart({ data, frontEndLabel = 'Principal' }: StackedBarChartProps) {
  // C2/C3/C4 — no mobile: proporção em vez de altura fixa, eixos maiores e a
  // paleta corrigida. Desktop segue idêntico (height 280, ticks 11px, paleta
  // original).
  const isMobile = useIsMobile()
  const c = isMobile ? STACK_COLORS_MOBILE : STACK_COLORS_DESKTOP
  return (
    <ResponsiveContainer
      width="100%"
      {...(isMobile ? { aspect: 4 / 3 } : { height: 280 })}
    >
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
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
          tick={{ fill: '#9CA3AF', fontSize: isMobile ? 12 : 11 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={isMobile ? 40 : undefined}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }} />
        <Bar dataKey="frontEnd" name={frontEndLabel} stackId="a" fill={c.frontEnd} radius={[0, 0, 0, 0]} />
        <Bar dataKey="ob1" name="OB1" stackId="a" fill={c.ob1} />
        <Bar dataKey="ob2" name="OB2" stackId="a" fill={c.ob2} />
        <Bar dataKey="ob3" name="OB3" stackId="a" fill={c.ob3} />
        <Bar dataKey="ob4" name="OB4 Manual" stackId="a" fill={c.ob4} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
