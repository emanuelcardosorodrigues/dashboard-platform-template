'use client'

import StackedBarChart from '@/components/charts/StackedBarChart'
import type { VendasPorProdutoDia } from '@/types'

interface Props {
  data: VendasPorProdutoDia[]
  frontEndLabel?: string
}

export default function StackedBarChartWrapper({ data, frontEndLabel }: Props) {
  return <StackedBarChart data={data} frontEndLabel={frontEndLabel} />
}
