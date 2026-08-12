export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchMetaAds, fetchTransacoes, fetchFunisConfig, tipoDaTransacao, getDateRange, filterByFunil, filterByAccount, filterTransacoesByFunil } from '@/lib/supabase'
import { todayBR } from '@/lib/formatters'
import type { FunilEtapa } from '@/types'
import FunilClient, { type FunilDayData } from './FunilClient'
import ComparisonHero from '@/components/cards/ComparisonHero'
import { computePeriodSummary } from '@/lib/periodSummary'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel } from '@/lib/comparePeriods'
import FilterToggle from '@/components/filters/FilterToggle'
import CascadeFilter from '@/components/filters/CascadeFilter'
import { applyAdFilters, adFilterActive, buildCascadeOptions, filterTransacoesByAds, type AdFilter } from '@/lib/funil'
import { computeTicketFunil } from '@/lib/ticketFunil'

export default async function FunilPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string; cmp?: string; cmpDe?: string; cmpAte?: string; fDe?: string; fAte?: string; fFunil?: string; fUsarGeral?: string; campanha?: string; conjunto?: string; anuncio?: string }> }) {
  const sp = await searchParams
  const { de = '', ate = '', funil = 'all', conta = 'all', cmp, cmpDe, cmpAte } = sp
  // Filtro próprio da aba (FilterToggle prefix="f"): ON = filtro geral, OFF = exclusivo.
  const usarGeral = (sp.fUsarGeral ?? 'on') !== 'off'
  const efDe = usarGeral ? de : (sp.fDe || de)
  const efAte = usarGeral ? ate : (sp.fAte || ate)
  const efFunil = usarGeral ? funil : (sp.fFunil || funil)
  const ad: AdFilter = { campanha: sp.campanha ?? 'all', conjunto: sp.conjunto ?? 'all', anuncio: sp.anuncio ?? 'all' }
  const cmpMode = parseCompareMode(cmp)
  const cmpRange = computeComparisonRange(efDe, efAte, cmpMode, cmpDe, cmpAte)
  const cmpLabel = cmpRange ? formatComparisonLabel(cmpMode, cmpRange) : ''
  return (
    <div className="flex flex-col h-full">
      <Header title="Funil" subtitle="Análise de conversão por etapa" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-96 animate-pulse" />}>
          <FunilContent de={efDe} ate={efAte} funil={efFunil} conta={conta} ad={ad} cmpFrom={cmpRange?.from} cmpTo={cmpRange?.to} cmpLabel={cmpLabel} />
        </Suspense>
      </div>
    </div>
  )
}

