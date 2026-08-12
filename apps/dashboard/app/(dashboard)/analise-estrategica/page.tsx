export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchQualificacao, fetchTransacoes, fetchMetaAds, fetchFunisConfig, getDateRange, filterTransacoesByFunil, filterByFunil, filterByAccount, scoreQualificacao, tipoDaTransacao } from '@/lib/supabase'
import AnaliseEstrategicaClient from './AnaliseEstrategicaClient'
import ComparisonHero from '@/components/cards/ComparisonHero'
import { computePeriodSummary } from '@/lib/periodSummary'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel } from '@/lib/comparePeriods'

interface CriativoInsight {
  criativo: string; tipo: string; vendas: number; ticketMedio: number; cpa: number
  pctQualificados: number; pctSemi: number; pctLeads: number
  topDores: string[]; topMedos: string[]; topObjetivos: string[]
  faturamentoModa: string; alunosMentoria: number
}

interface CanalData {
  canal: string; vendas: number; faturamento: number; pctTotal: number; ticketMedio?: number; pctQualificados?: number
}

export default async function AnaliseEstrategicaPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string; cmp?: string; cmpDe?: string; cmpAte?: string }> }) {
  const { de = '', ate = '', funil = 'all', conta = 'all', cmp, cmpDe, cmpAte } = await searchParams
  const cmpMode = parseCompareMode(cmp)
  const cmpRange = computeComparisonRange(de, ate, cmpMode, cmpDe, cmpAte)
  const cmpLabel = cmpRange ? formatComparisonLabel(cmpMode, cmpRange) : ''
  return (
    <div className="flex flex-col h-full">
      <Header title="Análise Estratégica" subtitle="Inteligência de mercado para criação de criativos" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-96 animate-pulse" />}>
          <AnaliseContent de={de} ate={ate} funil={funil} conta={conta} cmpFrom={cmpRange?.from} cmpTo={cmpRange?.to} cmpLabel={cmpLabel} />
        </Suspense>
      </div>
    </div>
  )
}

