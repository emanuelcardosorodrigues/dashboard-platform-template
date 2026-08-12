'use client'

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar,
} from 'recharts'

const tooltipStyle = {
  backgroundColor: '#0B1120', border: '1px solid #1F2937', borderRadius: 8,
  fontSize: 12, color: '#E5E7EB',
}

export default function VisaoGeralClient({ serie }: {
  serie: Array<{ date: string; views: number; seguidores: number }>
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Views por dia (agregado)</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
              <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} width={48} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="views" name="Views" stroke="#22D3EE" fill="#22D3EE22" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Seguidores líquidos por dia (agregado)</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
              <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} width={48} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="seguidores" name="Seguidores ±" fill="#34D399" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
