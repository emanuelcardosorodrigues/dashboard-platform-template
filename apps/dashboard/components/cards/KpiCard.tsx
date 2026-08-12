import { clsx } from 'clsx'
import { SEMAFORO_CSS, SEMAFORO_BG, type ThresholdKey } from '@/lib/thresholds'
import type { SemaforoColor } from '@/types'
import DeltaBadge from './DeltaBadge'

interface KpiCardProps {
  label: string
  value: string
  metricKey?: ThresholdKey
  semaforoColor?: SemaforoColor
  icon?: React.ReactNode
  subtext?: string
  size?: 'default' | 'lg'
  /** Comparação opcional — quando presente, renderiza DeltaBadge no rodapé */
  compare?: {
    current: number
    previous: number
    /** Inverter cor (baixa = bom): true pra CPA/CPC/CPM */
    invert?: boolean
    label?: string
  }
  /** Conteúdo fixo no rodapé (ex.: minigráficos histórico+projeção). */
  footer?: React.ReactNode
}

export default function KpiCard({
  label,
  value,
  metricKey: _metricKey,
  semaforoColor,
  icon,
  subtext,
  size = 'default',
  compare,
  footer,
}: KpiCardProps) {
  const color: SemaforoColor | null = semaforoColor ?? null

  return (
    <div
      className={clsx(
        'bg-[#111827] border-[#1F2937] rounded-xl flex flex-col gap-2',
        'hover:bg-[#131c2e] transition-colors duration-200',
        size === 'lg' ? 'p-6 border-2' : 'p-5 border',
        color && SEMAFORO_BG[color],
        color === 'green' && 'border-b-emerald-500/60',
        color === 'yellow' && 'border-b-amber-500/60',
        color === 'red' && 'border-b-rose-500/60',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={clsx(
          'font-medium text-gray-400 uppercase tracking-wider',
          size === 'lg' ? 'text-xs' : 'text-xs'
        )}>{label}</span>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      <div>
        <p
          className={clsx(
            'font-bold tracking-tight tabular-nums',
            size === 'lg' ? 'text-4xl' : 'text-2xl',
            color ? SEMAFORO_CSS[color] : 'text-white'
          )}
        >
          {value}
        </p>
        {subtext && (
          <p className="text-xs text-gray-500 mt-0.5">{subtext}</p>
        )}
      </div>
      {compare && (
        <DeltaBadge
          current={compare.current}
          previous={compare.previous}
          invert={compare.invert}
          label={compare.label}
          size={size === 'lg' ? 'md' : 'sm'}
        />
      )}
      {footer}
    </div>
  )
}
