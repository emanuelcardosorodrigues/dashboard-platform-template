'use client'

import LineAreaChart from '@/components/charts/LineAreaChart'
import type { DailyFinancial } from '@/types'

interface Props {
  data: DailyFinancial[]
}

export default function LineAreaChartWrapper({ data }: Props) {
  return <LineAreaChart data={data} />
}