async function FunilContent({ de, ate, funil, conta, ad, cmpFrom, cmpTo, cmpLabel }: { de: string; ate: string; funil: string; conta: string; ad: AdFilter; cmpFrom?: string; cmpTo?: string; cmpLabel?: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allMeta, allTransacoes] = await Promise.all([fetchMetaAds(), fetchTransacoes()])
  const accountFiltered = filterByAccount(allMeta, conta)

  // Escopo (conta + data + funil) — alimenta as opções de cascata Campanha→Conjunto→Anúncio.
  const funis = await fetchFunisConfig()
  const funilMeta = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, funis)
  const cascade = buildCascadeOptions(funilMeta, { campanha: ad.campanha, conjunto: ad.conjunto })

  // Recorte por ad (se ativo): estreita o meta_ads e mantém só as transações das ads sobreviventes.
  const metaAds = adFilterActive(ad) ? applyAdFilters(funilMeta, ad) : funilMeta
  const dateFilteredTransacoes = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)))
  const funilTransacoes = filterTransacoesByFunil(dateFilteredTransacoes, funil, accountFiltered, funis).filter((t) => (t.valor_bruto || 0) > 1)
  const transacoes = adFilterActive(ad) ? filterTransacoesByAds(funilTransacoes, metaAds) : funilTransacoes

  // Contribuição de cada produto pro ticket médio (S3). `transacoes` já está no MESMO
  // recorte (data + funil + ad filter + valor_bruto>1) usado por obsDetalhados/
  // upsellsDetalhados abaixo — refiltrar pelo mesmo funil é idempotente. Mas `funil` e
  // `funis` PRECISAM ir: sem eles o serviço entra em modo "todos os funis", e aí o papel
  // do produto sai da régua global em vez do papel DENTRO deste funil (o mesmo
  // "Protocolo Dentista Parceiro" é front no DPL e ob3 no COL), e `foraDoFunil` nunca
  // separa quem chegou por atribuição mas é de outro funil.
  const ticketFunil = computeTicketFunil(transacoes, metaAds, { funil, funis })

  const impressoes = metaAds.reduce((s, r) => s + (r.impressoes || 0), 0)
  const views3s = metaAds.reduce((s, r) => s + (r.views_3seg || 0), 0)
  const views95 = metaAds.reduce((s, r) => s + (r.views_95pct || 0), 0)
  const cliques = metaAds.reduce((s, r) => s + (r.cliques_link || 0), 0)
  const landing = metaAds.reduce((s, r) => s + (r.landing_views || 0), 0)
  const checkout = metaAds.reduce((s, r) => s + (r.checkouts || 0), 0)

  const frontEndCompradores = new Set(
    transacoes
      .filter((t) => tipoDaTransacao(t) === 'frontEnd')
      .map((t) => t.email?.toLowerCase())
      .filter(Boolean)
  )
  const vendasFrontEnd = transacoes.filter((t) => tipoDaTransacao(t) === 'frontEnd').length
  const vendas = vendasFrontEnd

  // Receita por etapa de venda (R$ no funil — Fase 5)
  let faturamentoFront = 0, faturamentoOB = 0
  transacoes.forEach((t) => {
    const tipo = tipoDaTransacao(t)
    const v = t.valor_bruto || 0
    if (tipo === 'frontEnd') faturamentoFront += v
    else if (tipo === 'ob1' || tipo === 'ob2' || tipo === 'ob3' || tipo === 'ob4') faturamentoOB += v
  })

  // Breakdown pós-front: nome do produto → compradores únicos, marcando se é upsell/downsell.
  // (Fase 5) Separa OB de Upsell para o toggle na seção de conversão.
  const breakdownMap: Record<string, { emails: Set<string>; upsell: boolean }> = {}
  transacoes.forEach((t) => {
    const tipo = tipoDaTransacao(t)
    const email = t.email?.toLowerCase()
    if (tipo !== 'frontEnd' && t.produto && email) {
      if (!breakdownMap[t.produto]) breakdownMap[t.produto] = { emails: new Set<string>(), upsell: tipo === 'upsell' || tipo === 'downsell' }
      breakdownMap[t.produto].emails.add(email)
    }
  })
  const toDetalhe = ([nome, v]: [string, { emails: Set<string>; upsell: boolean }]) => ({
    nome,
    valor: v.emails.size,
    pctFrontEnd: frontEndCompradores.size > 0 ? (v.emails.size / frontEndCompradores.size) * 100 : 0,
  })
  const entries = Object.entries(breakdownMap)
  const allDetalhes = entries.map(toDetalhe)
  const obsDetalhados = entries.filter(([, v]) => !v.upsell).map(toDetalhe).sort((a, b) => b.valor - a.valor)
  const upsellsDetalhados = entries.filter(([, v]) => v.upsell).map(toDetalhe).sort((a, b) => b.valor - a.valor)

  // Funil "Order Bumps" (etapa) mantém TODOS os pós-front (comportamento anterior).
  const totalObs = allDetalhes.reduce((s, o) => s + o.valor, 0)
  const avgObPct = allDetalhes.length > 0
    ? allDetalhes.reduce((s, o) => s + o.pctFrontEnd, 0) / allDetalhes.length
    : 0
  const investimento = metaAds.reduce((s, r) => s + (r.investimento || 0), 0)
  const convPagina = landing > 0 ? (vendas / landing) * 100 : 0
  const cpm = impressoes > 0 ? (investimento / impressoes) * 1000 : 0

  // Custo por etapa: quanto se pagou para chegar em cada ponto do funil
  const cpOBMedia = obsDetalhados.length > 0
    ? obsDetalhados.reduce((s, o) => s + (o.valor > 0 ? investimento / o.valor : 0), 0) / obsDetalhados.length
    : 0
  const custos = [
    cpm,                                                          // CPM
    cliques   > 0 ? investimento / cliques   : 0,                // CPC-Link
    landing   > 0 ? investimento / landing   : 0,                // PageView
    checkout  > 0 ? investimento / checkout  : 0,                // Checkout
    vendas    > 0 ? investimento / vendas    : 0,                // Front
    cpOBMedia,                                                    // OB (média)
  ]

  // Média de compradores por dia
  const today = todayBR()
  const effectiveTo = (!to || to > today) ? today : to
  let dias = 1
  if (from && effectiveTo) {
    dias = Math.max(1, Math.round((new Date(effectiveTo).getTime() - new Date(from).getTime()) / 86400000) + 1)
  } else {
    const dates = transacoes.map((t) => t.data?.slice(0, 10)).filter(Boolean).sort() as string[]
    if (dates.length > 0) {
      dias = Math.max(1, Math.round((new Date(effectiveTo).getTime() - new Date(dates[0]).getTime()) / 86400000) + 1)
    }
  }
  const mediaCompradoresDia = vendasFrontEnd / dias

  // ── Daily data para gráfico de linhas ─────────────────────────────────────
  type DailyAccum = { vendasFront: number; investimento: number; cliques: number; landingViews: number; checkouts: number }
  const dailyMap: Record<string, DailyAccum> = {}
  const initDay = (): DailyAccum => ({ vendasFront: 0, investimento: 0, cliques: 0, landingViews: 0, checkouts: 0 })
  metaAds.forEach((r) => {
    const dia = r.data?.slice(0, 10); if (!dia) return
    if (!dailyMap[dia]) dailyMap[dia] = initDay()
    dailyMap[dia].investimento  += r.investimento   || 0
    dailyMap[dia].cliques       += r.cliques_link   || 0
    dailyMap[dia].landingViews  += r.landing_views  || 0
    dailyMap[dia].checkouts     += r.checkouts      || 0
  })
  transacoes.forEach((t) => {
    const dia = t.data?.slice(0, 10); if (!dia) return
    if (!dailyMap[dia]) dailyMap[dia] = initDay()
    if (tipoDaTransacao(t) === 'frontEnd') dailyMap[dia].vendasFront++
  })
  const dailyData: FunilDayData[] = Object.entries(dailyMap)
    .map(([date, d]) => ({ date, ...d, cpa: d.vendasFront > 0 ? d.investimento / d.vendasFront : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const etapas = buildFunil(impressoes, cliques, landing, checkout, vendas, totalObs, avgObPct, faturamentoFront, faturamentoOB)

  const [current, previous] = await Promise.all([
    computePeriodSummary(de, ate, funil, conta, ad),
    (cmpFrom && cmpTo) ? computePeriodSummary(cmpFrom, cmpTo, funil, conta, ad) : null,
  ])

  return (
    <>
      <div className="space-y-3">
        <FilterToggle prefix="f" />
        <CascadeFilter
          campanhas={cascade.campanhas}
          conjuntos={cascade.conjuntos}
          anuncios={cascade.anuncios}
          campanha={ad.campanha}
          conjunto={ad.conjunto}
          anuncio={ad.anuncio}
        />
        {adFilterActive(ad) && metaAds.length === 0 && (
          <p className="text-[11px] text-amber-400">
            Esse recorte de campanha/conjunto/anúncio não tem dados no período e funil atuais — ajuste o período/funil acima ou clique em &quot;limpar recorte&quot;.
          </p>
        )}
      </div>
      <ComparisonHero
        current={current}
        previous={previous}
        cmpLabel={cmpLabel}
        metrics={['impressoes', 'cliques', 'landingViews', 'checkouts', 'vendasFront', 'convPagina']}
      />
      <FunilClient etapas={etapas} obsDetalhados={obsDetalhados} upsellsDetalhados={upsellsDetalhados} convPagina={convPagina} cpm={cpm} custos={custos} mediaCompradoresDia={mediaCompradoresDia} dailyData={dailyData} ticketFunil={ticketFunil} />
    </>
  )
}

function buildFunil(
  impressoes: number,
  cliques: number,
  landing: number,
  checkout: number,
  vendas: number,
  obs: number,
  avgObPct: number,
  faturamentoFront = 0,
  faturamentoOB = 0,
): FunilEtapa[] {
  const safe = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)
  return [
    { nome: 'Impressões', valor: Math.round(impressoes) },
    { nome: 'Cliques no link',       valor: Math.round(cliques),  pctAnterior: safe(cliques, impressoes), thresholdVerde: 1.5  },
    { nome: 'Visitas Landing Page',  valor: Math.round(landing),  pctAnterior: safe(landing, cliques),    thresholdVerde: 85   },
    { nome: 'Iniciaram Checkout',    valor: Math.round(checkout), pctAnterior: safe(checkout, landing),   thresholdVerde: 30   },
    { nome: 'Compras (Front-end)',   valor: Math.round(vendas),   pctAnterior: safe(vendas, checkout),    thresholdVerde: 40, receita: faturamentoFront },
    { nome: 'Order Bumps',           valor: Math.round(obs),      pctAnterior: avgObPct,                  thresholdVerde: 20, receita: faturamentoOB },
  ]
}
