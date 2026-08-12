export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { cookies } from 'next/headers'
import Header from '@/components/layout/Header'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { fetchMetaAds, fetchTransacoes, fetchFunisConfig, getDateRange, filterByFunil, filterByAccount, filterTransacoesByFunil, tipoDaTransacao } from '@/lib/supabase'
import { aggregateByOrigem, ORIGEM_COLOR } from '@/lib/origem'
import { formatCurrencyCompact, formatCurrency, formatPercent } from '@/lib/formatters'
import type { CriativoAgregado } from '@/types'
import CampanhasClient from './CampanhasClient'
import ComparisonHero from '@/components/cards/ComparisonHero'
import { computePeriodSummary } from '@/lib/periodSummary'
import { brazilDateStr } from '@/lib/brazilDate'
import { diaSemanaFatores } from '@/lib/metrics/sparkline'
import { emptyComp, type DailyComp } from '@/lib/metrics/dailyDerive'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel } from '@/lib/comparePeriods'
import { aggregateBy } from '@/lib/adsAggregation'

export default async function CampanhasPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string; cmp?: string; cmpDe?: string; cmpAte?: string }> }) {
  const { de = '', ate = '', funil = 'all', conta = 'all', cmp, cmpDe, cmpAte } = await searchParams
  const cmpMode = parseCompareMode(cmp)
  const cmpRange = computeComparisonRange(de, ate, cmpMode, cmpDe, cmpAte)
  const cmpLabel = cmpRange ? formatComparisonLabel(cmpMode, cmpRange) : ''
  const allMeta = await fetchMetaAds()
  const accountOptions = [...new Set(allMeta.map((r) => r.account_id).filter((id): id is string => Boolean(id)))]
  return (
    <div className="flex flex-col h-full">
      <Header title="Campanhas" subtitle="Performance por campanha e conjunto de anúncios" accountOptions={accountOptions} />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-96 animate-pulse" />}>
          <CampanhasContent de={de} ate={ate} funil={funil} conta={conta} cmpFrom={cmpRange?.from} cmpTo={cmpRange?.to} cmpLabel={cmpLabel} />
        </Suspense>
      </div>
    </div>
  )
}


