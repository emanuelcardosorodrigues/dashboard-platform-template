'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { formatCurrency, formatCurrencyCompact } from '@/lib/formatters'
import type { PerpetuoDetalhes } from '@/lib/perpetuoDetalhes'

type TabKey = 'serie' | 'origem' | 'pagina' | 'esteira' | 'hora' | 'dia' | 'pesquisa'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'serie', label: 'Faturamento × Vendas' },
  { key: 'origem', label: 'Por origem' },
  { key: 'pagina', label: 'Por página' },
  { key: 'esteira', label: 'Esteira' },
  { key: 'hora', label: 'Por hora' },
  { key: 'dia', label: 'Por dia' },
  { key: 'pesquisa', label: 'Por pesquisa' },
]
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const AXIS = { fill: '#94a3b8', fontSize: 11 }
const GRID = '#1e2536'
const TOOLTIP = { backgroundColor: '#0f1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 12 }
const compact = (v: number) => formatCurrencyCompact(Number(v) || 0)

export default function NodeModal({
  title,
  detalhes,
  onClose,
}: {
  title: string
  detalhes: PerpetuoDetalhes
  onClose: () => void
}) {
  const [tab, setTab] = useState<TabKey>('serie')
  const { serie, origem, pagina, hora, diaSemana, esteira, pesquisa, tempoCompra } = detalhes
  const [pesqCampo, setPesqCampo] = useState(pesquisa[0]?.campo ?? '')
  const pesqSel = pesquisa.find((p) => p.campo === pesqCampo) ?? pesquisa[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0f1420] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 sticky top-0 bg-[#0f1420] z-10">
          <h2 className="text-sm font-semibold text-white truncate">{title} — detalhes do funil</h2>
          <button onClick={onClose} title="Fechar" className="p-1 rounded text-white/50 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </header>

        {tempoCompra.medianaDias != null && (
          <div className="px-4 pt-3">
            <div className="inline-flex items-center gap-2 rounded-lg border border-purple-400/30 bg-purple-500/10 px-3 py-1.5 text-[12px]">
              <span className="text-white/60">⏱ Tempo médio lead→compra</span>
              <span className="font-semibold text-purple-200 tabular-nums">
                {tempoCompra.medianaDias} {tempoCompra.medianaDias === 1 ? 'dia' : 'dias'}
              </span>
              <span className="text-white/40">mediana · média {tempoCompra.mediaDias}d · n={tempoCompra.n}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1 px-4 pt-3 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-2.5 py-1 rounded-md text-[12px] ${
                tab === t.key ? 'bg-purple-500/20 text-purple-200 border border-purple-400/40' : 'text-white/55 hover:text-white border border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === 'serie' && (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={serie}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="date" tick={AXIS} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis yAxisId="l" tick={AXIS} tickFormatter={(v: number) => compact(v)} width={64} />
                <YAxis yAxisId="r" orientation="right" tick={AXIS} width={36} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => (n === 'faturamento' ? formatCurrency(Number(v)) : Number(v))} />
                <Bar yAxisId="r" dataKey="vendas" name="Vendas" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                <Line yAxisId="l" dataKey="faturamento" name="Faturamento" stroke="#22d3ee" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}

          {tab === 'origem' && (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={origem}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="label" tick={AXIS} />
                <YAxis tick={AXIS} allowDecimals={false} width={36} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => (n === 'faturamento' ? formatCurrency(Number(v)) : Number(v))} />
                <Bar dataKey="vendas" name="Vendas" fill="#a78bfa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {tab === 'pagina' && (
            <ResponsiveContainer width="100%" height={Math.max(240, pagina.length * 34)}>
              <BarChart data={pagina} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} allowDecimals={false} />
                <YAxis type="category" dataKey="slug" tick={AXIS} width={160} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => (n === 'faturamento' ? formatCurrency(Number(v)) : Number(v))} />
                <Bar dataKey="vendas" name="Vendas" fill="#22d3ee" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {tab === 'esteira' && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={esteira} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} tickFormatter={(v: number) => new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(v)} />
                <YAxis type="category" dataKey="etapa" tick={AXIS} width={90} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v) => new Intl.NumberFormat('pt-BR').format(Number(v))} />
                <Bar dataKey="valor" name="Volume" radius={[0, 3, 3, 0]}>
                  {esteira.map((_, i) => (
                    <Cell key={i} fill={['#64748b', '#818cf8', '#a78bfa', '#f59e0b', '#34d399'][i] ?? '#a78bfa'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          {tab === 'hora' && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hora}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="hora" tick={AXIS} tickFormatter={(h: number) => `${h}h`} interval={1} />
                <YAxis tick={AXIS} allowDecimals={false} width={36} />
                <Tooltip contentStyle={TOOLTIP} labelFormatter={(h) => `${Number(h)}h`} />
                <Bar dataKey="vendas" name="Vendas" fill="#a78bfa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {tab === 'dia' && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={diaSemana}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="dia" tick={AXIS} tickFormatter={(d: number) => DIAS[d] ?? String(d)} />
                <YAxis tick={AXIS} allowDecimals={false} width={36} />
                <Tooltip contentStyle={TOOLTIP} labelFormatter={(d) => DIAS[Number(d)] ?? String(d)} />
                <Bar dataKey="vendas" name="Vendas" fill="#22d3ee" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {tab === 'pesquisa' && (
            pesquisa.length === 0 ? (
              <p className="text-white/50 text-sm py-12 text-center">Sem fichas de qualificação cruzadas com as compras deste período.</p>
            ) : (
              <>
                <div className="mb-3">
                  <select
                    value={pesqCampo}
                    onChange={(e) => setPesqCampo(e.target.value)}
                    className="bg-[#1F2937] text-gray-200 text-[12px] rounded-md px-2 py-1.5 border border-white/10 cursor-pointer"
                  >
                    {pesquisa.map((p) => (
                      <option key={p.campo} value={p.campo}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <ResponsiveContainer width="100%" height={Math.max(240, (pesqSel?.itens.length ?? 0) * 34)}>
                  <BarChart data={pesqSel?.itens ?? []} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                    <XAxis type="number" tick={AXIS} allowDecimals={false} />
                    <YAxis type="category" dataKey="resposta" tick={AXIS} width={180} />
                    <Tooltip contentStyle={TOOLTIP} />
                    <Bar dataKey="vendas" name="Compradores" fill="#a78bfa" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )
          )}
        </div>
      </div>
    </div>
  )
}
