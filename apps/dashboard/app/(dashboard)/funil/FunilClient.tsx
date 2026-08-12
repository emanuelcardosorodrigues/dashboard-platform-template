'use client'

import { useState, useEffect, useMemo } from 'react'
import FunnelChart from '@/components/charts/FunnelChart'
import type { FunilEtapa } from '@/types'
import { formatPercent, formatNumber, formatCurrency } from '@/lib/formatters'
import { getSemaforoColor } from '@/lib/thresholds'
import type { TicketFunil } from '@/lib/ticketFunil'
import { clsx } from 'clsx'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

export interface FunilDayData {
  date: string
  vendasFront: number
  investimento: number
  cliques: number
  landingViews: number
  checkouts: number
  cpa: number
}

interface ObDetalhe {
  nome: string
  valor: number
  pctFrontEnd: number
}

interface Props {
  etapas: FunilEtapa[]
  obsDetalhados: ObDetalhe[]
  upsellsDetalhados?: ObDetalhe[]
  convPagina: number
  cpm?: number
  custos?: number[]
  mediaCompradoresDia?: number
  dailyData?: FunilDayData[]
  /** Contribuição de cada produto no ticket médio (S3) — mesmo recorte de obsDetalhados/upsellsDetalhados. */
  ticketFunil: TicketFunil
}

