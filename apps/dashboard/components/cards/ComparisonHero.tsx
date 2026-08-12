import { GitCompare } from 'lucide-react'
import KpiCard from './KpiCard'
import type { PeriodSummary } from '@/lib/periodSummary'
import { formatCurrencyCompact, formatPercent, formatRoas, formatCurrency, formatNumber } from '@/lib/formatters'

interface Props {
  current: PeriodSummary | null
  previous: PeriodSummary | null
  cmpLabel?: string
  /** Restringe a métricas relevantes pra cada página (default: amplo) */
  metrics?: Array<MetricKey>
}

type MetricKey =
  | 'faturamento' | 'lucro' | 'investimento'
  | 'roas' | 'cpa' | 'ticketMedio'
  | 'ctr' | 'cpc' | 'cpm'
  | 'convPagina' | 'convClique' | 'takeRateOB'
  | 'taxaUpsell' | 'taxaDownsell'
  | 'vendasFront' | 'compradoresPorDia'
  | 'impressoes' | 'cliques' | 'landingViews' | 'checkouts'

const DEFAULT_METRICS: MetricKey[] = [
  'faturamento', 'lucro', 'roas', 'cpa', 'vendasFront', 'compradoresPorDia',
]

interface MetricConfig {
  label: string
  format: (v: number) => string
  invert?: boolean
}

const METRIC_CONFIG: Record<MetricKey, MetricConfig> = {
  faturamento:      { label: 'Faturamento',     format: formatCurrencyCompact },
  lucro:            { label: 'Lucro Bruto',     format: formatCurrencyCompact },
  investimento:     { label: 'Investimento',    format: formatCurrencyCompact, invert: true },
  roas:             { label: 'ROAS',            format: formatRoas },
  cpa:              { label: 'CPA',             format: (v) => v > 0 ? formatCurrency(v) : '–', invert: true },
  ticketMedio:      { label: 'Ticket Médio',    format: (v) => v > 0 ? formatCurrency(v) : '–' },
  ctr:              { label: 'CTR',             format: formatPercent },
  cpc:              { label: 'CPC',             format: (v) => v > 0 ? formatCurrency(v) : '–', invert: true },
  cpm:              { label: 'CPM',             format: (v) => v > 0 ? formatCurrency(v) : '–', invert: true },
  convPagina:       { label: 'Conv. Página',    format: formatPercent },
  convClique:       { label: 'Conv. Clique',    format: formatPercent },
  takeRateOB:       { label: 'Take Rate OB',    format: formatPercent },
  taxaUpsell:       { label: 'Conv. Upsell',    format: formatPercent },
  taxaDownsell:     { label: 'Conv. Downsell',  format: formatPercent },
  vendasFront:      { label: 'Compradores',     format: (v) => formatNumber(v, 0) },
  compradoresPorDia:{ label: 'Comprad./dia',    format: (v) => formatNumber(v, 1) },
  impressoes:       { label: 'Impressões',      format: (v) => formatNumber(v, 0) },
  cliques:          { label: 'Cliques',         format: (v) => formatNumber(v, 0) },
  landingViews:     { label: 'Landing views',   format: (v) => formatNumber(v, 0) },
  checkouts:        { label: 'Checkouts',       format: (v) => formatNumber(v, 0) },
}

export default function ComparisonHero({ current, previous, cmpLabel, metrics = DEFAULT_METRICS }: Props) {
  if (!current || !previous) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <GitCompare size={13} className="text-cyan-400" />
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">
          Comparação <span className="text-gray-400 normal-case font-normal ml-1">{previous.range.from} → {previous.range.to}</span>
        </h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map((key) => {
          const cfg = METRIC_CONFIG[key]
          const cur = Number(current[key])
          const prev = Number(previous[key])
          return (
            <KpiCard
              key={key}
              label={cfg.label}
              value={cfg.format(cur)}
              compare={{ current: cur, previous: prev, invert: cfg.invert, label: cmpLabel }}
            />
          )
        })}
      </div>
    </section>
  )
}
