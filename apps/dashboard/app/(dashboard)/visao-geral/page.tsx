export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import KpiCard from '@/components/cards/KpiCard'
import SemaforoGrid from '@/components/cards/SemaforoGrid'
import DiagnosticoAlert from '@/components/alerts/DiagnosticoAlert'
import TakeRateBreakdown from '@/components/cards/TakeRateBreakdown'
import UpsellBreakdown from '@/components/cards/UpsellBreakdown'
import { fetchTransacoes, fetchMetaAds, fetchFunisConfig, tipoDaTransacao, getDateRange, filterByFunil, filterByAccount, filterTransacoesByFunil } from '@/lib/supabase'
import { aggregateByOrigem, ORIGEM_COLOR } from '@/lib/origem'
import { formatCurrency, formatRoas, formatPercent, formatCurrencyCompact, formatNumber, getFrontEndLabel, todayBR } from '@/lib/formatters'
import { liquidoHotmartTransacoes, liquidoHotmartVenda } from '@/lib/hotmartFees'
import { getSemaforoColor, getSemaforoColorForFunil, SEMAFORO_CSS, THRESHOLDS } from '@/lib/thresholds'
import type { SemaforoItem, DailyFinancial, VendasPorProdutoDia, CriativoAgregado } from '@/types'
import { ExternalLink } from 'lucide-react'
import LineAreaChartWrapper from './LineAreaChartWrapper'
import StackedBarChartWrapper from './StackedBarChartWrapper'
import { computePeriodSummary } from '@/lib/periodSummary'
import { computeTicketFunil } from '@/lib/ticketFunil'
import ColumnHeaderInfo from '@/components/tables/ColumnHeaderInfo'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel } from '@/lib/comparePeriods'
import { brazilDateStr } from '@/lib/brazilDate'
import { diaSemanaFatores } from '@/lib/metrics/sparkline'
import { emptyComp, deriveDailyValue, type DailyComp } from '@/lib/metrics/dailyDerive'
import InlineSparklines from '@/components/metrics/InlineSparklines'
import MobileHome, { type MobileKpi, type MobileBreakdownRow, type MobileDaily, type MobileStat } from '@/components/mobile/MobileHome'
import { whatChanged, expectedBand, isOutsideBand } from '@/lib/whatChanged'
import { computeVisaoGeralCore, KPI_LABEL } from '@/lib/visaoGeral'
import { buildMobileHome } from '@/lib/mobileHome'
import { contaNomeCurto } from '@/lib/contas'

export default async function VisaoGeral({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string; cmp?: string; cmpDe?: string; cmpAte?: string }> }) {
  const { de = '', ate = '', funil = 'all', conta = 'all', cmp, cmpDe, cmpAte } = await searchParams
  const cmpMode = parseCompareMode(cmp)
  const cmpRange = computeComparisonRange(de, ate, cmpMode, cmpDe, cmpAte)
  const cmpLabel = cmpRange ? formatComparisonLabel(cmpMode, cmpRange) : ''

  return (
    <div className="flex flex-col h-full">
      <Header title="Visão Geral" subtitle="Painel de Comando" />
      <div className="flex-1 overflow-y-auto">
        {/* Home rica só no celular (md:hidden → desktop fica idêntico). O padding do
            desktop foi movido pro wrapper interno abaixo pra este bloco não empurrar
            o layout via space-y. */}
        <div className="md:hidden p-4 pb-0">
          <Suspense fallback={<MobileHomeSkeleton />}>
            <MobileHomeSection de={de} ate={ate} funil={funil} conta={conta} />
          </Suspense>
        </div>
        {/* Seções completas: desktop only. No celular a Home rica acima é a home
            dedicada (evita KPI duplicado). Desktop 100% idêntico. */}
        <div className="hidden md:block p-6 space-y-6">
        <Suspense fallback={<KpiSkeleton />}>
          <KpiSection de={de} ate={ate} funil={funil} conta={conta} cmpFrom={cmpRange?.from} cmpTo={cmpRange?.to} cmpLabel={cmpLabel} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Semáforo de Métricas" />}>
          <SemaforoSection de={de} ate={ate} funil={funil} conta={conta} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Take Rate Detalhado" />}>
          <TakeRateSection de={de} ate={ate} funil={funil} conta={conta} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Diagnóstico de Gargalo" />}>
          <DiagnosticoSection de={de} ate={ate} funil={funil} conta={conta} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Faturamento vs Investimento vs Lucro" />}>
          <GraficoLinhaSection de={de} ate={ate} funil={funil} conta={conta} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Top 3 Criativos por Lucro" />}>
          <Top3CriativosSection de={de} ate={ate} funil={funil} conta={conta} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Vendas por Produto" />}>
          <VendasProdutoSection de={de} ate={ate} funil={funil} conta={conta} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Receita por Origem" />}>
          <OrigemSection de={de} ate={ate} funil={funil} conta={conta} />
        </Suspense>
        </div>
      </div>
    </div>
  )
}

// ─── Mobile Home Section (md:hidden) ──────────────────────────────────────────
// Home rica só no celular. Reusa exatamente os mesmos fetchers/ filtros do
// KpiSection/GraficoLinhaSection (workspace-scoped via cache) e as mesmas bases
// canônicas: faturamento bruto, investimento c/ imposto Meta, receita líquida
// pela taxa Hotmart, lucro = líquida − investimento (igual ao periodSummary).

