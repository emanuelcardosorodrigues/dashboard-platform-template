'use client'

/**
 * Slider — range input reutilizável (substitui os `<input type="range">` crus
 * espalhados pelo app, ex.: app/(dashboard)/experimentos/ExperimentosClient.tsx).
 *
 * Segue a mesma linha de BottomSheet.tsx (único outro primitivo em
 * components/ui/): sem dependência nova, cores do tema hard-coded em hex
 * (`#111827` superfície, `#1F2937` borda, `#06B6D4` accent), estilo via
 * Tailwind + `<style jsx>` pontual só onde o CSS puro exige (pseudo-elementos
 * de thumb/track, que Tailwind não alcança).
 *
 * Truque de trilho: o `<input>` nativo fica com o próprio track TRANSPARENTE
 * (WebKit e Gecko) e um `<div>` decorativo por baixo desenha o visual (neutro
 * ou em bandas coloridas). O thumb nativo continua sendo o único elemento
 * clicável/arrastável — arrasta, teclado (setas) e a11y vêm de graça do
 * `<input type="range">` real, nunca simulados via div+drag.
 */

import { memo, useMemo } from 'react'
import { clsx } from 'clsx'

export interface SliderProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  /** formata o valor para exibição, ex: (v) => `R$ ${v.toFixed(2)}` */
  format?: (v: number) => string
  /** valor de referência "atual" — mostra ao lado e marca no trilho */
  baseline?: number
  /** faixas coloridas no trilho: [{ até: number, cor: 'bad'|'warn'|'ok' }] em ordem crescente */
  bandas?: Array<{ ate: number; cor: 'bad' | 'warn' | 'ok' }>
  disabled?: boolean
  /** texto curto abaixo do slider */
  hint?: string
}

// Mesmas cores do semáforo do app (lib/thresholds.ts: SEMAFORO_DOT_COLOR) —
// nenhuma cor nova, só reaproveita vermelho/amarelo/verde já usados em todo lugar.
const BANDA_COLOR: Record<'bad' | 'warn' | 'ok', string> = {
  bad: '#F43F5E',
  warn: '#F59E0B',
  ok: '#10B981',
}

// Cor do trilho sem bandas — igual ao token --color-border do tema (#1F2937).
const TRACK_NEUTRAL = '#1F2937'

function toPct(v: number, min: number, max: number): number {
  if (max <= min) return 0
  return Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))
}

function SliderImpl({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  baseline,
  bandas,
  disabled = false,
  hint,
}: SliderProps) {
  const displayValue = format ? format(value) : String(value)
  const baselineDisplay = baseline != null ? (format ? format(baseline) : String(baseline)) : null
  const baselinePct = baseline != null ? toPct(baseline, min, max) : null

  // Gradiente de bandas com stops "duros" (sem blend) — cada faixa some no
  // ponto exato onde a próxima começa. Se a última banda não cobrir 100% do
  // trilho, a cor dela é estendida até o fim (nunca deixa a ponta sem cor).
  const trackBackground = useMemo(() => {
    if (!bandas || bandas.length === 0) return TRACK_NEUTRAL
    const stops: string[] = []
    let prevPct = 0
    for (const banda of bandas) {
      const pct = toPct(banda.ate, min, max)
      const color = BANDA_COLOR[banda.cor]
      stops.push(`${color} ${prevPct}%`, `${color} ${pct}%`)
      prevPct = pct
    }
    if (prevPct < 100) {
      const lastColor = BANDA_COLOR[bandas[bandas.length - 1].cor]
      stops.push(`${lastColor} ${prevPct}%`, `${lastColor} 100%`)
    }
    return `linear-gradient(to right, ${stops.join(', ')})`
  }, [bandas, min, max])

  return (
    <div className={clsx('w-full', disabled && 'pointer-events-none opacity-50')}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-gray-400">
          {label}
        </label>
        <div className="flex items-baseline gap-2">
          {baselineDisplay != null && (
            <span className="text-[10px] text-gray-500 tabular-nums">atual {baselineDisplay}</span>
          )}
          <span className="text-sm font-semibold text-white tabular-nums">{displayValue}</span>
        </div>
      </div>

      {/* Área do trilho — a altura do próprio <input> (var(--tap-body), 44px)
          já é o alvo de toque efetivo; o visual (linha fina + thumb de 22px)
          fica centralizado dentro dela. */}
      <div className="relative flex items-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full"
          style={{ background: trackBackground }}
        />

        {baselinePct != null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-3 w-0.5 rounded-full bg-gray-300/80"
            style={{ left: `${baselinePct}%`, transform: 'translate(-50%, -50%)' }}
          />
        )}

        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${label}: ${displayValue}`}
          aria-valuetext={displayValue}
          className="lucro-slider-range w-full appearance-none bg-transparent"
        />
      </div>

      {hint && <p className="mt-1 text-[10px] text-gray-500">{hint}</p>}

      <style jsx>{`
        .lucro-slider-range {
          -webkit-appearance: none;
          appearance: none;
          height: var(--tap-body, 44px);
          cursor: pointer;
        }
        .lucro-slider-range::-webkit-slider-runnable-track {
          -webkit-appearance: none;
          height: 6px;
          background: transparent;
        }
        .lucro-slider-range::-moz-range-track {
          height: 6px;
          background: transparent;
          border: none;
        }
        .lucro-slider-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 22px;
          height: 22px;
          margin-top: -8px; /* (6px de track - 22px de thumb) / 2, centraliza o thumb no track */
          border-radius: 9999px;
          background: #06b6d4;
          border: 2px solid #0a0f1e;
          box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.45);
          cursor: pointer;
          transition: transform 0.15s ease;
        }
        .lucro-slider-range::-moz-range-thumb {
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: #06b6d4;
          border: 2px solid #0a0f1e;
          box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.45);
          cursor: pointer;
          transition: transform 0.15s ease;
        }
        .lucro-slider-range:hover::-webkit-slider-thumb,
        .lucro-slider-range:active::-webkit-slider-thumb {
          transform: scale(1.08);
        }
        .lucro-slider-range:hover::-moz-range-thumb,
        .lucro-slider-range:active::-moz-range-thumb {
          transform: scale(1.08);
        }
        .lucro-slider-range:focus-visible {
          outline: 2px solid #06b6d4;
          outline-offset: 4px;
          border-radius: 9999px;
        }
        .lucro-slider-range:disabled {
          cursor: not-allowed;
        }
        .lucro-slider-range:disabled::-webkit-slider-thumb {
          background: #4b5563;
          box-shadow: none;
        }
        .lucro-slider-range:disabled::-moz-range-thumb {
          background: #4b5563;
          box-shadow: none;
        }
      `}</style>
    </div>
  )
}

const Slider = memo(SliderImpl)
export default Slider