async function CampanhasContent({ de, ate, funil, conta, cmpFrom, cmpTo, cmpLabel }: { de: string; ate: string; funil: string; conta: string; cmpFrom?: string; cmpTo?: string; cmpLabel?: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allRows, allTransacoes, sessionRole] = await Promise.all([
    fetchMetaAds(), fetchTransacoes(),
    cookies().then((c) => c.get(SESSION_COOKIE)?.value).then((sid) => sid ? lookupSession(sid) : null).then((s) => s?.role ?? null).catch(() => null),
  ])
  const isAdmin = sessionRole === 'admin'
  const accountFiltered = filterByAccount(allRows, conta)
  const funis = await fetchFunisConfig()
  const rows = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, funis)
  const transacoes = filterTransacoesByFunil(
    allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)) && (t.valor_bruto || 0) > 1),
    funil,
    accountFiltered,
    funis
  )

  const allForAttribution = filterByFunil(accountFiltered, funil, funis)
  const campanhas = aggregateBy(rows, allForAttribution, transacoes, 'campaign_name')
  const conjuntos = aggregateBy(rows, allForAttribution, transacoes, 'adset_name')

  const [current, previous] = await Promise.all([
    computePeriodSummary(de, ate, funil, conta),
    (cmpFrom && cmpTo) ? computePeriodSummary(cmpFrom, cmpTo, funil, conta) : null,
  ])

  const ticketMedioPeriodo = current.ticketMedio ?? 0

  // ── Séries diárias pros minigráficos (hover) — independente de filtro ──
  // Histórico é propriedade da campanha/conjunto: usa allRows/allTransacoes,
  // só a janela de 30d. Receita atribuída por ad_id→grupo (det.) + fallback nome.
  const hoje = brazilDateStr(0)
  const janelaDias: string[] = []
  for (let n = 30; n >= 1; n--) janelaDias.push(brazilDateStr(n))
  const jIni = janelaDias[0]
  const jFim = janelaDias[janelaDias.length - 1]

  const adIdToCamp: Record<string, string> = {}
  const adIdToAdset: Record<string, string> = {}
  const nameToCamp: Record<string, string> = {}
  const nameToAdset: Record<string, string> = {}
  const nameLast: Record<string, string> = {}
  allRows.forEach((r) => {
    if (r.ad_id) { if (r.campaign_name) adIdToCamp[r.ad_id] = r.campaign_name; if (r.adset_name) adIdToAdset[r.ad_id] = r.adset_name }
    const nm = r.ad_name || r.criativo
    if (nm && r.data && (!nameLast[nm] || r.data > nameLast[nm])) {
      nameLast[nm] = r.data
      if (r.campaign_name) nameToCamp[nm] = r.campaign_name
      if (r.adset_name) nameToAdset[nm] = r.adset_name
    }
  })

  const dailyCamp: Record<string, Record<string, DailyComp>> = {}
  const dailyAdset: Record<string, Record<string, DailyComp>> = {}
  const addMeta = (c: DailyComp, r: typeof allRows[number]) => {
    c.inv += r.investimento || 0; c.imp += r.impressoes || 0; c.alc += r.alcance || 0
    c.cliques += r.cliques_link || 0; c.lpv += r.landing_views || 0; c.checkouts += r.checkouts || 0
    c.v3 += r.views_3seg || 0; c.v75 += r.views_75pct || 0; c.v95 += r.views_95pct || 0
  }
  allRows.filter((r) => r.data >= jIni && r.data <= jFim).forEach((r) => {
    if (r.campaign_name) addMeta((dailyCamp[r.campaign_name] ??= {})[r.data] ??= emptyComp(r.data), r)
    if (r.adset_name) addMeta((dailyAdset[r.adset_name] ??= {})[r.data] ??= emptyComp(r.data), r)
  })
  allTransacoes.filter((t) => t.data && t.data.slice(0, 10) >= jIni && t.data.slice(0, 10) <= jFim && (t.valor_bruto || 0) > 1).forEach((t) => {
    const day = t.data!.slice(0, 10)
    const nm = t.criativo || ''
    const camp = (t.ad_id && adIdToCamp[t.ad_id]) || adIdToCamp[nm] || nameToCamp[nm]
    const adset = (t.ad_id && adIdToAdset[t.ad_id]) || adIdToAdset[nm] || nameToAdset[nm]
    const front = tipoDaTransacao(t) === 'frontEnd'
    if (camp) { const c = (dailyCamp[camp] ??= {})[day] ??= emptyComp(day); c.fat += t.valor_bruto || 0; if (front) c.vendasFront += 1 }
    if (adset) { const c = (dailyAdset[adset] ??= {})[day] ??= emptyComp(day); c.fat += t.valor_bruto || 0; if (front) c.vendasFront += 1 }
  })
  const serie = (map: Record<string, Record<string, DailyComp>>, name: string): DailyComp[] =>
    janelaDias.map((d) => map[name]?.[d] ?? emptyComp(d))

  const dowDias: string[] = []
  for (let n = 90; n >= 1; n--) dowDias.push(brazilDateStr(n))
  const fatDia: Record<string, number> = {}
  allTransacoes.forEach((t) => {
    if ((t.valor_bruto || 0) <= 1 || !t.data) return
    const day = t.data.slice(0, 10)
    if (day >= dowDias[0] && day <= dowDias[dowDias.length - 1]) fatDia[day] = (fatDia[day] || 0) + (t.valor_bruto || 0)
  })
  const dowFatores = diaSemanaFatores(dowDias.map((d) => ({ date: d, value: fatDia[d] ?? 0 })))

  const campanhasD = campanhas.map((c) => ({ ...c, __daily: serie(dailyCamp, c.criativo) }))
  const conjuntosD = conjuntos.map((c) => ({ ...c, __daily: serie(dailyAdset, c.criativo) }))

  // Outras origens (não-pago): receita que NÃO vem de campanha paga e que hoje
  // some no agregado (cai em 'Sem campanha'). Classificação determinística.
  const origensNaoPagas = aggregateByOrigem(transacoes).filter((r) => r.origem !== 'pago')
  const totalNaoPago = origensNaoPagas.reduce((s, r) => s + r.faturamentoBruto, 0)

  return (
    <>
      <ComparisonHero
        current={current}
        previous={previous}
        cmpLabel={cmpLabel}
        metrics={['faturamento', 'investimento', 'lucro', 'roas', 'cpa', 'vendasFront']}
      />
      <CampanhasClient campanhas={campanhasD} conjuntos={conjuntosD} funil={funil} ticketMedioPeriodo={ticketMedioPeriodo} isAdmin={isAdmin} hoje={hoje} dowFatores={dowFatores} />

      {origensNaoPagas.length > 0 && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1F2937]">
            <h2 className="text-sm font-semibold text-white">Outras origens</h2>
            <span className="text-xs text-gray-500">— receita sem campanha paga (orgânico, WhatsApp, direto) · {formatCurrencyCompact(totalNaoPago)} no período</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1F2937]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-widest">Origem</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">Faturamento</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">%</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">Vendas</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">TM</th>
                </tr>
              </thead>
              <tbody>
                {origensNaoPagas.map((r) => (
                  <tr key={r.origem} className="border-b border-[#1F2937] hover:bg-[#1F2937]/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: ORIGEM_COLOR[r.origem] }} />
                        <span className="text-gray-200">{r.label}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-emerald-400 tabular-nums font-medium">{formatCurrencyCompact(r.faturamentoBruto)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums">{totalNaoPago > 0 ? formatPercent((r.faturamentoBruto / totalNaoPago) * 100) : '–'}</td>
                    <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">{r.vendas}</td>
                    <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">{r.vendasFront > 0 ? formatCurrency(r.faturamentoBruto / r.vendasFront) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[10px] text-gray-400 border-t border-[#1F2937]">
            Classificação determinística por UTM/ad_id (sem IA). Tráfego pago está nas tabelas de campanha/conjunto acima.
          </p>
        </div>
      )}
    </>
  )
}