export default function FunilClient({ etapas, obsDetalhados, upsellsDetalhados = [], convPagina, cpm, custos, mediaCompradoresDia, dailyData, ticketFunil }: Props) {
  // Lookup nome literal do produto → contribuição no ticket (mesmo agrupamento de
  // computeTicketFunil, por t.produto). Usado pra decorar a seção OB/Upsell existente.
  const contribPorNome = useMemo(() => {
    const map = new Map<string, TicketFunil['produtos'][number]>()
    ticketFunil.produtos.forEach((p) => map.set(p.produto, p))
    return map
  }, [ticketFunil])
  // Vertical é o padrão (pedido do usuário); a escolha fica persistida em localStorage.
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('vertical')
  const [breakdownMode, setBreakdownMode] = useState<'ob' | 'upsell'>('ob')
  // Visibilidade de gráficos/taxas (Fase 5) — persistida em localStorage.
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      const r = localStorage.getItem('funil-hidden'); if (r) setHidden(JSON.parse(r))
      const o = localStorage.getItem('funil-orientation'); if (o === 'horizontal' || o === 'vertical') setOrientation(o)
    } catch { /* ignore */ }
  }, [])
  const pickOrientation = (o: 'horizontal' | 'vertical') => {
    setOrientation(o)
    try { localStorage.setItem('funil-orientation', o) } catch { /* ignore */ }
  }
  const toggleHidden = (k: string) => setHidden((prev) => {
    const next = { ...prev, [k]: !prev[k] }
    try { localStorage.setItem('funil-hidden', JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })
  // Bottleneck = menor performance relativa ao verde
  let bottleneckIdx = -1
  let lowestPerf = Infinity
  etapas.forEach((e, i) => {
    if (e.pctAnterior === undefined || !e.thresholdVerde) return
    const perf = e.pctAnterior / e.thresholdVerde
    if (perf < lowestPerf) { lowestPerf = perf; bottleneckIdx = i }
  })

  // Taxas de conversão derivadas das etapas
  const ctr          = etapas[1]?.pctAnterior ?? 0
  const carregamento = etapas[2]?.pctAnterior ?? 0
  const passagem     = etapas[3]?.pctAnterior ?? 0
  const cvsCheckout  = etapas[4]?.pctAnterior ?? 0
  const cvsOBMedia   = etapas[5]?.pctAnterior ?? 0

  // Conversão de Clique: vendas front / cliques no link
  const convClique = (etapas[1]?.valor ?? 0) > 0 && (etapas[4]?.valor ?? 0) > 0
    ? (etapas[4].valor / etapas[1].valor) * 100
    : 0

  const rateItems = [
    { label: 'CTR',             value: ctr,          key: 'ctr'                  as const },
    { label: 'Carregamento',    value: carregamento,  key: 'taxaCarregamento'     as const },
    { label: 'Passagem',        value: passagem,      key: 'taxaPassagemCheckout' as const },
    { label: 'CVS Checkout',    value: cvsCheckout,   key: 'cvrCheckout'          as const },
    { label: 'CVS OB (média)',  value: cvsOBMedia,    key: 'takeRateOB'           as const },
    { label: 'Conv. Página',    value: convPagina,    key: 'txConversaoPagina'    as const },
  ]

  if (etapas.length === 0) {
    return (
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-10 text-center">
        <p className="text-sm text-gray-400">Sem dados de funil no período selecionado.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Meta checkout data delay warning */}
      {(etapas[2]?.valor ?? 0) > 0 && (etapas[3]?.valor ?? 0) === 0 && (
        <div className="flex items-start gap-3 rounded-xl p-4 border bg-yellow-500/10 border-yellow-500/30">
          <div>
            <p className="text-sm font-semibold text-yellow-300">
              Dados de checkout do Meta ainda não disponíveis
            </p>
            <p className="text-xs mt-0.5 text-yellow-200/70">
              Os eventos &quot;Iniciaram Checkout&quot; levam algumas horas para aparecer no Meta Ads.
              As métricas de Passagem e CVS Checkout serão preenchidas automaticamente.
            </p>
          </div>
        </div>
      )}

      {/* Bottleneck alert */}
      {bottleneckIdx >= 0 && lowestPerf < 1 && (
        <div className="flex items-start gap-3 rounded-xl p-4 border bg-rose-500/10 border-rose-500/30">
          <div>
            <p className="text-sm font-semibold text-rose-300">
              Gargalo identificado: {etapas[bottleneckIdx].nome}
            </p>
            <p className="text-xs mt-0.5 text-rose-200/70">
              {formatPercent(etapas[bottleneckIdx].pctAnterior ?? 0)} de conversão — meta verde é{' '}
              {formatPercent(etapas[bottleneckIdx].thresholdVerde ?? 0)}{' '}
              ({Math.round(lowestPerf * 100)}% do benchmark).
              Foque em melhorar esta etapa para maior impacto no resultado.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funil visual */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
          <div className="flex items-center justify-between mb-6 gap-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">
              Funil de Conversão
            </h2>
            <div className="flex gap-0.5 bg-[#1F2937] rounded-lg p-0.5">
              {(['horizontal', 'vertical'] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => pickOrientation(o)}
                  className={clsx('px-2.5 py-1 text-[11px] rounded-md capitalize transition-colors cursor-pointer',
                    orientation === o ? 'bg-cyan-500 text-white' : 'text-gray-400 hover:text-white')}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <FunnelChart etapas={etapas.slice(0, 5)} orientation={orientation} cpm={cpm} custos={custos} />
        </div>

        {/* Taxas de Conversão Chave */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-3">
            Taxas de Conversão Chave
          </h2>
          <div className="flex flex-wrap gap-1 mb-3">
            {rateItems.map((item) => (
              <button
                key={item.label}
                onClick={() => toggleHidden('rate:' + item.label)}
                title={hidden['rate:' + item.label] ? 'Mostrar' : 'Ocultar'}
                className={clsx('px-2 py-0.5 text-[10px] rounded-full border transition-colors cursor-pointer',
                  hidden['rate:' + item.label] ? 'border-[#1F2937] text-gray-400' : 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10')}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {/* Conv. Clique em destaque */}
            <div className="bg-[#1F2937] rounded-lg px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Conv. Clique</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Vendas ÷ Cliques no link</p>
              </div>
              <p className={clsx(
                'text-lg font-bold tabular-nums',
                convClique >= 1   ? 'text-emerald-400' :
                convClique >= 0.5 ? 'text-amber-400'   : 'text-rose-400'
              )}>
                {convClique > 0 ? formatPercent(convClique) : '–'}
              </p>
            </div>

            {/* Compradores / dia */}
            {mediaCompradoresDia !== undefined && mediaCompradoresDia > 0 && (
              <div className="bg-[#1F2937] rounded-lg px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400">Compradores / dia</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Vendas front ÷ dias no período</p>
                </div>
                <p className="text-sm font-bold tabular-nums text-cyan-400">
                  {formatNumber(mediaCompradoresDia, 1)}
                </p>
              </div>
            )}

            {/* Demais taxas (filtradas pela seleção) */}
            {rateItems.filter((item) => !hidden['rate:' + item.label]).map((item) => {
              const color = getSemaforoColor(item.key, item.value)
              const colorCss =
                color === 'green'  ? 'text-emerald-400' :
                color === 'yellow' ? 'text-amber-400'   : 'text-rose-400'
              return (
                <div key={item.label} className="bg-[#1F2937] rounded-lg px-4 py-2.5 flex items-center justify-between">
                  <p className="text-xs text-gray-400">{item.label}</p>
                  <p className={clsx('text-sm font-bold tabular-nums', colorCss)}>
                    {item.value > 0 ? formatPercent(item.value) : '–'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Gráfico dia-a-dia — 4 métricas de conversão */}
      {dailyData && dailyData.length > 1 && (() => {
        const safe = (a: number, b: number): number | null => b > 0 ? (a / b) * 100 : null
        const charts: { title: string; color: string; data: { date: string; value: number | null }[] }[] = [
          {
            title: 'Conv. Clique → Venda',
            color: '#6366f1',
            data: dailyData.map((d) => ({ date: d.date.slice(8) + '/' + d.date.slice(5, 7), value: safe(d.vendasFront, d.cliques) })),
          },
          {
            title: 'Conv. Pág → Checkout',
            color: '#f59e0b',
            data: dailyData.map((d) => ({ date: d.date.slice(8) + '/' + d.date.slice(5, 7), value: safe(d.checkouts, d.landingViews) })),
          },
          {
            title: 'Carregamento da Página',
            color: '#06b6d4',
            data: dailyData.map((d) => ({ date: d.date.slice(8) + '/' + d.date.slice(5, 7), value: safe(d.landingViews, d.cliques) })),
          },
          {
            title: 'Conv. Checkout → Venda',
            color: '#10b981',
            data: dailyData.map((d) => ({ date: d.date.slice(8) + '/' + d.date.slice(5, 7), value: safe(d.vendasFront, d.checkouts) })),
          },
        ]
        const visibleCharts = charts.filter((c) => !hidden['chart:' + c.title])
        return (
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">
                Taxas de Conversão — Dia a Dia
              </h2>
              <div className="flex flex-wrap gap-1">
                {charts.map((c) => (
                  <button
                    key={c.title}
                    onClick={() => toggleHidden('chart:' + c.title)}
                    title={hidden['chart:' + c.title] ? 'Mostrar' : 'Ocultar'}
                    className={clsx('px-2 py-0.5 text-[10px] rounded-full border transition-colors cursor-pointer',
                      hidden['chart:' + c.title] ? 'border-[#1F2937] text-gray-400' : 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10')}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            </div>
            {visibleCharts.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">Nenhum gráfico selecionado.</p>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {visibleCharts.map((chart) => (
                <div key={chart.title}>
                  <p className="text-xs text-gray-400 mb-2">{chart.title}</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={chart.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                      <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} stroke="#1F2937" />
                      <YAxis
                        tick={{ fill: '#6B7280', fontSize: 10 }}
                        stroke="#1F2937"
                        width={36}
                        tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                      />
                      <Tooltip
                        contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                        formatter={(v) => [`${Number(v).toFixed(2)}%`, chart.title]}
                        labelStyle={{ color: '#9CA3AF' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={chart.color}
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
            )}
          </div>
        )
      })()}

      {/* OB / Upsell breakdown */}
      {(obsDetalhados.length > 0 || upsellsDetalhados.length > 0) && (() => {
        const list = breakdownMode === 'ob' ? obsDetalhados : upsellsDetalhados
        const semDado = ticketFunil.semDado
        // Total do RECORTE EXIBIDO (só OB ou só Upsell/Downsell, conforme o toggle) —
        // deliberadamente uma FATIA do ticket, não o ticket inteiro (front-end e o
        // outro grupo completam o resto). Mostrado ao lado do ticket pra deixar
        // a diferença visível, nunca escondida.
        const totalContribuicao = semDado ? 0 : list.reduce((s, ob) => s + (contribPorNome.get(ob.nome)?.contribuicao ?? 0), 0)
        const totalPctTicket = semDado ? 0 : list.reduce((s, ob) => s + (contribPorNome.get(ob.nome)?.pctTicket ?? 0), 0)
        return (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 gap-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">
              Conversão por {breakdownMode === 'ob' ? 'Order Bump' : 'Upsell / Downsell'}
            </h2>
            <div className="flex gap-0.5 bg-[#1F2937] rounded-lg p-0.5">
              {([['ob', 'Order Bumps'], ['upsell', 'Upsell']] as const).map(([m, lbl]) => (
                <button
                  key={m}
                  onClick={() => setBreakdownMode(m)}
                  className={clsx('px-2.5 py-1 text-[11px] rounded-md transition-colors cursor-pointer',
                    breakdownMode === m ? 'bg-cyan-500 text-white' : 'text-gray-400 hover:text-white')}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {list.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">
              Sem dados de {breakdownMode === 'ob' ? 'order bumps' : 'upsell/downsell'} no período.
            </p>
          ) : (
          <div className="space-y-3">
            {list.map((ob) => {
              const contrib = contribPorNome.get(ob.nome)
              const contribuicao = contrib?.contribuicao ?? 0
              const pctTicket = contrib?.pctTicket ?? 0
              const negativo = contribuicao < 0
              return (
              <div key={ob.nome} className="bg-[#1F2937] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-white font-medium">{ob.nome}</p>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-400">{ob.valor} vendas</span>
                    <span className={clsx(
                      'text-base font-bold tabular-nums',
                      ob.pctFrontEnd >= 30 ? 'text-emerald-400' :
                      ob.pctFrontEnd >= 15 ? 'text-amber-400' : 'text-rose-400'
                    )}>
                      {formatPercent(ob.pctFrontEnd)}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-[#374151] rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full',
                      ob.pctFrontEnd >= 30 ? 'bg-emerald-400' :
                      ob.pctFrontEnd >= 15 ? 'bg-amber-400' : 'bg-rose-500'
                    )}
                    style={{ width: `${Math.min(ob.pctFrontEnd, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">% dos compradores do front-end</p>

                {/* Contribuição no ticket médio (S3) — R$ líquido por venda front-end. */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#374151]">
                  <div>
                    <p className="text-xs text-gray-400">Contribuição no ticket</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">R$ líquido ÷ venda front-end</p>
                  </div>
                  {semDado ? (
                    <p className="text-sm font-bold text-gray-500">SEM DADO</p>
                  ) : (
                    <div className="text-right">
                      <p className={clsx('text-sm font-bold tabular-nums', negativo ? 'text-rose-400' : 'text-emerald-400')}>
                        {formatCurrency(contribuicao)}
                      </p>
                      <p className={clsx('text-xs tabular-nums', negativo ? 'text-rose-400/80' : 'text-gray-400')}>
                        {formatPercent(pctTicket)} do ticket
                      </p>
                    </div>
                  )}
                </div>
              </div>
              )
            })}

            {/* Total do recorte exibido + ticket ao lado — SEM esconder se não fechar */}
            <div className="rounded-lg px-4 py-3 bg-[#1F2937]/60 border border-dashed border-[#374151] flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs font-medium text-gray-300">
                  Total — {breakdownMode === 'ob' ? 'Order Bumps' : 'Upsell/Downsell'} exibidos
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Front-end e o outro grupo (não exibido neste recorte) completam o restante do ticket.
                </p>
              </div>
              <div className="text-right">
                {semDado ? (
                  <p className="text-sm font-bold text-gray-500">SEM DADO</p>
                ) : (
                  <p className={clsx('text-sm font-bold tabular-nums', totalContribuicao < 0 ? 'text-rose-400' : 'text-white')}>
                    {formatCurrency(totalContribuicao)}{' '}
                    <span className="text-xs text-gray-400 font-normal">({formatPercent(totalPctTicket)} do ticket)</span>
                  </p>
                )}
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Ticket médio do funil: <span className="text-gray-300">{semDado ? 'SEM DADO' : formatCurrency(ticketFunil.ticket)}</span>
                </p>
              </div>
            </div>

            {/* Produtos que a ATRIBUIÇÃO trouxe pro recorte mas são de OUTRO funil.
                Ficam fora do ticket de propósito — uma venda de Protocolo LucroOculto
                pela página col-web01 é receita creditada ao COL, mas não é produto do
                COL e não pode diluir o ticket dele. Mostrado pra ninguém procurar o
                dinheiro que "sumiu" entre o faturamento e a soma das contribuições. */}
            {ticketFunil.foraDoFunil.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[#1F2937]">
                <p className="text-xs text-gray-400 mb-1.5">
                  Fora do ticket — produto de outro funil que chegou por atribuição
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {ticketFunil.foraDoFunil.map((p) => (
                    <span key={p.produto} className="text-[11px] text-gray-500 tabular-nums">
                      {p.produto} <span className="text-gray-600">({p.vendas}× · {formatCurrency(p.liquidoTotal)})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </div>
        )
      })()}
    </div>
  )
}
