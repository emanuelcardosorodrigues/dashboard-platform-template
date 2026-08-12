'use client'

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import BarChartLucro from '@/components/charts/BarChart'
import DonutChart from '@/components/charts/DonutChart'
import DataTable from '@/components/tables/DataTable'
import { tipoDaTransacao, type ProdutoTipo } from '@/lib/supabase'
import { segmentoCanal, SEGMENTO_LABEL, SEGMENTOS_ORDEM, type SegmentoCanal } from '@/lib/origem'
import { formatCurrency, formatRoas, formatPercent, formatDateBR, getFrontEndLabel, todayBR } from '@/lib/formatters'
import { liquidoHotmartTransacoes, liquidoHotmartVenda } from '@/lib/hotmartFees'
import { AlertTriangle } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { TransacaoLeve } from './page'
import type { FunilConfig } from '@/lib/funisConfig'
import type { PeriodSummary } from '@/lib/periodSummary'
import type { TicketFunil } from '@/lib/ticketFunil'
import DeltaBadge from '@/components/cards/DeltaBadge'

interface Props {
  transacoes: TransacaoLeve[]
  investimentoByDate: Record<string, number>
  funil: string
  funis: FunilConfig[]
  previousSummary?: PeriodSummary | null
  cmpLabel?: string
  /** Contribuição de cada produto no ticket médio (S3) — funil inteiro, blended (não varia por segmento de canal). */
  ticketFunil: TicketFunil
}

// Rótulos dos produtos não-front. O front-end usa getFrontEndLabel(funil).
const PRODUTO_LABELS: Record<string, string> = {
  ob1: 'OB1 – Script ANTI-Desconto',
  ob2: 'OB2 – Lucro Tributário Express',
  ob3: 'OB3 – Protocolo Dentista Parceiro Lucrativo',
  ob4: 'OB4 – Manual do Lucro Oculto no WhatsApp',
  upsell: 'Upsell – Implementação Lucro Oculto',
  downsell: 'Downsell – Implementação Express Lucro Oculto',
}

