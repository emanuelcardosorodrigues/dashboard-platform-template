import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { clsx } from 'clsx'
import type { SemaforoColor } from '@/types'

interface DiagnosticoItem {
  level: SemaforoColor | 'info'
  title: string
  description: string
}

interface DiagnosticoAlertProps {
  items: DiagnosticoItem[]
}

const ICONS = {
  green: CheckCircle2,
  yellow: AlertTriangle,
  red: XCircle,
  info: Info,
}

const COLORS = {
  green: {
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/30',
    icon: 'text-emerald-400',
    title: 'text-emerald-300',
    text: 'text-emerald-200/70',
  },
  yellow: {
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/30',
    icon: 'text-amber-400',
    title: 'text-amber-300',
    text: 'text-amber-200/70',
  },
  red: {
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    icon: 'text-rose-400',
    title: 'text-rose-300',
    text: 'text-rose-200/70',
  },
  info: {
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    icon: 'text-cyan-400',
    title: 'text-cyan-300',
    text: 'text-cyan-200/70',
  },
}

export default function DiagnosticoAlert({ items }: DiagnosticoAlertProps) {
  if (items.length === 0) return null

  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const Icon = ICONS[item.level]
        const c = COLORS[item.level]
        return (
          <div
            key={i}
            className={clsx('flex items-start gap-3 rounded-xl p-4 border', c.bg, c.border)}
          >
            <Icon size={18} className={clsx('shrink-0 mt-0.5', c.icon)} />
            <div>
              <p className={clsx('text-sm font-semibold', c.title)}>{item.title}</p>
              <p className={clsx('text-xs mt-0.5', c.text)}>{item.description}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
