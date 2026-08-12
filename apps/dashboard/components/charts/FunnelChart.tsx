'use client'

import { formatNumber, formatPercent, formatCurrency, formatCurrencyCompact } from '@/lib/formatters'
import type { FunilEtapa } from '@/types'
import { clsx } from 'clsx'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { ArrowUp, Minus, ArrowDown } from 'lucide-react'

interface FunnelChartProps {
  etapas: FunilEtapa[]
  orientation?: 'horizontal' | 'vertical'
  cpm?: number
  custos?: number[]
}

// ── Vertical: design ORIGINAL (trapézios, largura = performance vs verde) ─────
// C4 — a paleta original é um degradê cyan→verde de 5 tons em que as etapas 3
// (#0E9F6E) e 4 (#10B981) são o MESMO verde — indistinguíveis, ainda mais em
// deuteranopia. No desktop mantemos idêntico (é o visual que o dono conhece); no
// mobile trocamos por um degradê frio→quente com passos de HUE e luminância, em
// que nenhum par vizinho colide (>2:1) e nenhuma etapa é verde ambíguo.
const STAGE_COLORS = [
  '#06B6D4', // cyan       — impressões
  '#0891B2', // cyan-600   — cliques
  '#0E9F6E', // teal       — landing
  '#10B981', // emerald    — checkout
  '#059669', // green      — compras
]
const STAGE_COLORS_MOBILE = [
  '#67E8F9', // cyan-300   (claro)
  '#3B82F6', // blue-500
  '#8B5CF6', // violet-500
  '#EC4899', // pink-500
  '#FBBF24', // amber-400  (claro/quente)
]
// Label da taxa que aparece à DIREITA (o que mede a passagem de cada etapa)
const RATE_LABELS = ['CPM', 'CTR', 'Carregamento', 'Passagem', 'CVS Checkout']
// Label do custo que aparece DENTRO do trapézio
const COST_LABELS = ['CPM', 'CPC-Link', 'PageView', 'Checkout', 'Front']
// Larguras ideais quando TUDO está no verde = funil bonito como na referência
const IDEAL_WIDTHS = [96, 80, 65, 52, 40]
const STAGE_H = 58
const GAP = 4
const MIN_PERF = 0.12

// ── Horizontal: faixa suave (gradiente azul → roxo → rosa) ────────────────────
const STOPS: [number, number, number][] = [[59, 130, 246], [139, 92, 246], [236, 72, 153]]
function colorAt(t: number): string {
  const x = Math.max(0, Math.min(1, t))
  const seg = x <= 0.5 ? 0 : 1
  const local = x <= 0.5 ? x / 0.5 : (x - 0.5) / 0.5
  const a = STOPS[seg], b = STOPS[seg + 1]
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * local))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
const MIN_FRAC = 0.1

