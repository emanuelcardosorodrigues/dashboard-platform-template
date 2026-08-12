import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { clsx } from 'clsx'
import { calcDeltaPct } from '@/lib/comparePeriods'

interface Props {
  current: number
  previous: number
  /** Se true, inverte a cor (baixar é bom — ex.: CPA, CPC) */
  invert?: boolean
  /** Texto após o delta — ex: "vs. período anterior" */
  label?: string
  /** Tamanho */
  size?: 'sm' | 'md'
  /** Mostrar valor absoluto entre parênteses */
  showAbsolute?: boolean
  formatAbsolute?: (v: number) => string
}

export default function DeltaBadge({ current, previous, invert, label, size = 'sm', showAbsolute, formatAbsolute }: Props) {
  const pct = calcDeltaPct(current, previous)
  const diff = current - previous

  // Estado neutro quando previous = 0 — não dá pra calcular %
  if (pct === null) {
    return (
      <div className={clsx(
        'inline-flex items-center gap-1 font-medium text-gray-500',
        size === 'md' ? 'text-xs' : 'text-[10px]'
      )}>
        <Minus size={size === 'md' ? 12 : 10} />
        <span>—{label ? ` ${label}` : ''}</span>
      </div>
    )
  }

  const positive = pct > 0
  const neutral = pct === 0
  const good = neutral ? null : (invert ? !positive : positive)
  const color = neutral ? 'text-gray-500' : good ? 'text-emerald-400' : 'text-rose-400'
  const Icon = neutral ? Minus : positive ? TrendingUp : TrendingDown

  const sign = pct > 0 ? '+' : ''
  const pctStr = `${sign}${pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

  return (
    <div className={clsx(
      'inline-flex items-center gap-1 font-medium',
      color,
      size === 'md' ? 'text-xs' : 'text-[10px]'
    )} title={label}>
      <Icon size={size === 'md' ? 12 : 10} />
      <span className="tabular-nums">{pctStr}</span>
      {showAbsolute && formatAbsolute && (
        <span className="text-gray-500 tabular-nums">({diff > 0 ? '+' : ''}{formatAbsolute(diff)})</span>
      )}
      {label && <span className="text-gray-500">{label}</span>}
    </div>
  )
}
