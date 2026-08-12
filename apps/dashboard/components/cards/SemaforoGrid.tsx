import { clsx } from 'clsx'
import { SEMAFORO_CSS, SEMAFORO_BG, SEMAFORO_BORDER } from '@/lib/thresholds'
import type { SemaforoItem } from '@/types'

interface SemaforoGridProps {
  items: SemaforoItem[]
  // First N items are treated as primary (larger, more prominent)
  primaryCount?: number
}

export default function SemaforoGrid({ items, primaryCount = 2 }: SemaforoGridProps) {
  const primary = items.slice(0, primaryCount)
  const secondary = items.slice(primaryCount)

  return (
    <div className="space-y-3">
      {/* Primary metrics: ROAS and CPA — larger, dominant */}
      <div className="grid grid-cols-2 gap-3">
        {primary.map((item) => (
          <div
            key={item.metricKey}
            className={clsx(
              'rounded-xl p-5 border-2',
              SEMAFORO_BG[item.color],
              SEMAFORO_BORDER[item.color]
            )}
          >
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{item.label}</p>
            <p className={clsx('text-3xl font-bold tabular-nums', SEMAFORO_CSS[item.color])}>
              {item.formatted}
            </p>
          </div>
        ))}
      </div>
      {/* Secondary metrics */}
      {secondary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {secondary.map((item) => (
            <div
              key={item.metricKey}
              className={clsx(
                'rounded-xl p-4 border',
                SEMAFORO_BG[item.color],
                SEMAFORO_BORDER[item.color]
              )}
            >
              <p className="text-xs text-gray-400 truncate mb-2">{item.label}</p>
              <p className={clsx('text-xl font-bold tabular-nums', SEMAFORO_CSS[item.color])}>
                {item.formatted}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