// Os rótulos das contas Meta vêm de lib/contas.ts (contaNomeCurto) — o mapa local
// que existia aqui cobria 2 das 4 contas com gasto e, pior, chamava de
// "Orgânico / sem conta" o balde de tudo que não tinha ad_id. Ver lib/mobileHome.ts.

async function MobileHomeSection({ de, ate, funil, conta }: { de: string; ate: string; funil: string; conta: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allTransacoes, allMeta, funis] = await Promise.all([fetchTransacoes(), fetchMetaAds(), fetchFunisConfig()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const dateFilteredTransacoes = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)))
  const transacoes = filterTransacoesByFunil(dateFilteredTransacoes, funil, accountFiltered, funis).filter((t) => (t.valor_bruto || 0) > 1)
  const metaAds = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, funis)

  // Toda a montagem da Home mobile vive em lib/mobileHome.ts (função PURA). Aqui
  // só entram busca, filtro e render — o que estava inline neste Server Component
  // era invisível para teste unitário, e uma rodada de mutação provou que dava pra
  // trocar o número do card de Lucro sem nenhum dos 704 testes reclamar.
  const { kpis, stats, daily: dailyBase, hasData } = buildMobileHome({
    transacoes, metaAds, allMeta, funis, funil, from,
  })


  // Fatores de dia-da-semana (sazonalidade global de faturamento, 90d) — mesma
  // base do KpiSection. Entram só nas métricas de volume (F1/F2) pra não disparar
  // falso alarme de fim de semana.
  const dowDias: string[] = []
  for (let n = 90; n >= 1; n--) dowDias.push(brazilDateStr(n))
  const fatDia: Record<string, number> = {}
  allTransacoes.forEach((t) => {
    if ((t.valor_bruto || 0) <= 1 || !t.data) return
    const day = t.data.slice(0, 10)
    if (day >= dowDias[0] && day <= dowDias[dowDias.length - 1]) fatDia[day] = (fatDia[day] || 0) + (t.valor_bruto || 0)
  })
  const dowFatores = diaSemanaFatores(dowDias.map((d) => ({ date: d, value: fatDia[d] ?? 0 })))

  // F1 — linhas de mudança relevante (determinístico, pisos em lib/whatChanged.ts).
  const changes = whatChanged(dailyBase, { dowFatores })

  // F2 — banda de esperado por dia (faturamento), merge na série do gráfico.
  const band = expectedBand(dailyBase.map((d) => ({ date: d.date, value: d.faturamento })), { dowFatores })
  const daily: MobileDaily[] = dailyBase.map((d, i) => {
    const b = band[i]
    return {
      date: d.date,
      faturamento: d.faturamento,
      investimento: d.investimento,
      lucro: d.lucro,
      esperado: b.esperado,
      bandLo: b.lo,
      bandHi: b.hi,
      outside: isOutsideBand(d.faturamento, d.investimento, b),
    }
  })

  return <MobileHome kpis={kpis} daily={daily} stats={stats} changes={changes} hasData={hasData} />
}

function MobileHomeSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="bg-[#111827] border border-[#1F2937] rounded-xl h-[68px] animate-pulse" />
      ))}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl h-[198px] animate-pulse" />
    </div>
  )
}

// ─── KPI Section ──────────────────────────────────────────────────────────────