function moda(arr: string[]): string {
  if (!arr.length) return '-'
  const counts: Record<string, number> = {}
  arr.forEach((v) => { if (v) counts[v] = (counts[v] ?? 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-'
}

function topN(arr: string[], n: number): string[] {
  const counts: Record<string, number> = {}
  arr.forEach((v) => { if (v) counts[v] = (counts[v] ?? 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
}

async function AnaliseContent({ de, ate, funil, conta, cmpFrom, cmpTo, cmpLabel }: { de: string; ate: string; funil: string; conta: string; cmpFrom?: string; cmpTo?: string; cmpLabel?: string }) {
  const { from, to } = getDateRange(de, ate)
  const [qualRows, allTransacoes, allMeta] = await Promise.all([fetchQualificacao(), fetchTransacoes(), fetchMetaAds()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const funis = await fetchFunisConfig()
  const dateFilteredTransacoes = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)))
  const transacoes = filterTransacoesByFunil(dateFilteredTransacoes, funil, accountFiltered, funis).filter((t) => (t.valor_bruto || 0) > 1)
  const qualMap = new Map(qualRows.map((q) => [q.email.toLowerCase(), q]))

  // MetaAds filtrado por funil e período — para CPA e investimento por criativo
  const metaFiltrado = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, funis)
  const totalInvestimento = metaFiltrado.reduce((s, r) => s + (r.investimento || 0), 0)
  const metaMapCriativo: Record<string, number> = {}
  metaFiltrado.forEach((r) => {
    const key = r.ad_name || r.criativo || 'Sem nome'
    metaMapCriativo[key] = (metaMapCriativo[key] ?? 0) + (r.investimento || 0)
  })

  // Ticket médio por criativo (from transacoes) — sempre usando vendasFront como denominador
  const ticketMap: Record<string, { faturamento: number; vendas: number; vendasFront: number }> = {}
  transacoes.forEach((t) => {
    const key = t.criativo || 'Sem criativo'
    if (!ticketMap[key]) ticketMap[key] = { faturamento: 0, vendas: 0, vendasFront: 0 }
    ticketMap[key].faturamento += t.valor_bruto || 0
    ticketMap[key].vendas++
    if (tipoDaTransacao(t) === 'frontEnd') ticketMap[key].vendasFront++
  })

  // Build criativo → buyer insights
  type CriaEntry = { dores: string[]; medos: string[]; objetivos: string[]; faturamentos: string[]; qualificados: number; semi: number; leads: number }
  const criaMap: Record<string, CriaEntry> = {}
  transacoes.forEach((t) => {
    const criativo = t.criativo || 'Sem criativo'
    const qual = qualMap.get(t.email?.toLowerCase() ?? '')
    if (!criaMap[criativo]) criaMap[criativo] = { dores: [], medos: [], objetivos: [], faturamentos: [], qualificados: 0, semi: 0, leads: 0 }
    const entry = criaMap[criativo]
    if (qual?.tem_ficha) {
      const score = scoreQualificacao(qual)
      if (score === 'Qualificado') entry.qualificados++
      else if (score === 'Semi-qualificado') entry.semi++
      else entry.leads++
      if (qual.maior_dificuldade) entry.dores.push(qual.maior_dificuldade)
      if (qual.medos) entry.medos.push(qual.medos)
      if (qual.objetivos) entry.objetivos.push(qual.objetivos)
      if (qual.faturamento_declarado) entry.faturamentos.push(qual.faturamento_declarado)
    } else {
      entry.leads++
    }
  })

  const criativos: CriativoInsight[] = Object.entries(ticketMap)
    .filter(([nome]) => nome)
    .map(([nome, m]) => {
      const data = criaMap[nome]
      const total = (data?.qualificados ?? 0) + (data?.semi ?? 0) + (data?.leads ?? 0) || 1
      return {
        criativo: nome, tipo: 'video', vendas: m.vendas,
        ticketMedio: m.vendasFront > 0 ? m.faturamento / m.vendasFront : 0,
        cpa: m.vendasFront > 0 && (metaMapCriativo[nome] ?? 0) > 0 ? metaMapCriativo[nome] / m.vendasFront : 0,
        pctQualificados: data ? (data.qualificados / total) * 100 : 0,
        pctSemi: data ? (data.semi / total) * 100 : 0,
        pctLeads: data ? (data.leads / total) * 100 : 0,
        topDores: topN(data?.dores ?? [], 3), topMedos: topN(data?.medos ?? [], 3),
        topObjetivos: topN(data?.objetivos ?? [], 2),
        faturamentoModa: moda(data?.faturamentos ?? []), alunosMentoria: 0,
      }
    })
    .sort((a, b) => b.vendas - a.vendas).slice(0, 8)

  // Canais último toque
  const canaisMap: Record<string, { vendas: number; faturamento: number }> = {}
  transacoes.forEach((t) => {
    const canal = t.utm_medium_ultimo || 'Direto'
    if (!canaisMap[canal]) canaisMap[canal] = { vendas: 0, faturamento: 0 }
    canaisMap[canal].vendas++
    canaisMap[canal].faturamento += t.valor_bruto || 0
  })
  const totalVendas = Object.values(canaisMap).reduce((s, v) => s + v.vendas, 0)
  const canaisUltimoToque: CanalData[] = Object.entries(canaisMap)
    .map(([canal, d]) => ({ canal, vendas: d.vendas, faturamento: d.faturamento, pctTotal: totalVendas > 0 ? (d.vendas / totalVendas) * 100 : 0, ticketMedio: d.vendas > 0 ? d.faturamento / d.vendas : 0 }))
    .sort((a, b) => b.vendas - a.vendas)

  // Primeiro impacto
  const primeiroMap: Record<string, { vendas: number; faturamento: number }> = {}
  transacoes.forEach((t) => {
    const canal = t.utm_medium_primeiro || 'Direto'
    if (!primeiroMap[canal]) primeiroMap[canal] = { vendas: 0, faturamento: 0 }
    primeiroMap[canal].vendas++
    primeiroMap[canal].faturamento += t.valor_bruto || 0
  })
  const totalPrimeiro = Object.values(primeiroMap).reduce((s, v) => s + v.vendas, 0)
  const primeiroImpacto: CanalData[] = Object.entries(primeiroMap)
    .map(([canal, d]) => ({ canal, vendas: d.vendas, faturamento: d.faturamento, pctTotal: totalPrimeiro > 0 ? (d.vendas / totalPrimeiro) * 100 : 0 }))
    .sort((a, b) => b.vendas - a.vendas)

  const [current, previous] = await Promise.all([
    computePeriodSummary(de, ate, funil, conta),
    (cmpFrom && cmpTo) ? computePeriodSummary(cmpFrom, cmpTo, funil, conta) : null,
  ])

  const ticketMedioPeriodo = current.ticketMedio ?? 0

  return (
    <>
      <ComparisonHero
        current={current}
        previous={previous}
        cmpLabel={cmpLabel}
        metrics={['faturamento', 'lucro', 'roas', 'cpa', 'vendasFront', 'investimento']}
      />
      <AnaliseEstrategicaClient criativos={criativos} canaisUltimoToque={canaisUltimoToque} primeiroImpacto={primeiroImpacto} totalInvestimento={totalInvestimento} funil={funil} ticketMedioPeriodo={ticketMedioPeriodo} />
    </>
  )
}