export default function FunnelChart({ etapas, orientation = 'horizontal', cpm, custos }: FunnelChartProps) {
  // C4/C10 — hook chamado ANTES de qualquer return pra respeitar as regras de
  // hooks. No mobile: paleta corrigida + ícone junto da cor da taxa.
  const isMobile = useIsMobile()
  const stageColors = isMobile ? STAGE_COLORS_MOBILE : STAGE_COLORS
  if (!etapas.length) return null

  // ════════════════════════════════════════════════════════════════════════
  // MOBILE (C5) — BARRAS HORIZONTAIS ALINHADAS À ESQUERDA
  //
  // Intercepta as DUAS orientações no celular: abaixo de `md` sempre desenhamos
  // barras, nunca trapézio. O trapézio codifica volume na LARGURA de um polígono
  // que afina — canal que o olho lê mal e distorce a proporção [ref C, dataviz].
  // Aqui cada etapa é uma barra alinhada à esquerda cujo COMPRIMENTO é o volume:
  // comparar etapas vira medir comprimento a partir de uma base comum (o canal
  // perceptual mais preciso), e a pilha é naturalmente estreita → cabe em 360px
  // sem adaptar mais nada. Desktop (md+) NÃO passa por aqui: cai no ramo abaixo,
  // byte-a-byte idêntico ao atual.
  //
  // Escala do comprimento: ancorada nos CLIQUES (etapa 1) — a MESMA convenção do
  // ramo horizontal. Impressões é alcance, não entrada de funil; numa escala
  // linear até as impressões todo o resto (cliques→compra, onde mora o vazamento)
  // vira sliver de 1px. Então impressões e cliques enchem a barra e daí pra baixo
  // o comprimento é `valor / cliques`, com piso MIN_FRAC pra nenhuma etapa não-zero
  // sumir. O número real fica SEMPRE impresso à direita do nome — o piso garante
  // uma barra visível, nunca esconde dado.
  if (isMobile) {
    const base = etapas[1]?.valor || etapas[0]?.valor || 1 // cliques = 100%
    const frac = etapas.map((e, i) =>
      i === 0 ? 1 : Math.max(MIN_FRAC, base > 0 ? Math.min(1, e.valor / base) : 0),
    )
    // Performance relativa ao verde (idêntica ao ramo vertical) só pra COLORIR a
    // passagem e escolher a seta — não afeta o comprimento da barra.
    const performances = etapas.map((e) => {
      if (e.pctAnterior === undefined || !e.thresholdVerde) return 1
      return Math.min(1, Math.max(MIN_PERF, e.pctAnterior / e.thresholdVerde))
    })

    return (
      <div className="flex flex-col gap-2 w-full">
        {etapas.map((e, i) => {
          const color = stageColors[i % stageColors.length]
          const perf = performances[i]
          // C10 — a passagem (maior = melhor) é sinalizada por COR + SETA, nunca
          // cor sozinha: ▲ verde / ─ âmbar / ▼ vermelho dizem melhor/pior sem cor.
          const rateColor = perf >= 1 ? 'text-emerald-400' : perf >= 0.67 ? 'text-amber-400' : 'text-rose-400'
          const RateIcon = perf >= 1 ? ArrowUp : perf >= 0.67 ? Minus : ArrowDown

          return (
            <div key={e.nome} className="flex flex-col gap-1.5 py-1.5">
              {/* Cabeçalho: badge + nome (esq) · volume da etapa (dir) */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border"
                    style={{ backgroundColor: color + '22', color, borderColor: color + '55' }}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="text-sm text-gray-300 truncate">{e.nome}</span>
                </div>
                <span className="text-sm font-bold text-white tabular-nums shrink-0">{formatNumber(e.valor)}</span>
              </div>

              {/* Barra (comprimento = volume) + passagem da etapa anterior à direita */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-3 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${frac[i] * 100}%`, backgroundColor: color }}
                  />
                </div>
                <div className="w-24 shrink-0 text-right leading-tight">
                  {i === 0 ? (
                    cpm !== undefined && cpm > 0 ? (
                      <>
                        <p className="text-xs font-bold tabular-nums text-gray-300">{formatCurrency(cpm)}</p>
                        <p className="text-xs text-gray-500">CPM</p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-500">—</p>
                    )
                  ) : e.pctAnterior !== undefined ? (
                    <>
                      <p className={clsx('flex items-center justify-end gap-1 text-xs font-bold tabular-nums', rateColor)}>
                        <RateIcon size={13} strokeWidth={2.5} aria-hidden />
                        {formatPercent(e.pctAnterior)}
                      </p>
                      <p className="text-xs text-gray-500">{RATE_LABELS[i]}</p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-500">—</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // VERTICAL — restaurado idêntico ao original (mesmas contas, métricas, visual)
  // ════════════════════════════════════════════════════════════════════════
  if (orientation === 'vertical') {
    // Performance relativa ao verde: 1.0 = bateu o benchmark, <1 = abaixo
    const performances = etapas.map((e) => {
      if (e.pctAnterior === undefined || !e.thresholdVerde) return 1
      return Math.min(1, Math.max(MIN_PERF, e.pctAnterior / e.thresholdVerde))
    })
    // Largura real = ideal × performance
    const widths = etapas.map((_, i) => Math.round((IDEAL_WIDTHS[i] ?? 40) * performances[i]))

    return (
      <div className="flex gap-5 items-start w-full">
        {/* Labels esquerda: nome + volume */}
        <div className="flex flex-col shrink-0 w-36" style={{ gap: GAP }}>
          {etapas.map((e) => (
            <div key={e.nome} className="flex flex-col justify-center" style={{ height: STAGE_H }}>
              <p className="text-xs text-gray-400 leading-tight truncate">{e.nome}</p>
              <p className="text-sm font-bold text-white tabular-nums mt-0.5">{formatNumber(e.valor)}</p>
            </div>
          ))}
        </div>

        {/* Trapézios com custo + label dentro */}
        <div className="flex-1 flex flex-col" style={{ gap: GAP }}>
          {etapas.map((e, i) => {
            const topW = widths[i]
            const botW = widths[i + 1] ?? Math.max(Math.round(widths[i] * 0.6), 8)
            const lT = (100 - topW) / 2
            const rT = (100 + topW) / 2
            const lB = (100 - botW) / 2
            const rB = (100 + botW) / 2
            const perf = performances[i]
            const color = stageColors[i % stageColors.length]
            const opacity = 0.45 + perf * 0.5
            const custo = custos?.[i] ?? 0

            return (
              <div key={e.nome} className="relative" style={{ height: STAGE_H }}>
                <div
                  className="absolute inset-0 transition-all duration-500"
                  style={{ clipPath: `polygon(${lT}% 0%, ${rT}% 0%, ${rB}% 100%, ${lB}% 100%)`, backgroundColor: color, opacity }}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-0.5">
                  {custo > 0 ? (
                    <>
                      <span className="text-xs font-bold text-white/90 tabular-nums leading-tight drop-shadow">{formatCurrency(custo)}</span>
                      <span className="text-[10px] text-white/60 leading-tight">{COST_LABELS[i]}</span>
                    </>
                  ) : (
                    <span className="text-xs font-bold text-white/50">—</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Direita: badge + taxa com label correto */}
        <div className="flex flex-col shrink-0 items-end" style={{ gap: GAP }}>
          {etapas.map((e, i) => {
            const color = stageColors[i % stageColors.length]
            const perf = performances[i]
            const rateColor = perf >= 1 ? 'text-emerald-400' : perf >= 0.67 ? 'text-amber-400' : 'text-rose-400'
            // C10 — a passagem (maior = melhor) é sinalizada SÓ pela cor da taxa.
            // No mobile pareamos com uma seta: ▲ no verde, ─ no amarelo, ▼ no
            // vermelho. A seta sozinha já diz melhor/pior sem depender da cor.
            const RateIcon = perf >= 1 ? ArrowUp : perf >= 0.67 ? Minus : ArrowDown

            return (
              <div key={e.nome} className="flex items-center gap-2 justify-end" style={{ height: STAGE_H }}>
                <div className="text-right w-20">
                  {i === 0 ? (
                    cpm !== undefined && cpm > 0 ? (
                      <>
                        <p className="text-sm font-bold tabular-nums text-gray-300">{formatCurrency(cpm)}</p>
                        <p className="text-xs text-gray-400">CPM</p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400">—</p>
                    )
                  ) : e.pctAnterior !== undefined ? (
                    <>
                      <p className={clsx('flex items-center justify-end gap-1 text-sm font-bold tabular-nums', rateColor)}>
                        {isMobile && <RateIcon size={13} strokeWidth={2.5} aria-hidden />}
                        {formatPercent(e.pctAnterior)}
                      </p>
                      <p className="text-xs text-gray-400">{RATE_LABELS[i]}</p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">—</p>
                  )}
                </div>
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border"
                  style={{ backgroundColor: color + '22', color, borderColor: color + '55' }}
                >
                  {String.fromCharCode(65 + i)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // HORIZONTAL — faixa suave. Convenção: IMPRESSÕES e CLIQUES com o MESMO
  // tamanho; daí pra baixo a largura e a % são relativas aos CLIQUES (etapa 1),
  // então carregamento/checkout/etc. saem como combinamos (vs cliques).
  // ════════════════════════════════════════════════════════════════════════
  const n = etapas.length
  const base = etapas[1]?.valor || etapas[0]?.valor || 1 // cliques = 100%
  const pct = etapas.map((e, i) => (i === 0 ? 100 : base > 0 ? (e.valor / base) * 100 : 0))
  const frac = etapas.map((e, i) => (i === 0 ? 1 : Math.max(MIN_FRAC, base > 0 ? Math.min(1, e.valor / base) : 0)))
  const colorOf = (i: number) => colorAt(n > 1 ? i / (n - 1) : 0)

  const W = 1000, H = 300, mid = H / 2, maxHH = 120
  const hh = frac.map((f) => f * maxHH)
  const colW = W / n
  const polys = etapas.map((_, i) => {
    const x0 = i * colW, x1 = (i + 1) * colW
    const hL = hh[i], hR = hh[i + 1] ?? hh[i] * 0.78
    return `${x0},${mid - hL} ${x1},${mid - hR} ${x1},${mid + hR} ${x0},${mid + hL}`
  })

  return (
    <div className="relative w-full" style={{ minHeight: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
        {polys.map((p, i) => (
          <polygon key={i} points={p} fill={colorOf(i)} opacity={0.92} />
        ))}
      </svg>
      {/* Overlay: nome (topo) · % vs cliques (centro) · quantidade + R$ (base) */}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {etapas.map((e, i) => (
          <div
            key={e.nome}
            className={clsx('flex flex-col items-center justify-between py-3 px-1 text-center', i > 0 && 'border-l border-white/10')}
          >
            <p className="text-[11px] text-gray-300 leading-tight truncate w-full" title={e.nome}>{e.nome}</p>
            <p className="text-xl font-bold text-white drop-shadow tabular-nums">{formatPercent(pct[i])}</p>
            <div className="leading-tight">
              <p className="text-sm font-bold text-white tabular-nums">{formatNumber(e.valor)}</p>
              {e.receita !== undefined && e.receita > 0 && (
                <p className="text-[11px] text-emerald-300 tabular-nums">{formatCurrencyCompact(e.receita)}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
