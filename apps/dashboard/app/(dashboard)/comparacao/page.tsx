export const dynamic = 'force-dynamic'

import Header from '@/components/layout/Header'
import KpiCard from '@/components/cards/KpiCard'
import DeltaBadge from '@/components/cards/DeltaBadge'
import { computePeriodSummary, type PeriodSummary } from '@/lib/periodSummary'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel, type CompareMode } from '@/lib/comparePeriods'
import { formatCurrency, formatCurrencyCompact, formatPercent, formatRoas, formatNumber, daysAgoBR, todayBR } from '@/lib/formatters'
import { GitCompare, AlertCircle } from 'lucide-react'

type Search = Promise<{
  de?: string; ate?: string; funil?: string; conta?: string
  cmp?: string; cmpDe?: string; cmpAte?: string
}>

export default async function ComparacaoPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const de = sp.de || daysAgoBR(30)
  const ate = sp.ate || todayBR()
  const funil = sp.funil ?? 'all'
  const conta = sp.conta ?? 'all'
  const mode: CompareMode = parseCompareMode(sp.cmp)
  // Respeita mode === 'none': computeComparisonRange já retorna null nesse caso,
  // então "previous" fica null e a UI cai no banner de aviso (em vez do diff).
  const cmpRange = computeComparisonRange(de, ate, mode, sp.cmpDe, sp.cmpAte)

  const [current, previous] = await Promise.all([
    computePeriodSummary(de, ate, funil, conta),
    cmpRange ? computePeriodSummary(cmpRange.from, cmpRange.to, funil, conta) : null,
  ])

  const cmpLabel = previous ? formatComparisonLabel(mode, cmpRange) : ''

  return (
    <div className="flex flex-col h-full">
      <Header title="Comparação entre Períodos" subtitle="Diff completo lado a lado" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Banner ranges */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl px-5 py-4 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <GitCompare size={14} className="text-cyan-400" />
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Comparação</span>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Atual</p>
            <p className="text-sm font-semibold text-white tabular-nums">{de} → {ate}</p>
          </div>
          {previous ? (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">{cmpLabel.replace(/^vs\.\s*/, '')}</p>
              <p className="text-sm font-semibold text-cyan-300 tabular-nums">{previous.range.from} → {previous.range.to}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <AlertCircle size={12} />
              <span>Selecione um modo de comparação no cabeçalho para ver o diff.</span>
            </div>
          )}
        </div>

        {/* KPI grid */}
        {previous && (
          <>
            <section className="space-y-3">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">Resultados Financeiros</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KpiCard label="Faturamento" value={formatCurrencyCompact(current.faturamento)}
                  size="lg" compare={{ current: current.faturamento, previous: previous.faturamento, label: cmpLabel }} />
                <KpiCard label="Lucro Bruto" value={formatCurrencyCompact(current.lucro)}
                  size="lg" compare={{ current: current.lucro, previous: previous.lucro, label: cmpLabel }} />
                <KpiCard label="Investimento" value={formatCurrencyCompact(current.investimento)}
                  size="lg" compare={{ current: current.investimento, previous: previous.investimento, invert: true, label: cmpLabel }} />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">Eficiência</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="ROAS" value={formatRoas(current.roas)}
                  compare={{ current: current.roas, previous: previous.roas, label: cmpLabel }} />
                <KpiCard label="CPA" value={current.cpa > 0 ? formatCurrency(current.cpa) : '–'}
                  compare={{ current: current.cpa, previous: previous.cpa, invert: true, label: cmpLabel }} />
                <KpiCard label="CPC" value={current.cpc > 0 ? formatCurrency(current.cpc) : '–'}
                  compare={{ current: current.cpc, previous: previous.cpc, invert: true, label: cmpLabel }} />
                <KpiCard label="CPM" value={current.cpm > 0 ? formatCurrency(current.cpm) : '–'}
                  compare={{ current: current.cpm, previous: previous.cpm, invert: true, label: cmpLabel }} />
                <KpiCard label="Ticket Médio" value={current.ticketMedio > 0 ? formatCurrency(current.ticketMedio) : '–'}
                  compare={{ current: current.ticketMedio, previous: previous.ticketMedio, label: cmpLabel }} />
                <KpiCard label="CTR" value={formatPercent(current.ctr)}
                  compare={{ current: current.ctr, previous: previous.ctr, label: cmpLabel }} />
                <KpiCard label="Conv. Página" value={formatPercent(current.convPagina)}
                  compare={{ current: current.convPagina, previous: previous.convPagina, label: cmpLabel }} />
                <KpiCard label="Conv. Clique" value={formatPercent(current.convClique)}
                  compare={{ current: current.convClique, previous: previous.convClique, label: cmpLabel }} />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">Volume</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="Compradores Front" value={formatNumber(current.vendasFront)}
                  compare={{ current: current.vendasFront, previous: previous.vendasFront, label: cmpLabel }} />
                <KpiCard label="Compradores / dia" value={formatNumber(current.compradoresPorDia, 1)}
                  compare={{ current: current.compradoresPorDia, previous: previous.compradoresPorDia, label: cmpLabel }} />
                <KpiCard label="Checkouts" value={formatNumber(current.checkouts)}
                  compare={{ current: current.checkouts, previous: previous.checkouts, label: cmpLabel }} />
                <KpiCard label="Landing Views" value={formatNumber(current.landingViews)}
                  compare={{ current: current.landingViews, previous: previous.landingViews, label: cmpLabel }} />
                <KpiCard label="Cliques" value={formatNumber(current.cliques)}
                  compare={{ current: current.cliques, previous: previous.cliques, label: cmpLabel }} />
                <KpiCard label="Impressões" value={formatNumber(current.impressoes)}
                  compare={{ current: current.impressoes, previous: previous.impressoes, label: cmpLabel }} />
                <KpiCard label="Total Vendas Hotmart" value={formatNumber(current.vendas)}
                  compare={{ current: current.vendas, previous: previous.vendas, label: cmpLabel }} />
                <KpiCard label="Take Rate OBs" value={formatPercent(current.takeRateOB)}
                  compare={{ current: current.takeRateOB, previous: previous.takeRateOB, label: cmpLabel }} />
              </div>
            </section>

            {/* Tabela diff completa */}
            <section>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-3">Tabela Completa</h2>
              <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="border-b border-[#1F2937]">
                    <tr>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Métrica</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium">Atual</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium">{cmpLabel.replace(/^vs\.\s*/, '')}</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows(current, previous).map((row) => (
                      <tr key={row.label} className="border-b border-[#1F2937]/60 hover:bg-[#1F2937]/30 transition-colors">
                        <td className="px-4 py-2 text-gray-300">{row.label}</td>
                        <td className="px-4 py-2 text-right text-white tabular-nums">{row.fmt(row.curr)}</td>
                        <td className="px-4 py-2 text-right text-gray-400 tabular-nums">{row.fmt(row.prev)}</td>
                        <td className="px-4 py-2 text-right">
                          <div className="inline-flex justify-end">
                            <DeltaBadge current={row.curr} previous={row.prev} invert={row.invert} size="sm" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

interface Row {
  label: string
  curr: number
  prev: number
  fmt: (v: number) => string
  invert?: boolean
}

function tableRows(c: PeriodSummary, p: PeriodSummary): Row[] {
  const cur = (v: number) => formatCurrencyCompact(v)
  const curFull = (v: number) => v > 0 ? formatCurrency(v) : '–'
  const pct = (v: number) => formatPercent(v)
  const num = (v: number) => formatNumber(v)
  const numDec = (v: number) => formatNumber(v, 1)
  const roas = (v: number) => formatRoas(v)

  return [
    { label: 'Faturamento',         curr: c.faturamento,     prev: p.faturamento,     fmt: cur },
    { label: 'Investimento',        curr: c.investimento,    prev: p.investimento,    fmt: cur, invert: true },
    { label: 'Lucro Bruto',         curr: c.lucro,           prev: p.lucro,           fmt: cur },
    { label: 'Ticket Médio',        curr: c.ticketMedio,     prev: p.ticketMedio,     fmt: curFull },
    { label: 'ROAS',                curr: c.roas,            prev: p.roas,            fmt: roas },
    { label: 'CPA',                 curr: c.cpa,             prev: p.cpa,             fmt: curFull, invert: true },
    { label: 'CPC',                 curr: c.cpc,             prev: p.cpc,             fmt: curFull, invert: true },
    { label: 'CPM',                 curr: c.cpm,             prev: p.cpm,             fmt: curFull, invert: true },
    { label: 'CTR',                 curr: c.ctr,             prev: p.ctr,             fmt: pct },
    { label: 'Carregamento',        curr: c.carregamento,    prev: p.carregamento,    fmt: pct },
    { label: 'Passagem Página',     curr: c.passagemPagina,  prev: p.passagemPagina,  fmt: pct },
    { label: 'Conv. Checkout',      curr: c.conversaoCheckout,prev: p.conversaoCheckout,fmt: pct },
    { label: 'Conv. Página',        curr: c.convPagina,      prev: p.convPagina,      fmt: pct },
    { label: 'Conv. Clique',        curr: c.convClique,      prev: p.convClique,      fmt: pct },
    { label: 'Take Rate OBs',       curr: c.takeRateOB,      prev: p.takeRateOB,      fmt: pct },
    { label: 'Impressões',          curr: c.impressoes,      prev: p.impressoes,      fmt: num },
    { label: 'Cliques',             curr: c.cliques,         prev: p.cliques,         fmt: num },
    { label: 'Landing Views',       curr: c.landingViews,    prev: p.landingViews,    fmt: num },
    { label: 'Checkouts',           curr: c.checkouts,       prev: p.checkouts,       fmt: num },
    { label: 'Vendas (todas)',      curr: c.vendas,          prev: p.vendas,          fmt: num },
    { label: 'Compradores Front',   curr: c.vendasFront,     prev: p.vendasFront,     fmt: num },
    { label: 'Compradores / dia',   curr: c.compradoresPorDia,prev: p.compradoresPorDia,fmt: numDec },
    { label: 'OB1 Script',          curr: c.vendasOB1,       prev: p.vendasOB1,       fmt: num },
    { label: 'OB2 Tributário',      curr: c.vendasOB2,       prev: p.vendasOB2,       fmt: num },
    { label: 'OB3 Protocolo',       curr: c.vendasOB3,       prev: p.vendasOB3,       fmt: num },
    { label: 'OB4 Manual',          curr: c.vendasOB4,       prev: p.vendasOB4,       fmt: num },
  ]
}
