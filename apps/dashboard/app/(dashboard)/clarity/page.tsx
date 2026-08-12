import Header from '@/components/layout/Header'
import { fetchClarityDailyRange, fetchLatestAiInsightForRange } from '@/lib/supabase'
import { brazilDateStr } from '@/lib/brazilDate'
import ClarityClient from './ClarityClient'

export const dynamic = 'force-dynamic'

export default async function ClarityPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  const { de, ate } = await searchParams
  const from = de ?? brazilDateStr(7)
  const to = ate ?? brazilDateStr(1)

  const [metricas, insight] = await Promise.all([
    fetchClarityDailyRange(from, to),
    fetchLatestAiInsightForRange(from, to),
  ])

  return (
    <div className="flex flex-col h-full">
      <Header title="Clarity" subtitle="Comportamento real do usuário (Microsoft Clarity)" />
      <div className="flex-1 overflow-y-auto p-6">
        <ClarityClient from={from} to={to} insight={insight} metricas={metricas} />
      </div>
    </div>
  )
}
