import Header from '@/components/layout/Header'
import {
  fetchLatestAiInsightForRange,
  fetchClarityDailyRange,
  fetchMetaAds,
  fetchTransacoes,
  fetchQualificacao,
} from '@/lib/supabase'
import { brazilDateStr } from '@/lib/brazilDate'
import { aggregateCreatives } from '@/lib/creativeAnalysis'
import { cohortByCreative, type CreativeCohort } from '@/lib/cohortAnalysis'
import InsightsIAClient from './InsightsIAClient'

export const dynamic = 'force-dynamic'

export default async function InsightsIAPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; data?: string }>
}) {
  const params = await searchParams
  // Compat: ?data=YYYY-MM-DD vira from=to.
  const from = params.de ?? params.data ?? brazilDateStr(7)
  const to = params.ate ?? params.data ?? brazilDateStr(1)

  const [insight, metricas, metaAds, transacoes, qualificacao] = await Promise.all([
    fetchLatestAiInsightForRange(from, to),
    fetchClarityDailyRange(from, to),
    fetchMetaAds(),
    fetchTransacoes(),
    fetchQualificacao(),
  ])

  const metaPeriodo = metaAds.filter((m) => m.data >= from && m.data <= to)
  const transPeriodo = transacoes.filter((t) => (t.data ?? '') >= from && (t.data ?? '') <= to)
  const creatives = aggregateCreatives(metaPeriodo, transPeriodo)
  const cohortMap = cohortByCreative(transPeriodo, qualificacao)
  const cohorts: CreativeCohort[] = Array.from(cohortMap.values())

  return (
    <div className="flex flex-col h-full">
      <Header title="Insights IA" subtitle="Análise estratégica do período · Gemini" />
      <div className="flex-1 overflow-y-auto p-6">
        <InsightsIAClient
          from={from}
          to={to}
          insight={insight}
          metricas={metricas}
          creatives={creatives}
          cohorts={cohorts}
        />
      </div>
    </div>
  )
}