async function KpiSection({ de, ate, funil, conta, cmpFrom, cmpTo, cmpLabel }: { de: string; ate: string; funil: string; conta: string; cmpFrom?: string; cmpTo?: string; cmpLabel?: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allTransacoes, allMeta] = await Promise.all([fetchTransacoes(), fetchMetaAds()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const dateFilteredTransacoes = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)))
  const transacoes = filterTransacoesByFunil(dateFilteredTransacoes, funil, accountFiltered, await fetchFunisConfig()).filter((t) => (t.valor_bruto || 0) > 1)
  const metaAds = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, await fetchFunisConfig())

  // NÚCLEO ÚNICO (lib/visaoGeral.ts) — as mesmas fórmulas que a Home mobile usa.
  // Estavam duplicadas nas duas seções deste arquivo; duplicata não é paridade.
  // faturamentoLiquido = soma do líquido POR transação (taxa Hotmart canônica);
  // investimento já vem com o imposto Meta (×1,1382) aplicado no sync-meta.
  const core = computeVisaoGeralCore(transacoes, metaAds)
  const {
    faturamento, investimento, frontEndVendas,
    receitaLiquida: faturamentoLiquido, lucroBruto, lucroLiquido01,
    roasBruto, roasLiquido, cpa, ticketFE,
  } = core

  // Cada card de ROAS usa a cor da SUA PRÓPRIA base (mesma escala de thresholds
  // do ROAS líquido, aplicada ao valor bruto e ao líquido separadamente) — antes
  // os dois cards mostravam a mesma cor (sempre a do líquido), o que fazia o
  // card Bruto parecer errado quando bruto e líquido divergiam de faixa.
  const roasBrutoColor = getSemaforoColor('roasLiquido', roasBruto)
  const roasColor = getSemaforoColor('roasLiquido', roasLiquido)
  const cpaColor = getSemaforoColorForFunil('cpa', cpa, funil, ticketFE)

  // Média de compradores por dia (cap at today so future end dates don't inflate denominator)
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
  const mediaCompradoresDia = frontEndVendas / dias

  // Comparação opcional
  const prev = (cmpFrom && cmpTo) ? await computePeriodSummary(cmpFrom, cmpTo, funil, conta) : null
  const cmp = (k: keyof NonNullable<typeof prev>, current: number, invert?: boolean) =>
    prev ? { current, previous: Number(prev[k]), invert, label: cmpLabel } : undefined
  const cmpVal = (current: number, previous: number, invert?: boolean) =>
    prev ? { current, previous, invert, label: cmpLabel } : undefined
  // Período anterior: receitaLiquida já vem canônica do PeriodSummary.
  const prevFatLiq = prev?.receitaLiquida ?? 0
  const prevRoasLiq = prev && prev.investimento > 0 ? prevFatLiq / prev.investimento : 0
  const prevLucroBruto = prev ? prev.faturamento - prev.investimento : 0
  const prevLucroLiq01 = prev ? prevFatLiq - prev.investimento : 0

  // ── Série global diária pros minigráficos (filtro-independente, janela 30d) ──
  const hoje = brazilDateStr(0)
  const janelaDias: string[] = []
  for (let n = 30; n >= 1; n--) janelaDias.push(brazilDateStr(n))
  const jIni = janelaDias[0]
  const jFim = janelaDias[janelaDias.length - 1]
  const gMap: Record<string, DailyComp> = {}
  allMeta.filter((r) => r.data >= jIni && r.data <= jFim).forEach((r) => {
    const c = (gMap[r.data] ??= emptyComp(r.data))
    c.inv += r.investimento || 0; c.imp += r.impressoes || 0; c.alc += r.alcance || 0
    c.cliques += r.cliques_link || 0; c.lpv += r.landing_views || 0; c.checkouts += r.checkouts || 0
    c.v3 += r.views_3seg || 0; c.v75 += r.views_75pct || 0; c.v95 += r.views_95pct || 0
  })
  allTransacoes.filter((t) => t.data && t.data.slice(0, 10) >= jIni && t.data.slice(0, 10) <= jFim && (t.valor_bruto || 0) > 1).forEach((t) => {
    const day = t.data!.slice(0, 10)
    const c = (gMap[day] ??= emptyComp(day))
    c.fat += t.valor_bruto || 0
    if (tipoDaTransacao(t) === 'frontEnd') c.vendasFront += 1
  })
  const globalDaily = janelaDias.map((d) => gMap[d] ?? emptyComp(d))
  const dowDias: string[] = []
  for (let n = 90; n >= 1; n--) dowDias.push(brazilDateStr(n))
  const fatDia: Record<string, number> = {}
  allTransacoes.forEach((t) => {
    if ((t.valor_bruto || 0) <= 1 || !t.data) return
    const day = t.data.slice(0, 10)
    if (day >= dowDias[0] && day <= dowDias[dowDias.length - 1]) fatDia[day] = (fatDia[day] || 0) + (t.valor_bruto || 0)
  })
  const dowFatores = diaSemanaFatores(dowDias.map((d) => ({ date: d, value: fatDia[d] ?? 0 })))
  const spark = (id: string, format: 'currency' | 'currencyCompact' | 'roas') => (
    <InlineSparklines history={globalDaily.map((c) => ({ date: c.d, value: deriveDailyValue(id, c) }))} hoje={hoje} dowFatores={dowFatores} format={format} />
  )
  const impressoesTot = metaAds.reduce((s, r) => s + (r.impressoes || 0), 0)
  const cpmVal = impressoesTot > 0 ? (investimento / impressoesTot) * 1000 : 0

  // Ticket líq./venda front (lib/ticketFunil.ts) — receita LÍQUIDA (pós-taxa Hotmart)
  // ÷ vendas front. É uma definição DIFERENTE do "Ticket Médio" usado em outras telas
  // do dashboard (ex.: /comparacao, lib/periodSummary.ts), que é faturamento BRUTO ÷
  // compradores ÚNICOS — os dois números divergem e os dois estão certos, cada um
  // serve a uma identidade diferente (ver tooltip do card). `transacoes`/`metaAds`
  // aqui já estão filtrados por data/funil/conta desta seção; passar `funil` de novo
  // é idempotente (computeTicketFunil reaplica o mesmo filtro por cima).
  const ticketFunilData = computeTicketFunil(transacoes, metaAds, { funil, funis: await fetchFunisConfig() })

  return (
    <div className="space-y-4">
      {/* Primary tier: Faturamento hero + ROAS Bruto + ROAS Líq. + CPA */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          label={KPI_LABEL.faturamento}
          value={formatCurrencyCompact(faturamento)}
          size="lg"
          compare={cmp('faturamento', faturamento)}
          footer={spark('faturamento', 'currencyCompact')}
        />
        <KpiCard
          label={KPI_LABEL.roasBruto}
          value={formatRoas(roasBruto)}
          size="lg"
          semaforoColor={roasBrutoColor}
          compare={cmp('roas', roasBruto)}
          footer={spark('roas', 'roas')}
        />
        <KpiCard
          label={KPI_LABEL.roasLiquido}
          value={formatRoas(roasLiquido)}
          size="lg"
          semaforoColor={roasColor}
          compare={cmpVal(roasLiquido, prevRoasLiq)}
          footer={spark('roas', 'roas')}
        />
        <KpiCard
          label={KPI_LABEL.cpa}
          value={cpa > 0 ? formatCurrency(cpa) : '–'}
          size="lg"
          semaforoColor={cpaColor}
          compare={cmp('cpa', cpa, true)}
          footer={spark('cpa', 'currency')}
        />
      </div>
      {/* Secondary tier: supporting metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        <KpiCard
          label={KPI_LABEL.investimento}
          value={formatCurrencyCompact(investimento)}
          compare={cmp('investimento', investimento, true)}
          footer={spark('investimento', 'currencyCompact')}
        />
        <KpiCard
          label={KPI_LABEL.lucroBruto}
          value={formatCurrencyCompact(lucroBruto)}
          semaforoColor={getSemaforoColor('roasLiquido', roasLiquido)}
          compare={cmpVal(lucroBruto, prevLucroBruto)}
          footer={spark('lucro', 'currencyCompact')}
        />
        <KpiCard
          label="CPM"
          value={cpmVal > 0 ? formatCurrency(cpmVal) : '–'}
          footer={spark('cpm', 'currency')}
        />
        <KpiCard
          label={KPI_LABEL.lucroLiquido01}
          value={formatCurrencyCompact(lucroLiquido01)}
          semaforoColor={getSemaforoColor('roasLiquido', roasLiquido)}
          compare={cmpVal(lucroLiquido01, prevLucroLiq01)}
        />
        <KpiCard
          label={KPI_LABEL.compradores}
          value={frontEndVendas.toLocaleString('pt-BR')}
          compare={cmp('vendasFront', frontEndVendas)}
        />
        <KpiCard
          label="Compradores / dia"
          value={formatNumber(mediaCompradoresDia, 1)}
          compare={cmp('compradoresPorDia', mediaCompradoresDia)}
        />
        <KpiCard
          label="Ticket líq. / venda front"
          value={ticketFunilData.semDado ? 'SEM DADO' : formatCurrency(ticketFunilData.ticket)}
          subtext={ticketFunilData.semDado ? 'sem venda front no recorte' : `líquido ÷ ${ticketFunilData.vendasFront.toLocaleString('pt-BR')} vendas front`}
          icon={
            <ColumnHeaderInfo
              text="Receita líquida (pós-taxa Hotmart) ÷ vendas front. Diferente do “Ticket Médio” de outras telas (faturamento bruto ÷ compradores únicos) — os dois estão certos, cada um serve a uma conta diferente. Este é o que fecha PRV = conversão de página × ticket, já que a conversão de página aqui é vendas front ÷ landing views."
            />
          }
        />
      </div>
    </div>
  )
}

// ─── Semáforo Section ─────────────────────────────────────────────────────────

async function SemaforoSection({ de, ate, funil, conta }: { de: string; ate: string; funil: string; conta: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allMeta, allTransacoes] = await Promise.all([fetchMetaAds(), fetchTransacoes()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const metaAds = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, await fetchFunisConfig())
  const transacoes = filterTransacoesByFunil(
    allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to))),
    funil,
    accountFiltered,
    await fetchFunisConfig()
  ).filter((t) => (t.valor_bruto || 0) > 1)

  const totalImpressoes = metaAds.reduce((s, r) => s + (r.impressoes || 0), 0)
  const totalCliques = metaAds.reduce((s, r) => s + (r.cliques_link || 0), 0)
  const totalInvestimento = metaAds.reduce((s, r) => s + (r.investimento || 0), 0)
  const totalCheckouts = metaAds.reduce((s, r) => s + (r.checkouts || 0), 0)
  const totalLanding = metaAds.reduce((s, r) => s + (r.landing_views || 0), 0)

  // Faturamento e vendas da Hotmart (fonte de verdade)
  const totalFaturamento = transacoes.reduce((s, t) => s + (t.valor_bruto || 0), 0)
  const totalVendasFront = transacoes.filter((t) => tipoDaTransacao(t) === 'frontEnd').length
  // Take Rate AGREGADO = OBs (qualquer um) / vendas FE — divisão direta, NÃO média de taxas.
  // (Bug histórico: usar média de taxas resultava em valor errado quando mix entre OBs era desigual.)
  const totalVendasOB = transacoes.filter((t) => {
    const tipo = tipoDaTransacao(t)
    return tipo === 'ob1' || tipo === 'ob2' || tipo === 'ob3' || tipo === 'ob4'
  }).length

  const ctr = totalImpressoes > 0 ? (totalCliques / totalImpressoes) * 100 : 0
  const cpc = totalCliques > 0 ? totalInvestimento / totalCliques : 0
  const cpm = totalImpressoes > 0 ? (totalInvestimento / totalImpressoes) * 1000 : 0
  const carregamento = totalCliques > 0 ? (totalLanding / totalCliques) * 100 : 0
  const passagemPagina = totalLanding > 0 ? (totalCheckouts / totalLanding) * 100 : 0
  const conversaoCheckout = totalCheckouts > 0 ? (totalVendasFront / totalCheckouts) * 100 : 0
  const roas = totalInvestimento > 0 ? totalFaturamento / totalInvestimento : 0
  const cpa = totalVendasFront > 0 ? totalInvestimento / totalVendasFront : 0
  const takeRateOB = totalVendasFront > 0 ? (totalVendasOB / totalVendasFront) * 100 : 0

  const convPagina  = totalLanding > 0 ? (totalVendasFront / totalLanding) * 100 : 0
  const convClique  = totalCliques > 0 ? (totalVendasFront / totalCliques) * 100 : 0

  const metrics: { key: keyof typeof THRESHOLDS; label: string; value: number; formatter: (v: number) => string }[] = [
    { key: 'txConversaoClique', label: 'Conv. Clique',    value: convClique,        formatter: (v) => formatPercent(v) },
    { key: 'txConversaoPagina', label: 'Conv. Página',    value: convPagina,        formatter: (v) => formatPercent(v) },
    { key: 'ctr',               label: 'CTR',             value: ctr,               formatter: (v) => formatPercent(v) },
    { key: 'cpc',               label: 'CPC',             value: cpc,               formatter: formatCurrency },
    { key: 'cpm',               label: 'CPM',             value: cpm,               formatter: formatCurrency },
    { key: 'taxaCarregamento',  label: 'Carregamento',    value: carregamento,      formatter: (v) => formatPercent(v) },
    { key: 'taxaPassagemCheckout', label: 'Passagem da Pág.', value: passagemPagina, formatter: (v) => formatPercent(v) },
    { key: 'cvrCheckout',       label: 'Conv. Checkout',  value: conversaoCheckout, formatter: (v) => formatPercent(v) },
    { key: 'takeRateOB',        label: 'Take Rate OBs',   value: takeRateOB,        formatter: (v) => formatPercent(v) },
  ]

  const items: SemaforoItem[] = metrics.map((m) => ({
    metricKey: m.key,
    label: m.label,
    value: m.value,
    formatted: m.formatter(m.value),
    color: getSemaforoColorForFunil(m.key, m.value, funil),
  }))

  return (
    <section>
      <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-3">
        Semáforo de Métricas
      </h2>
      <SemaforoGrid items={items} primaryCount={1} />
    </section>
  )
}

// ─── Take Rate Section ────────────────────────────────────────────────────────

async function TakeRateSection({ de, ate, funil, conta }: { de: string; ate: string; funil: string; conta: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allMeta, allTransacoes] = await Promise.all([fetchMetaAds(), fetchTransacoes()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const transacoes = filterTransacoesByFunil(
    allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to))),
    funil,
    accountFiltered,
    await fetchFunisConfig()
  ).filter((t) => (t.valor_bruto || 0) > 1)

  const count = (tipo: 'frontEnd' | 'ob1' | 'ob2' | 'ob3' | 'ob4' | 'upsell' | 'downsell') =>
    transacoes.filter((t) => tipoDaTransacao(t) === tipo).length

  const vendasFront = count('frontEnd')
  const vendasOB1 = count('ob1')
  const vendasOB2 = count('ob2')
  const vendasOB3 = count('ob3')
  const vendasOB4 = count('ob4')
  const vendasUpsell = count('upsell')
  const vendasDownsell = count('downsell')
  const totalOB = vendasOB1 + vendasOB2 + vendasOB3 + vendasOB4

  if (vendasFront === 0 && totalOB === 0 && vendasUpsell === 0 && vendasDownsell === 0) return null

  const rate = (n: number) => (vendasFront > 0 ? (n / vendasFront) * 100 : 0)
  const taxaUpsell = rate(vendasUpsell)
  const elegivelDownsell = Math.max(vendasFront - vendasUpsell, 0)
  const taxaDownsell = elegivelDownsell > 0 ? (vendasDownsell / elegivelDownsell) * 100 : 0

  // Mostrar UpsellBreakdown apenas pra funis que têm upsell/downsell cadastrado (hoje: PLO).
  // Também mostra quando JÁ existe venda real (caso outro funil ganhe upsell no futuro).
  const showUpsell = funil === 'plo' || vendasUpsell > 0 || vendasDownsell > 0

  return (
    <section className="space-y-4">
      <TakeRateBreakdown
        takeRateOB={rate(totalOB)}
        takeRateOB1={rate(vendasOB1)}
        takeRateOB2={rate(vendasOB2)}
        takeRateOB3={rate(vendasOB3)}
        takeRateOB4={rate(vendasOB4)}
        vendasFront={vendasFront}
        vendasOB1={vendasOB1}
        vendasOB2={vendasOB2}
        vendasOB3={vendasOB3}
        vendasOB4={vendasOB4}
      />
      {showUpsell && (
        <UpsellBreakdown
          vendasFront={vendasFront}
          vendasUpsell={vendasUpsell}
          vendasDownsell={vendasDownsell}
          taxaUpsell={taxaUpsell}
          taxaDownsell={taxaDownsell}
          upsellLabel="Implementação Lucro Oculto"
          downsellLabel="Implementação Express Lucro Oculto"
        />
      )}
    </section>
  )
}

// ─── Diagnóstico Section ──────────────────────────────────────────────────────

async function DiagnosticoSection({ de, ate, funil, conta }: { de: string; ate: string; funil: string; conta: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allMeta, allTransacoes] = await Promise.all([fetchMetaAds(), fetchTransacoes()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const metaAds = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, await fetchFunisConfig())
  const transacoes = filterTransacoesByFunil(
    allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to))),
    funil,
    accountFiltered,
    await fetchFunisConfig()
  ).filter((t) => (t.valor_bruto || 0) > 1)

  const totalImpressoes = metaAds.reduce((s, r) => s + (r.impressoes || 0), 0)
  const totalInvestimento = metaAds.reduce((s, r) => s + (r.investimento || 0), 0)
  const totalCliques = metaAds.reduce((s, r) => s + (r.cliques_link || 0), 0)

  // Hotmart como fonte de verdade para faturamento e CPA
  const totalFaturamento = transacoes.reduce((s, t) => s + (t.valor_bruto || 0), 0)
  // Receita líquida DA OPERAÇÃO = soma do líquido POR transação (taxa canônica); não usa valor_liquido_expert.
  const totalReceitaLiquida = liquidoHotmartTransacoes(transacoes.map((t) => t.valor_bruto || 0))
  const totalVendasFront = transacoes.filter((t) => tipoDaTransacao(t) === 'frontEnd').length

  const roas = totalInvestimento > 0 ? totalFaturamento / totalInvestimento : 0
  // ROAS líquido (após taxa Hotmart) é a base canônica do semáforo (roasStatus).
  // O texto do diagnóstico usa a MESMA base (líquido) pra bater com a cor —
  // o bruto aparece só como referência entre parênteses.
  const roasLiquido = totalInvestimento > 0 ? totalReceitaLiquida / totalInvestimento : 0
  const ctr = totalImpressoes > 0 ? (totalCliques / totalImpressoes) * 100 : 0
  const cpa = totalVendasFront > 0 ? totalInvestimento / totalVendasFront : 0
  const ticketFE = totalVendasFront > 0 ? totalFaturamento / totalVendasFront : 0

  const roasStatus = getSemaforoColor('roasLiquido', roasLiquido)
  const ctrStatus = getSemaforoColor('ctr', ctr)
  const cpaStatus = getSemaforoColorForFunil('cpa', cpa, funil, ticketFE)

  type Level = 'green' | 'yellow' | 'red' | 'info'
  const diagnosticos: { level: Level; title: string; description: string }[] = []

  if (roasStatus === 'green') {
    diagnosticos.push({ level: 'green', title: 'ROAS acima do target', description: `ROAS Líquido de ${formatRoas(roasLiquido)} (Bruto: ${formatRoas(roas)}) está acima do mínimo de 1.5x. Margem saudável para escalar investimento.` })
  } else if (roasStatus === 'yellow') {
    diagnosticos.push({ level: 'yellow', title: 'ROAS próximo do limite', description: `ROAS Líquido de ${formatRoas(roasLiquido)} (Bruto: ${formatRoas(roas)}) está abaixo do ideal. Revisar criativos com menor performance.` })
  } else if (roas > 0) {
    diagnosticos.push({ level: 'red', title: 'ROAS abaixo do mínimo', description: `ROAS Líquido de ${formatRoas(roasLiquido)} (Bruto: ${formatRoas(roas)}) está abaixo do breakeven. Pausar criativos com pior desempenho imediatamente.` })
  }

  if (diagnosticos.length === 0) {
    diagnosticos.push({ level: 'info', title: 'Monitorar frequência dos criativos', description: 'Verificar se frequência está acima de 3.0 nos conjuntos de anúncios ativos. Alta frequência causa queda de CTR e aumento de CPM.' })
  }

  return (
    <section>
      <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-3">
        Diagnóstico Automático
      </h2>
      <DiagnosticoAlert items={diagnosticos} />
    </section>
  )
}

// ─── Gráfico Linha Section ────────────────────────────────────────────────────

async function GraficoLinhaSection({ de, ate, funil, conta }: { de: string; ate: string; funil: string; conta: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allTransacoes, allMeta] = await Promise.all([fetchTransacoes(), fetchMetaAds()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const dateFilteredTransacoes = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)))
  const transacoes = filterTransacoesByFunil(dateFilteredTransacoes, funil, accountFiltered, await fetchFunisConfig()).filter((t) => (t.valor_bruto || 0) > 1)
  const metaAds = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, await fetchFunisConfig())

  // Aggregate by date
  const byDate: Record<string, { faturamento: number; liquido: number; investimento: number; vendas: number; vendasFront: number }> = {}

  transacoes.forEach((t) => {
    const date = t.data?.slice(0, 10)
    if (!date) return
    if (!byDate[date]) byDate[date] = { faturamento: 0, liquido: 0, investimento: 0, vendas: 0, vendasFront: 0 }
    byDate[date].faturamento += t.valor_bruto || 0
    byDate[date].liquido += liquidoHotmartVenda(t.valor_bruto || 0)
    byDate[date].vendas++
    if (tipoDaTransacao(t) === 'frontEnd') byDate[date].vendasFront++
  })

  metaAds.forEach((r) => {
    const date = r.data?.slice(0, 10)
    if (!date) return
    if (!byDate[date]) byDate[date] = { faturamento: 0, liquido: 0, investimento: 0, vendas: 0, vendasFront: 0 }
    byDate[date].investimento += r.investimento || 0
  })

  const data: DailyFinancial[] = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      faturamento: Math.round(d.faturamento),
      investimento: Math.round(d.investimento),
      lucro: Math.round(d.liquido - d.investimento),
      roas: d.investimento > 0 ? d.faturamento / d.investimento : 0,
      vendas: d.vendas,
      ticketMedio: d.vendasFront > 0 ? d.faturamento / d.vendasFront : 0,
    }))

  return (
    <section>
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Faturamento vs Investimento vs Lucro
        </h2>
        <LineAreaChartWrapper data={data} />
      </div>
    </section>
  )
}

// ─── Vendas por Produto Section ────────────────────────────────────────────────

async function VendasProdutoSection({ de, ate, funil, conta }: { de: string; ate: string; funil: string; conta: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allTransacoes, allMeta] = await Promise.all([fetchTransacoes(), fetchMetaAds()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const dateFiltered = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)) && (t.valor_bruto || 0) > 1)
  const transacoes = filterTransacoesByFunil(dateFiltered, funil, accountFiltered, await fetchFunisConfig())

  const byDate: Record<string, VendasPorProdutoDia> = {}
  transacoes.forEach((t) => {
    const date = t.data?.slice(0, 10)
    if (!date) return
    if (!byDate[date]) byDate[date] = { date, frontEnd: 0, ob1: 0, ob2: 0, ob3: 0, ob4: 0, upsell: 0, downsell: 0 }
    const tipo = tipoDaTransacao(t)
    byDate[date][tipo]++
  })

  const data = Object.values(byDate)
    .sort((a, b) => a.date.localeCompare(b.date))

  return (
    <section>
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Vendas por Produto por Dia
        </h2>
        <StackedBarChartWrapper data={data} frontEndLabel={getFrontEndLabel(funil)} />
      </div>
    </section>
  )
}

// ─── Receita por Origem Section ───────────────────────────────────────────────

async function OrigemSection({ de, ate, funil, conta }: { de: string; ate: string; funil: string; conta: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allTransacoes, allMeta] = await Promise.all([fetchTransacoes(), fetchMetaAds()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const dateFiltered = allTransacoes.filter(
    (t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)) && (t.valor_bruto || 0) > 1
  )
  const transacoes = filterTransacoesByFunil(dateFiltered, funil, accountFiltered, await fetchFunisConfig())
  const rows = aggregateByOrigem(transacoes)
  if (rows.length === 0) return null
  const totalBruto = rows.reduce((s, r) => s + r.faturamentoBruto, 0)

  return (
    <section>
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Receita por Origem
        </h2>
        {/* barra empilhada 100% */}
        <div className="flex h-2.5 rounded-full overflow-hidden mb-4 bg-[#1F2937]">
          {rows.map((r) => (
            <div
              key={r.origem}
              style={{ width: `${totalBruto > 0 ? (r.faturamentoBruto / totalBruto) * 100 : 0}%`, background: ORIGEM_COLOR[r.origem] }}
              title={`${r.label}: ${formatCurrency(r.faturamentoBruto)}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {rows.map((r) => {
            const pct = totalBruto > 0 ? (r.faturamentoBruto / totalBruto) * 100 : 0
            return (
              <div key={r.origem} className="bg-[#0d1420] border border-[#1F2937] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: ORIGEM_COLOR[r.origem] }} />
                  <span className="text-xs text-gray-400">{r.label}</span>
                </div>
                <p className="text-lg font-bold text-white tabular-nums">{formatCurrencyCompact(r.faturamentoBruto)}</p>
                <p className="text-[11px] text-gray-500">
                  {formatPercent(pct)} · {r.vendas.toLocaleString('pt-BR')} vendas
                </p>
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-gray-400 mt-3">
          Classificação determinística por UTM/ad_id (sem IA). ROAS só se aplica ao tráfego pago.
        </p>
      </div>
    </section>
  )
}

// ─── Top 3 Criativos Section ──────────────────────────────────────────────────

async function Top3CriativosSection({ de, ate, funil, conta }: { de: string; ate: string; funil: string; conta: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allRows, allTransacoes] = await Promise.all([fetchMetaAds(), fetchTransacoes()])
  const accountFiltered = filterByAccount(allRows, conta)
  const rows = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, await fetchFunisConfig())
  const transacoesFiltradas = filterTransacoesByFunil(
    allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)) && (t.valor_bruto || 0) > 1),
    funil, accountFiltered, await fetchFunisConfig()
  )

  const hotmartMap: Record<string, { vendasFront: number; vendas: number; faturamento: number; receitaLiquida: number }> = {}
  let aggFaturamentoFE = 0
  let aggVendasFE = 0
  transacoesFiltradas.forEach((t) => {
    const key = t.criativo || 'Sem criativo'
    if (!hotmartMap[key]) hotmartMap[key] = { vendasFront: 0, vendas: 0, faturamento: 0, receitaLiquida: 0 }
    hotmartMap[key].faturamento += t.valor_bruto || 0
    hotmartMap[key].receitaLiquida += liquidoHotmartVenda(t.valor_bruto || 0) // canônico
    hotmartMap[key].vendas += 1
    if (tipoDaTransacao(t) === 'frontEnd') {
      hotmartMap[key].vendasFront += 1
      aggFaturamentoFE += t.valor_bruto || 0
      aggVendasFE += 1
    }
  })
  // Ticket FE agregado do período — base do semáforo CPA por linha
  const ticketFEPeriodo = aggVendasFE > 0 ? aggFaturamentoFE / aggVendasFE : 0

  const linkMap: Record<string, string> = {}
  allRows.forEach((r) => {
    const nome = r.ad_name || r.criativo
    if (nome && r.preview_url && !linkMap[nome]) linkMap[nome] = r.preview_url
  })

  const metaMap: Record<string, { investimento: number; impressoes: number; cliques: number }> = {}
  rows.forEach((r) => {
    const key = r.ad_name || r.criativo || 'Sem nome'
    if (!metaMap[key]) metaMap[key] = { investimento: 0, impressoes: 0, cliques: 0 }
    metaMap[key].investimento += r.investimento || 0
    metaMap[key].impressoes   += r.impressoes   || 0
    metaMap[key].cliques      += r.cliques_link || 0
  })

  Object.keys(hotmartMap).forEach((nome) => {
    if (!metaMap[nome]) metaMap[nome] = { investimento: 0, impressoes: 0, cliques: 0 }
  })

  const top3 = Object.entries(metaMap)
    .filter(([nome]) => nome)
    .map(([nome, m]) => {
      const h = hotmartMap[nome] ?? { vendasFront: 0, vendas: 0, faturamento: 0, receitaLiquida: 0 }
      const roasLiquido = m.investimento > 0 ? h.receitaLiquida / m.investimento : 0
      return {
        criativo: nome,
        investimento: m.investimento,
        faturamento: h.faturamento,
        lucro: h.receitaLiquida - m.investimento,
        roas: m.investimento > 0 ? h.faturamento / m.investimento : 0,
        vendasFront: h.vendasFront,
        cpa: h.vendasFront > 0 ? m.investimento / h.vendasFront : 0,
        ctr: m.impressoes > 0 ? (m.cliques / m.impressoes) * 100 : 0,
        semaforo: getSemaforoColor('roasLiquido', roasLiquido),
        link: linkMap[nome] || undefined,
      }
    })
    .filter((c) => c.investimento > 0 || c.faturamento > 0)
    .sort((a, b) => b.lucro - a.lucro)
    .slice(0, 3)

  if (top3.length === 0) return null

  return (
    <section>
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Top 3 Criativos — Lucro
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1F2937]">
                {['#', 'Criativo', 'Investimento', 'Faturamento', 'Lucro', 'ROAS', 'Vendas', 'CPA', ''].map((h) => (
                  <th key={h} className="text-left text-xs text-gray-500 font-medium pb-2 pr-4 last:pr-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top3.map((c, idx) => {
                const lucroColor = c.lucro >= 0 ? 'text-emerald-400' : 'text-rose-400'
                const roasColor  = SEMAFORO_CSS[c.semaforo]
                return (
                  <tr key={c.criativo} className="border-b border-[#1F2937]/50 last:border-0">
                    <td className="py-3 pr-4 text-gray-500 font-bold">{idx + 1}</td>
                    <td className="py-3 pr-4 max-w-[160px]">
                      <p className="text-white text-xs truncate" title={c.criativo}>{c.criativo}</p>
                    </td>
                    <td className="py-3 pr-4 text-gray-300 tabular-nums">{formatCurrencyCompact(c.investimento)}</td>
                    <td className="py-3 pr-4 text-gray-300 tabular-nums">{formatCurrencyCompact(c.faturamento)}</td>
                    <td className={`py-3 pr-4 font-bold tabular-nums ${lucroColor}`}>{formatCurrencyCompact(c.lucro)}</td>
                    <td className={`py-3 pr-4 font-semibold tabular-nums ${roasColor}`}>{formatRoas(c.roas)}</td>
                    <td className="py-3 pr-4 text-gray-300 tabular-nums">{c.vendasFront}</td>
                    <td className={`py-3 pr-4 font-semibold tabular-nums ${c.cpa > 0 ? SEMAFORO_CSS[getSemaforoColorForFunil('cpa', c.cpa, funil, ticketFEPeriodo)] : 'text-gray-500'}`}>{c.cpa > 0 ? formatCurrency(c.cpa) : '–'}</td>
                    <td className="py-3">
                      {c.link && (
                        <a href={c.link} target="_blank" rel="noopener noreferrer" aria-label="Ver criativo"
                          className="text-gray-500 hover:text-cyan-400 transition-colors">
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 h-36 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="bg-[#111827] border border-[#1F2937] rounded-xl p-5 h-28 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section>
      <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-3">{title}</h2>
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl h-48 animate-pulse" />
    </section>
  )
}