// Ordem canônica de exibição dos cards de produto.
const PRODUTO_ORDER: ProdutoTipo[] = ['frontEnd', 'ob1', 'ob2', 'ob3', 'ob4', 'upsell', 'downsell']

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1F2937] border border-[#374151] rounded-lg p-3 shadow-xl text-xs">
      <p className="text-gray-400 mb-2">{formatDateBR(label ?? '')}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-300">{p.name}:</span>
          <span className="text-white font-semibold">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function FinanceiroClient({ transacoes, investimentoByDate, funil, funis, previousSummary, cmpLabel, ticketFunil }: Props) {
  // Segmento de canal (Todas / Pago / Orgânico / Ascensão / Outros) — botão semântico
  // sobre o utm_medium. NÃO é o filtro de funil (que é blended); é pra segmentar a origem.
  const [segmento, setSegmento] = useState<SegmentoCanal | 'todas'>('todas')
  const segmentosPresentes = useMemo(() => {
    const set = new Set<SegmentoCanal>()
    for (const t of transacoes) set.add(segmentoCanal(t.utm_medium))
    return SEGMENTOS_ORDEM.filter((s) => set.has(s))
  }, [transacoes])

  // Tax rate state
  const [aliquotaInput, setAliquotaInput] = useState('6')
  const aliquota = Math.max(0, Math.min(100, parseFloat(aliquotaInput) || 0))

  // Filtra transações pelo segmento selecionado.
  const filtered = useMemo(
    () => (segmento === 'todas' ? transacoes : transacoes.filter((t) => segmentoCanal(t.utm_medium) === segmento)),
    [transacoes, segmento]
  )
  // Gasto Meta só entra no PAGO e em TODAS (blended). Orgânico/Ascensão/Outros NÃO têm
  // tráfego pago → investimento 0 → ROAS oculto (corrige o ROAS falso do rateio antigo).
  const incluiGasto = segmento === 'todas' || segmento === 'pago'
  const investimentoByDateEff = useMemo(
    () => (incluiGasto ? investimentoByDate : ({} as Record<string, number>)),
    [incluiGasto, investimentoByDate]
  )

  // By product
  const byProduct = useMemo(() => {
    const map: Record<string, { vendas: number; faturamento: number }> = {}
    filtered.forEach((t) => {
      const tipo = tipoDaTransacao(t, funis)
      if (!map[tipo]) map[tipo] = { vendas: 0, faturamento: 0 }
      map[tipo].vendas++
      map[tipo].faturamento += t.valor_bruto || 0
    })
    return map
  }, [filtered, funis])

  // Contribuição no ticket médio, agregada por ProdutoTipo (S3). `ticketFunil.produtos`
  // vem por NOME LITERAL do produto — casamos aqui somando por `.tipo` (um tipo pode
  // ter mais de um produto, ex.: várias adições ao OB1 com nomes ligeiramente
  // diferentes ao longo do tempo). Vem do funil INTEIRO (blended), independe do
  // segmento de canal selecionado acima — é a mesma base de `ticketFunil`.
  const contribuicaoPorTipo = useMemo(() => {
    const map: Partial<Record<ProdutoTipo, { vendas: number; contribuicao: number; pctTicket: number }>> = {}
    ticketFunil.produtos.forEach((p) => {
      const acc = map[p.tipo] ?? { vendas: 0, contribuicao: 0, pctTicket: 0 }
      acc.vendas += p.vendas
      acc.contribuicao += p.contribuicao
      acc.pctTicket += p.pctTicket
      map[p.tipo] = acc
    })
    return map
  }, [ticketFunil])

  // Totals. Investimento = gasto Meta do segmento (cheio no Pago/Todas; 0 nos demais).
  const totals = useMemo(() => {
    const faturamento = filtered.reduce((s, t) => s + (t.valor_bruto || 0), 0)
    const vendas = filtered.length  // toda transação Hotmart (front + OBs + upsell/downsell)
    // Compradores ÚNICOS no recorte (front + OB/upsell do mesmo email contam 1 vez).
    const compradores = new Set(filtered.map((t) => t.comprador).filter(Boolean)).size
    const investimento = Object.values(investimentoByDateEff).reduce((s, v) => s + v, 0)
    // Faturamento líquido = soma do líquido POR transação (taxa Hotmart canônica).
    // investimento já vem com o imposto Meta (×1,1382) aplicado no sync-meta.
    const faturamentoLiquido = liquidoHotmartTransacoes(filtered.map((t) => t.valor_bruto || 0))
    const lucroBruto = faturamento - investimento
    const lucroLiquido01 = faturamentoLiquido - investimento
    const temGasto = investimento > 0
    const roasBruto = temGasto ? faturamento / investimento : 0
    const roasLiquido = temGasto ? faturamentoLiquido / investimento : 0
    const ticketMedio = compradores > 0 ? faturamento / compradores : 0
    const margemBrutaPct = faturamento > 0 ? (lucroBruto / faturamento) * 100 : 0
    const margemLiqPct = faturamento > 0 ? (lucroLiquido01 / faturamento) * 100 : 0
    return { faturamento, vendas, compradores, investimento, temGasto, roasBruto, roasLiquido, lucroBruto, lucroLiquido01, ticketMedio, margemBrutaPct, margemLiqPct }
  }, [filtered, investimentoByDateEff])

  // Produtos exibidos na seção "por produto": todos quando funil = Todos,
  // senão apenas os tipos presentes nas transações do funil (+ front-end sempre).
  const productTypes = useMemo<ProdutoTipo[]>(() => {
    if (funil === 'all') return [...PRODUTO_ORDER]
    const present = new Set(transacoes.map((t) => tipoDaTransacao(t, funis)))
    return PRODUTO_ORDER.filter((t) => t === 'frontEnd' || present.has(t))
  }, [funil, transacoes, funis])

  // Valores do período anterior para as métricas novas (DeltaBadge).
  // receitaLiquida do período anterior já vem canônica do servidor (PeriodSummary)
  const prevFatLiq = previousSummary?.receitaLiquida ?? 0
  const prevRoasLiquido = previousSummary && previousSummary.investimento > 0 ? prevFatLiq / previousSummary.investimento : 0
  const prevLucroBruto = previousSummary ? previousSummary.faturamento - previousSummary.investimento : 0
  const prevLucroLiquido01 = previousSummary ? prevFatLiq - previousSummary.investimento : 0

  // Daily data (for charts and table)
  const dailyData = useMemo(() => {
    const byDate: Record<string, { faturamento: number; liquido: number; vendas: number; compradores: Set<string> }> = {}
    filtered.forEach((t) => {
      const date = t.data?.slice(0, 10)
      if (!date) return
      if (!byDate[date]) byDate[date] = { faturamento: 0, liquido: 0, vendas: 0, compradores: new Set() }
      byDate[date].faturamento += t.valor_bruto || 0
      byDate[date].liquido += liquidoHotmartVenda(t.valor_bruto || 0) // canônico, por transação
      byDate[date].vendas++
      if (t.comprador) byDate[date].compradores.add(t.comprador)
    })
    const allDates = new Set([...Object.keys(byDate), ...Object.keys(investimentoByDateEff)])
    return [...allDates].sort().map((date) => {
      const d = byDate[date] || { faturamento: 0, liquido: 0, vendas: 0, compradores: new Set<string>() }
      const investimento = investimentoByDateEff[date] || 0
      const lucro = d.liquido - investimento
      const roas = investimento > 0 ? d.faturamento / investimento : 0
      const ticketMedio = d.compradores.size > 0 ? d.faturamento / d.compradores.size : 0
      return {
        date,
        faturamento: Math.round(d.faturamento),
        liquido: d.liquido, // não-arredondado: base das acumulações/projeção
        investimento: Math.round(investimento),
        lucro: Math.round(lucro),
        roas,
        vendas: d.vendas,
        ticketMedio,
      }
    })
  }, [filtered, investimentoByDateEff])

  // Accumulated + 7d rolling ROAS
  const dataWithAccum = useMemo(() => {
    let fatAcum = 0, invAcum = 0, liqAcum = 0
    return dailyData.map((d, i) => {
      fatAcum += d.faturamento
      invAcum += d.investimento
      liqAcum += d.liquido
      const window = dailyData.slice(Math.max(0, i - 6), i + 1)
      const avgFat = window.reduce((s, x) => s + x.faturamento, 0)
      const avgInv = window.reduce((s, x) => s + x.investimento, 0)
      return {
        ...d,
        faturamentoAcumulado: fatAcum,
        investimentoAcumulado: invAcum,
        lucroAcumulado: liqAcum - invAcum, // líquido canônico acumulado
        roasMedia7d: avgInv > 0 ? avgFat / avgInv : 0,
      }
    })
  }, [dailyData])

  // Projeção 30d — média dos últimos 7 dias de calendário (BRT, não dos últimos 7
  // dias com dados). Sem dado num dia = zero, pra não inflar dividindo por menos.
  const projecao = useMemo(() => {
    const days: string[] = []
    const todayStr = todayBR()
    const base = new Date(todayStr + 'T12:00:00Z')  // meio-dia UTC pra evitar borda
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base); d.setUTCDate(base.getUTCDate() - i)
      days.push(d.toISOString().slice(0, 10))
    }
    const byDate = Object.fromEntries(dailyData.map((d) => [d.date, d]))
    const fat = days.reduce((s, day) => s + (byDate[day]?.faturamento ?? 0), 0)
    const inv = days.reduce((s, day) => s + (byDate[day]?.investimento ?? 0), 0)
    const liq = days.reduce((s, day) => s + (byDate[day]?.liquido ?? 0), 0)
    const faturamento = (fat / 7) * 30
    const investimento = (inv / 7) * 30
    // projeta o LÍQUIDO canônico pelo mesmo pace (não re-deriva taxa de agregado)
    return { faturamento, investimento, lucro: (liq / 7) * 30 - investimento }
  }, [dailyData])

  const impostoProjetado = projecao.faturamento * (aliquota / 100)
  const lucroAposImpostoProjetado = projecao.lucro - impostoProjetado

  // Pagamentos
  const pagamentos = useMemo(() => {
    const map: Record<string, { vendas: number; total: number }> = {}
    filtered.forEach((t) => {
      const pgto = t.forma_pagamento || ''
      const key = pgto.toLowerCase().includes('pix') ? 'Pix'
        : pgto.toLowerCase().includes('cart') || pgto.toLowerCase().includes('credit') ? 'Cartão'
        : pgto || 'Outro'
      if (!map[key]) map[key] = { vendas: 0, total: 0 }
      map[key].vendas++
      map[key].total += t.valor_bruto || 0
    })
    const totalV = Object.values(map).reduce((s, v) => s + v.vendas, 0)
    return Object.entries(map).map(([tipo, d]) => ({
      tipo, vendas: d.vendas, faturamento: d.total,
      pct: totalV > 0 ? (d.vendas / totalV) * 100 : 0,
    }))
  }, [filtered])

  type DailyRow = typeof dailyData[0] & Record<string, unknown>
  const tableColumns = [
    { key: 'date' as keyof DailyRow, label: 'Data', sortable: true, render: (v: DailyRow[keyof DailyRow]) => formatDateBR(String(v)) },
    { key: 'investimento' as keyof DailyRow, label: 'Investimento', sortable: true, align: 'right' as const, render: (v: DailyRow[keyof DailyRow]) => formatCurrency(Number(v)) },
    { key: 'faturamento' as keyof DailyRow, label: 'Faturamento', sortable: true, align: 'right' as const, render: (v: DailyRow[keyof DailyRow]) => formatCurrency(Number(v)) },
    { key: 'lucro' as keyof DailyRow, label: 'Lucro', sortable: true, align: 'right' as const, render: (v: DailyRow[keyof DailyRow]) => <span className={Number(v) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrency(Number(v))}</span> },
    { key: 'roas' as keyof DailyRow, label: 'ROAS', sortable: true, align: 'right' as const, render: (v: DailyRow[keyof DailyRow]) => totals.temGasto ? formatRoas(Number(v)) : '–' },
    { key: 'vendas' as keyof DailyRow, label: 'Vendas', sortable: true, align: 'right' as const },
    { key: 'ticketMedio' as keyof DailyRow, label: 'Ticket Médio', sortable: true, align: 'right' as const, render: (v: DailyRow[keyof DailyRow]) => Number(v) > 0 ? formatCurrency(Number(v)) : '-' },
  ]

  const donutData = pagamentos.map((p, i) => ({
    name: p.tipo, value: p.vendas,
    color: i === 0 ? '#06B6D4' : i === 1 ? '#10B981' : '#F59E0B',
  }))

  return (
    <div className="space-y-6">
      {/* Seletor de SEGMENTO de canal (Todas / Pago / Orgânico / Ascensão / Outros).
          Pago/Todas levam o gasto Meta (ROAS real/blended); os demais = só receita. */}
      {segmentosPresentes.length > 0 && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-400 uppercase tracking-wider shrink-0">Canal:</span>
          {(['todas', ...segmentosPresentes] as (SegmentoCanal | 'todas')[]).map((s) => (
            <button
              key={s}
              onClick={() => setSegmento(s)}
              className={clsx(
                'px-3 py-1 text-xs rounded-md border transition-colors cursor-pointer font-medium',
                segmento === s
                  ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                  : 'bg-transparent text-gray-500 border-[#1F2937] hover:text-gray-300'
              )}
            >
              {s === 'todas' ? 'Todas' : SEGMENTO_LABEL[s]}
            </button>
          ))}
          {!incluiGasto && (
            <span className="text-[11px] text-gray-500 ml-auto">sem tráfego pago neste segmento — ROAS/CPA não se aplicam</span>
          )}
        </div>
      )}

      {/* KPI cards */}
      {previousSummary && segmento !== 'todas' && (
        <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
          Comparação com o período anterior fica oculta no segmento “{SEGMENTO_LABEL[segmento]}”. Volte pra “Todas” pra ver o delta.
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Faturamento</p>
          <p className="text-2xl font-bold text-cyan-400">{formatCurrency(totals.faturamento)}</p>
          {previousSummary && segmento === 'todas' && (
            <div className="mt-2"><DeltaBadge current={totals.faturamento} previous={previousSummary.faturamento} label={cmpLabel} /></div>
          )}
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Investimento</p>
          <p className="text-2xl font-bold text-rose-400">{formatCurrency(totals.investimento)}</p>
          {previousSummary && segmento === 'todas' && (
            <div className="mt-2"><DeltaBadge current={totals.investimento} previous={previousSummary.investimento} invert label={cmpLabel} /></div>
          )}
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">ROAS Bruto</p>
          <p className="text-2xl font-bold text-white">{totals.temGasto ? formatRoas(totals.roasBruto) : '–'}</p>
          {previousSummary && segmento === 'todas' && (
            <div className="mt-2"><DeltaBadge current={totals.roasBruto} previous={previousSummary.roas} label={cmpLabel} /></div>
          )}
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">ROAS Líquido</p>
          <p className="text-2xl font-bold text-white">{totals.temGasto ? formatRoas(totals.roasLiquido) : '–'}</p>
          <p className="text-xs text-gray-500 mt-1">após taxas Hotmart</p>
          {previousSummary && segmento === 'todas' && (
            <div className="mt-2"><DeltaBadge current={totals.roasLiquido} previous={prevRoasLiquido} label={cmpLabel} /></div>
          )}
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Lucro Bruto</p>
          <p className={clsx('text-2xl font-bold', totals.lucroBruto >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
            {formatCurrency(totals.lucroBruto)}
          </p>
          <p className={clsx('text-xs mt-1', totals.lucroBruto >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
            {totals.margemBrutaPct.toFixed(1)}% de margem · faturamento − investimento
          </p>
          {previousSummary && segmento === 'todas' && (
            <div className="mt-2"><DeltaBadge current={totals.lucroBruto} previous={prevLucroBruto} label={cmpLabel} /></div>
          )}
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Lucro Líquido 01</p>
          <p className={clsx('text-2xl font-bold', totals.lucroLiquido01 >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
            {formatCurrency(totals.lucroLiquido01)}
          </p>
          <p className={clsx('text-xs mt-1', totals.lucroLiquido01 >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
            {totals.margemLiqPct.toFixed(1)}% de margem · após taxas Hotmart
          </p>
          {previousSummary && segmento === 'todas' && (
            <div className="mt-2"><DeltaBadge current={totals.lucroLiquido01} previous={prevLucroLiquido01} label={cmpLabel} /></div>
          )}
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Vendas Totais</p>
          <p className="text-2xl font-bold text-white">{totals.vendas}</p>
          {previousSummary && segmento === 'todas' && (
            <div className="mt-2"><DeltaBadge current={totals.vendas} previous={previousSummary.vendas} label={cmpLabel} /></div>
          )}
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Ticket Médio</p>
          <p className="text-2xl font-bold text-white">{totals.ticketMedio > 0 ? formatCurrency(totals.ticketMedio) : '–'}</p>
          <p className="text-xs text-gray-500 mt-1">faturamento ÷ {totals.compradores} {totals.compradores === 1 ? 'comprador' : 'compradores'}</p>
          {previousSummary && segmento === 'todas' && (
            <div className="mt-2"><DeltaBadge current={totals.ticketMedio} previous={previousSummary.ticketMedio} label={cmpLabel} /></div>
          )}
        </div>
      </div>

      {/* Faturamento e Vendas por Produto */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">Faturamento e Vendas por Produto</h2>
          {segmento !== 'todas' && (
            <p className="text-[10px] text-gray-500">
              Contribuição no ticket é do funil inteiro (todos os canais) — não muda com o filtro de Canal acima.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {productTypes.map((tipo) => {
            const d = byProduct[tipo] || { vendas: 0, faturamento: 0 }
            const pct = totals.faturamento > 0 ? (d.faturamento / totals.faturamento) * 100 : 0
            const contrib = contribuicaoPorTipo[tipo]
            const contribuicao = contrib?.contribuicao ?? 0
            const pctTicket = contrib?.pctTicket ?? 0
            const negativo = contribuicao < 0
            return (
              <div key={tipo} className="bg-[#1F2937] rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-3 leading-tight">{tipo === 'frontEnd' ? getFrontEndLabel(funil) : PRODUTO_LABELS[tipo]}</p>
                <p className="text-xl font-bold text-white">{d.vendas} <span className="text-sm font-normal text-gray-500">vendas</span></p>
                <p className="text-sm text-cyan-400 font-semibold mt-1">{formatCurrency(d.faturamento)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{pct.toFixed(1)}% do faturamento do período</p>

                {/* Contribuição no ticket médio (S3) — R$ líquido por venda front-end. */}
                <div className="mt-3 pt-3 border-t border-[#374151]">
                  <p className="text-[10px] text-gray-500">Contribuição no ticket (líquido)</p>
                  {ticketFunil.semDado ? (
                    <p className="text-sm font-bold text-gray-500 mt-0.5">SEM DADO</p>
                  ) : (
                    <>
                      <p className={clsx('text-sm font-bold tabular-nums mt-0.5', negativo ? 'text-rose-400' : 'text-emerald-400')}>
                        {formatCurrency(contribuicao)}
                      </p>
                      <p className={clsx('text-xs tabular-nums', negativo ? 'text-rose-400/80' : 'text-gray-500')}>
                        {formatPercent(pctTicket)} do ticket
                      </p>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Total das contribuições exibidas + ticket ao lado — SEM esconder se não fechar */}
        {(() => {
          const totalContribuicao = ticketFunil.semDado ? 0 : productTypes.reduce((s, tipo) => s + (contribuicaoPorTipo[tipo]?.contribuicao ?? 0), 0)
          const totalPctTicket = ticketFunil.semDado ? 0 : productTypes.reduce((s, tipo) => s + (contribuicaoPorTipo[tipo]?.pctTicket ?? 0), 0)
          return (
            <div className="mt-4 rounded-lg px-4 py-3 bg-[#1F2937]/60 border border-dashed border-[#374151] flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs font-medium text-gray-300">Soma das contribuições (todos os produtos exibidos)</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Σ contribuição por produto = ticket médio do funil (mesma soma, reagrupada).</p>
              </div>
              <div className="text-right">
                {ticketFunil.semDado ? (
                  <p className="text-sm font-bold text-gray-500">SEM DADO</p>
                ) : (
                  <p className={clsx('text-sm font-bold tabular-nums', totalContribuicao < 0 ? 'text-rose-400' : 'text-white')}>
                    {formatCurrency(totalContribuicao)}{' '}
                    <span className="text-xs text-gray-400 font-normal">({formatPercent(totalPctTicket)})</span>
                  </p>
                )}
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Ticket médio do funil: <span className="text-gray-300">{ticketFunil.semDado ? 'SEM DADO' : formatCurrency(ticketFunil.ticket)}</span>
                </p>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Accumulated chart */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Acumulado: Faturamento vs Investimento
        </h2>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={dataWithAccum} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="gradFat" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradInv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#F43F5E" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
            <XAxis dataKey="date" tickFormatter={(v) => { const p = String(v).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : v }} tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#1F2937' }} tickLine={false} />
            <YAxis tickFormatter={formatCurrency} tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} width={104} />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }} />
            <Area type="monotone" dataKey="faturamentoAcumulado" name="Faturamento" stroke="#06B6D4" strokeWidth={2} fill="url(#gradFat)" dot={false} />
            <Area type="monotone" dataKey="investimentoAcumulado" name="Investimento" stroke="#F43F5E" strokeWidth={2} fill="url(#gradInv)" dot={false} />
            <Area type="monotone" dataKey="lucroAcumulado" name="Lucro" stroke="#10B981" strokeWidth={2} fill="none" dot={false} strokeDasharray="4 2" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Lucro diário */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Lucro por Dia + Média Móvel ROAS (7d)
        </h2>
        <BarChartLucro data={dataWithAccum} showRoasLine={totals.temGasto} />
      </div>

      {/* Projeção + Imposto */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">
            Projeção 30 dias (média últimos 7 dias)
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Alíquota de imposto:</label>
            <div className="flex items-center gap-1 bg-[#1F2937] border border-[#374151] rounded-lg px-2 py-1">
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={aliquotaInput}
                onChange={(e) => setAliquotaInput(e.target.value)}
                className="w-12 bg-transparent text-sm text-white text-right focus:outline-none focus:ring-1 focus:ring-cyan-500/50 rounded"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </div>
        </div>
        {projecao.lucro < 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 mb-4 text-sm text-rose-300">
            <AlertTriangle size={16} className="shrink-0" />
            Lucro projetado negativo! Revise urgentemente o custo por aquisição.
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-[#1F2937] rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-2">Faturamento Projetado</p>
            <p className="text-xl font-bold text-cyan-400">{formatCurrency(projecao.faturamento)}</p>
          </div>
          <div className="bg-[#1F2937] rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-2">Investimento Projetado</p>
            <p className="text-xl font-bold text-rose-400">{formatCurrency(projecao.investimento)}</p>
          </div>
          <div className="bg-[#1F2937] rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-2">Imposto ({aliquota}%)</p>
            <p className="text-xl font-bold text-amber-400">{formatCurrency(impostoProjetado)}</p>
          </div>
          <div className="bg-[#1F2937] rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-2">Lucro após Imposto</p>
            <p className={clsx('text-xl font-bold', lucroAposImpostoProjetado >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
              {formatCurrency(lucroAposImpostoProjetado)}
            </p>
            <p className={clsx('text-xs mt-1', lucroAposImpostoProjetado >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
              {projecao.faturamento > 0 ? ((lucroAposImpostoProjetado / projecao.faturamento) * 100).toFixed(1) : '0.0'}% de margem
            </p>
          </div>
        </div>
      </div>

      {/* Tabela diária */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1F2937]">
          <h2 className="text-sm font-semibold text-white">Tabela Diária</h2>
        </div>
        <DataTable columns={tableColumns} data={dailyData as DailyRow[]} pageSize={15} rowKey={(_, i) => i} />
      </div>

      {/* Pagamentos */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Breakdown de Pagamentos
        </h2>
        {donutData.length > 0 ? (
          <>
            <DonutChart data={donutData} height={200} />
            <div className="mt-3 space-y-2">
              {pagamentos.map((p) => (
                <div key={p.tipo} className="flex justify-between text-sm">
                  <span className="text-gray-400">{p.tipo}</span>
                  <div className="text-right">
                    <span className="text-white font-medium">{p.vendas} vendas</span>
                    <span className="text-gray-500 ml-2">({formatPercent(p.pct)})</span>
                    <span className="text-gray-400 ml-2">{formatCurrency(p.faturamento)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-gray-400 text-sm">Sem dados disponíveis</p>
        )}
      </div>
    </div>
  )
}
