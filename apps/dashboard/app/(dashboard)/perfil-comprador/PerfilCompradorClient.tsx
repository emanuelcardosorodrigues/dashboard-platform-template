'use client'

import { useState, useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import DonutChart from '@/components/charts/DonutChart'
import HorizontalBar from '@/components/charts/HorizontalBar'
import { formatPercent } from '@/lib/formatters'
import type { BuyerRow } from './page'

interface Props {
  buyers: BuyerRow[]
  criativoLinks: Record<string, string>
}

const COLORS = ['#06B6D4', '#10B981', '#F59E0B', '#0E9F6E', '#F43F5E', '#0891B2', '#D97706', '#F97316']
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

// Normaliza para agrupamento: minúsculas, sem acentos, sem pontuação
function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

// Regras semânticas: padrão (regex) → chave canônica
// Quando o texto normalizado bate com o padrão, é agrupado na mesma entrada com o rótulo canônico.
const SEMANTIC_RULES: Array<{ pattern: RegExp; canonical: string }> = [
  // "Todas as alternativas / opções / acima / citadas"
  {
    pattern: /\b(todas?\s+(as\s+)?(alternativa|opcao|opcoes|acima|citada|citadas|acim|anter|descrita)|todos\s+(acima|citados|descritos|os\s+acima|os\s+citados))/,
    canonical: 'Todas as alternativas',
  },
  // "Nenhuma / nenhuma das opções / nenhum"
  {
    pattern: /^nenhum[ao]?(\s+(das?\s+(alternativa|opcao|opcoes|item|itens|acima))?)?$/,
    canonical: 'Nenhuma',
  },
  // "Não sei / não tenho certeza"
  {
    pattern: /^nao\s+(sei|tenho\s+certeza|lembro|recordo)/,
    canonical: 'Não sei',
  },
  // "Sim" variantes
  { pattern: /^sim[,!.]*$/, canonical: 'Sim' },
  // "Não" variantes
  { pattern: /^nao[,!.]*$/, canonical: 'Não' },
]

function canonicalize(raw: string): { key: string; label: string } {
  const norm = normalizeKey(raw)
  for (const { pattern, canonical } of SEMANTIC_RULES) {
    if (pattern.test(norm)) {
      return { key: normalizeKey(canonical), label: canonical }
    }
  }
  return { key: norm, label: raw }
}

function countDistribution(values: string[], topN?: number) {
  const groups: Record<string, { best: string; count: number }> = {}
  values.forEach((v) => {
    const raw = v?.trim()
    if (!raw) return
    const { key, label } = canonicalize(raw)
    if (!key) return
    if (!groups[key]) groups[key] = { best: label, count: 0 }
    groups[key].count++
    // Se o canonical já foi definido pelas regras semânticas, usa ele sempre
    // Caso contrário, prefere versão com primeira letra maiúscula
    const isSemanticCanonical = groups[key].best === label && label !== raw
    if (!isSemanticCanonical) {
      const curr = groups[key].best
      const rawCap = raw[0] === raw[0].toUpperCase() && raw[0] !== raw[0].toLowerCase()
      const currCap = curr[0] === curr[0].toUpperCase() && curr[0] !== curr[0].toLowerCase()
      if (rawCap && !currCap) groups[key].best = raw
    }
  })
  const total = values.filter((v) => v?.trim()).length || 1
  const sorted = Object.values(groups)
    .sort((a, b) => b.count - a.count)
  const sliced = topN ? sorted.slice(0, topN) : sorted
  return sliced.map(({ best, count }) => ({ label: best, count, pct: (count / total) * 100 }))
}

function toDonut(items: { label: string; count: number }[]) {
  return items.map((item, i) => ({ name: item.label, value: item.count, color: COLORS[i % COLORS.length] }))
}

function toHBar(items: { label: string; pct: number }[]) {
  return items.map((item) => ({ label: item.label, value: item.pct }))
}

function toHBarCount(items: { label: string; count: number }[]) {
  const max = Math.max(...items.map((i) => i.count), 1)
  return items.map((item) => ({ label: item.label, value: (item.count / max) * 100, raw: item.count }))
}

export default function PerfilCompradorClient({ buyers, criativoLinks }: Props) {
  const criativos = useMemo(() => {
    const seen = new Set<string>()
    buyers.forEach((b) => { if (b.criativo) seen.add(b.criativo) })
    return ['Todos', ...Array.from(seen).sort()]
  }, [buyers])

  const [selected, setSelected] = useState('Todos')

  const filtered = useMemo(
    () => selected === 'Todos' ? buyers : buyers.filter((b) => b.criativo === selected),
    [buyers, selected]
  )

  const sexo          = useMemo(() => countDistribution(filtered.map((b) => b.sexo)), [filtered])
  const faixaEtaria   = useMemo(() => countDistribution(filtered.map((b) => b.faixaEtaria)), [filtered])
  const faturamento   = useMemo(() => countDistribution(filtered.map((b) => b.faturamento)), [filtered])
  const quantoSobra   = useMemo(() => countDistribution(filtered.map((b) => b.quantoSobra)), [filtered])
  const tempoOdontologia = useMemo(() => countDistribution(filtered.map((b) => b.tempoOdontologia)), [filtered])
  const especialidades   = useMemo(() => countDistribution(filtered.map((b) => b.especialidade), 10), [filtered])
  const motivoCompra  = useMemo(() => countDistribution(
    filtered.flatMap((b) => (b.motivoCompra ?? '').split(',').map((v: string) => v.trim()).filter(Boolean))
  ), [filtered])
  const tentouAntes   = useMemo(() => countDistribution(filtered.map((b) => b.tentouAntes), 8), [filtered])

  // Dia da semana e hora que mais gera vendas
  const byDia = useMemo(() => {
    const counts = Array(7).fill(0) as number[]
    filtered.forEach((b) => {
      if (!b.data) return
      try {
        const d = new Date(b.data.replace(' ', 'T'))
        if (!isNaN(d.getTime())) counts[d.getDay()]++
      } catch { /* ignore */ }
    })
    return DIAS.map((label, i) => ({ label, count: counts[i] }))
  }, [filtered])

  const byHora = useMemo(() => {
    const counts = Array(24).fill(0) as number[]
    let hasTime = false
    filtered.forEach((b) => {
      const ts = b.horaTs || (b.data && b.data.length > 10 ? b.data : null)
      if (!ts) return
      try {
        const d = new Date(ts.replace(' ', 'T'))
        if (!isNaN(d.getTime())) {
          counts[d.getHours()]++
          hasTime = true
        }
      } catch { /* ignore */ }
    })
    if (!hasTime) return []
    return Array.from({ length: 24 }, (_, h) => ({
      label: `${String(h).padStart(2, '0')}h`,
      count: counts[h],
    }))
  }, [filtered])

  const takeRateByFaturamento = useMemo(() => {
    const map: Record<string, { total: number; comOb: number }> = {}
    filtered.forEach((b) => {
      if (!b.faturamento) return
      if (!map[b.faturamento]) map[b.faturamento] = { total: 0, comOb: 0 }
      map[b.faturamento].total++
      if (b.comprouOb1 || b.comprouOb2 || b.comprouOb3) map[b.faturamento].comOb++
    })
    return Object.entries(map)
      .filter(([, d]) => d.total >= 3)
      .map(([faixa, d]) => ({ faixa, takeRate: (d.comOb / d.total) * 100, total: d.total }))
      .sort((a, b) => b.takeRate - a.takeRate)
  }, [filtered])

  const link = selected !== 'Todos' ? criativoLinks[selected] : undefined

  return (
    <div className="space-y-6">
      {/* Creative selector */}
      <div className="flex items-center gap-4 flex-wrap">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="bg-[#111827] border border-[#1F2937] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
        >
          {criativos.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm rounded-lg hover:bg-cyan-500/20 transition-colors">
            <ExternalLink size={14} />
            Ver criativo
          </a>
        )}
        <span className="text-gray-500 text-sm">{filtered.length} compradores</span>
      </div>

      {/* Row 1: Sexo + Motivo da Aquisição */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Distribuição por Sexo</h2>
          <DonutChart data={toDonut(sexo)} height={220} />
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Motivo da Aquisição</h2>
          {motivoCompra.length > 0 ? (
            <HorizontalBar data={toHBar(motivoCompra)} valueFormatter={(v) => formatPercent(v)} color="#F97316" />
          ) : (
            <p className="text-sm text-gray-400 py-4">Sem dados de motivo no período</p>
          )}
        </div>
      </div>

      {/* Vendas por Hora — full width */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Vendas por Hora do Dia</h2>
        {byHora.length > 0 ? (
          <div className="flex gap-px items-end" style={{ height: 112 }}>
            {byHora.map((item) => {
              const max = Math.max(...byHora.map((h) => h.count), 1)
              const heightPct = max > 0 ? (item.count / max) * 100 : 0
              const isTop = item.count === max && item.count > 0
              return (
                <div key={item.label} className="flex-1 flex flex-col items-center justify-end gap-1">
                  <div className="w-full flex flex-col justify-end" style={{ height: 88 }}>
                    <div
                      className={`w-full rounded-sm transition-all duration-500 ${isTop ? 'bg-cyan-400' : 'bg-cyan-800'}`}
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                      title={`${item.label}: ${item.count} venda${item.count !== 1 ? 's' : ''}`}
                    />
                  </div>
                  <span className="text-[7px] text-gray-400 leading-none">{item.label}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Dados de horário não disponíveis</p>
        )}
      </div>

      {/* Dia da semana + Faixa Etária */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Vendas por Dia da Semana</h2>
          <div className="space-y-2">
            {byDia.map((item) => {
              const max = Math.max(...byDia.map((d) => d.count), 1)
              const pct = (item.count / max) * 100
              const isTop = item.count === max
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <span className={`text-xs w-7 shrink-0 ${isTop ? 'text-cyan-400 font-bold' : 'text-gray-500'}`}>{item.label}</span>
                  <div className="flex-1 bg-[#1F2937] rounded-full h-2">
                    <div className="h-2 rounded-full bg-cyan-500 transition-all duration-500"
                      style={{ width: `${pct}%`, opacity: 0.4 + pct * 0.006 }} />
                  </div>
                  <span className={`text-xs tabular-nums w-6 text-right ${isTop ? 'text-cyan-400 font-bold' : 'text-gray-500'}`}>{item.count}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Faixa Etária</h2>
          <HorizontalBar data={toHBar(faixaEtaria)} valueFormatter={(v) => formatPercent(v)} />
        </div>
      </div>

      {/* Row 3: Faturamento + Quanto sobra */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Faturamento Declarado</h2>
          <HorizontalBar data={toHBar(faturamento)} valueFormatter={(v) => formatPercent(v)} color="#10B981" />
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Quanto Sobra por Mês</h2>
          <HorizontalBar data={toHBar(quantoSobra)} valueFormatter={(v) => formatPercent(v)} color="#F59E0B" />
        </div>
      </div>

      {/* Row 4: Tempo + especialidades */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Tempo na Odontologia</h2>
          <HorizontalBar data={toHBar(tempoOdontologia)} valueFormatter={(v) => formatPercent(v)} color="#0E9F6E" />
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Top 10 Especialidades</h2>
          <HorizontalBar data={toHBar(especialidades)} valueFormatter={(v) => formatPercent(v)} color="#06B6D4" />
        </div>
      </div>

      {/* Tentou antes */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">O que Tentou Antes que Não Funcionou (Top 8)</h2>
        <HorizontalBar data={toHBar(tentouAntes)} valueFormatter={(v) => formatPercent(v)} color="#F43F5E" />
      </div>

      {/* Take rate por faturamento */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Take Rate OB por Faturamento</h2>
        {takeRateByFaturamento.length > 0 ? (
          <div className="space-y-2">
            {takeRateByFaturamento.map((row) => (
              <div key={row.faixa} className="flex items-center justify-between">
                <span className="text-xs text-gray-400 truncate max-w-xs">{row.faixa}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">n={row.total}</span>
                  <span className="text-sm font-semibold text-emerald-400">{formatPercent(row.takeRate)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Dados insuficientes</p>
        )}
      </div>
    </div>
  )
}
