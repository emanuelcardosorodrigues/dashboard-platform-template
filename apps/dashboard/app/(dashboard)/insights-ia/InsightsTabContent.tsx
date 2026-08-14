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

/** Conteúdo sem shell reutilizado pela sub-aba "Insights IA" consolidada. */
export default async function InsightsTabContent({
  de,
  ate,
  data,
}: {
  de?: string
  ate?: string
  data?: string
}) {
  // Compat: ?data=YYYY-MM-DD vira from=to.
  const from = de ?? data ?? brazilDateStr(7)
  const to = ate ?? data ?? brazilDateStr(1)

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
    <InsightsIAClient
      from={from}
      to={to}
      insight={insight}
      metricas={metricas}
      creatives={creatives}
      cohorts={cohorts}
    />
  )
}
