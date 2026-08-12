'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import { ptBR } from 'date-fns/locale'
import 'react-day-picker/style.css'

interface DateRangePickerProps {
  value: string
  onChange: (next: string) => void
  ariaLabel?: string
}

function parseISO(s: string): Date | undefined {
  if (!s) return undefined
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatBR(s: string): string {
  const d = parseISO(s)
  if (!d) return ''
  return d.toLocaleDateString('pt-BR')
}

export default function DateRangePicker({ value, onChange, ariaLabel }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = parseISO(value)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 bg-[#111827] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 hover:border-cyan-500/50 focus:outline-none focus:border-cyan-500/50 transition-colors"
      >
        <CalendarDays size={12} className="text-gray-500" />
        <span>{value ? formatBR(value) : '—'}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 rounded-lg border border-[#1F2937] bg-[#0A0F1E] p-2 shadow-2xl drp-popover">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(d) => {
              if (d) {
                onChange(toISO(d))
                setOpen(false)
              }
            }}
            weekStartsOn={1}
            locale={ptBR}
            showOutsideDays
            captionLayout="dropdown"
          />
          <style jsx global>{`
            .drp-popover .rdp-root {
              --rdp-accent-color: #06B6D4;
              --rdp-accent-background-color: rgba(6, 182, 212, 0.18);
              --rdp-background-color: transparent;
              --rdp-day_button-border-radius: 6px;
              --rdp-today-color: #06B6D4;
              --rdp-outside-opacity: 0.35;
              color: #e5e7eb;
              font-size: 12px;
              margin: 0;
            }
            .drp-popover .rdp-month_caption,
            .drp-popover .rdp-caption_label {
              color: #f3f4f6;
              font-weight: 600;
            }
            .drp-popover .rdp-dropdowns select {
              background: #111827;
              color: #e5e7eb;
              border: 1px solid #1F2937;
              border-radius: 6px;
              padding: 2px 6px;
            }
            .drp-popover .rdp-weekday {
              color: #6b7280;
              font-weight: 500;
              text-transform: uppercase;
              font-size: 10px;
            }
            .drp-popover .rdp-day_button {
              color: #d1d5db;
            }
            .drp-popover .rdp-day_button:hover:not([disabled]) {
              background: rgba(255, 255, 255, 0.06);
            }
            .drp-popover .rdp-selected .rdp-day_button {
              background: #06B6D4;
              color: #0A0F1E;
              font-weight: 600;
            }
            .drp-popover .rdp-today:not(.rdp-selected) .rdp-day_button {
              color: #06B6D4;
              font-weight: 600;
            }
            .drp-popover .rdp-chevron {
              fill: #9ca3af;
            }
            .drp-popover .rdp-button_previous:hover,
            .drp-popover .rdp-button_next:hover {
              background: rgba(255, 255, 255, 0.06);
            }
          `}</style>
        </div>
      )}
    </div>
  )
}
