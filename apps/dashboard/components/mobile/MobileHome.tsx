'use client'

/**
 * RICH MOBILE HOME (md:hidden) — topo da /visao-geral só no celular.
 *
 * Três cards de KPI expansíveis (Faturamento · Valor Gasto · Lucro). Tocar num
 * card abre o detalhamento por produto e por conta com barras de participação
 * (share do total) + uma linha de contexto. Abaixo, um mini gráfico de barras
 * "Performance por dia" (Recharts) da série diária do período.
 *
 * Todos os dados chegam prontos e serializáveis do server (MobileHomeSection em
 * page.tsx) — este componente só apresenta. Tokens copiados dos cards do desktop
 * (canvas #0A0F1E, card #111827, inner #0d1420, borda #1F2937; ciano/rosa/verde).
 */

import { useMemo, useState } from 'react'
import { ChevronDown, ArrowUpRight, ArrowDownRight, Activity, Sparkles } from 'lucide-react'
import {
  ComposedChart, Bar, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts'
import { formatCurrencyCompact, formatPercent, formatDateBR } from '@/lib/formatters'
import type { WhatChangedLine } from '@/lib/whatChanged'

// ─── Tipos (espelham o server) ────────────────────────────────────────────────

export interface MobileBreakdownRow { label: string; value: number }
export interface MobileBreakdown {
  title: string
  context: string
  total: number
  signed?: boolean
  rows: MobileBreakdownRow[]
}
export interface MobileKpi {
  key: string
  label: string
  total: number
  totalLabel: string
  accent: 'cyan' | 'rose' | 'emerald'
  positive?: boolean
  breakdowns: MobileBreakdown[]
}
export interface MobileDaily {
  date: string; faturamento: number; investimento: number; lucro: number
  // F2 — banda de esperado (nulos nos primeiros dias sem histórico).
  esperado?: number | null; bandLo?: number | null; bandHi?: number | null; outside?: boolean
}
/** Chip de razão-chave (ROAS/CPA/etc). `tone` acende a cor do semáforo. */
export interface MobileStat { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }
export interface MobileHomeProps {
  kpis: MobileKpi[]
  daily: MobileDaily[]
  hasData: boolean
  stats?: MobileStat[]
  /** F1 — linhas do card "o que mudou" (já filtradas por relevância no server). */
  changes?: WhatChangedLine[]
}

const TONE_TEXT: Record<NonNullable<MobileStat['tone']>, string> = {
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-rose-400',
  neutral: 'text-white',
}

const ACCENT_HEX: Record<MobileKpi['accent'], string> = {
  cyan: '#06B6D4',
  rose: '#F43F5E',
  emerald: '#10B981',
}
const ACCENT_TEXT: Record<MobileKpi['accent'], string> = {
  cyan: 'text-cyan-400',
  rose: 'text-rose-400',
  emerald: 'text-emerald-400',
}

// ─── F1 — Card "o que mudou" ──────────────────────────────────────────────────
// Topo da Home. Só renderiza quando o server mandou linhas (relevância já
// aplicada em lib/whatChanged.ts). Cor + seta juntas (nunca cor sozinha — C10).

const CHANGE_TONE_TEXT: Record<'good' | 'bad', string> = {
  good: 'text-emerald-400',
  bad: 'text-rose-400',
}

// F5 — pergunta determinística montada EM CÓDIGO a partir da linha da anomalia
// (nunca por IA — regra do dono). Não embute de/ate/funil/conta: o AskAIDrawer lê
// a URL atual no envio, então o recorte fica exato e a pergunta, limpa.
function buildWhyQuestion(c: WhatChangedLine): string {
  const suffix = 'Analise o recorte atual e aponte os prováveis motivos.'
  if (c.metric === 'lucro' && c.atual < 0 && c.esperado >= 0) {
    return `Por que o ${c.label} virou prejuízo no período atual, se o esperado era positivo? ${suffix}`
  }
  const subiu = c.deltaPct >= 0
  if (c.metric === 'roas' || c.metric === 'cpa') {
    const pct = Math.round(Math.abs(c.deltaPct) * 100)
    return `Por que o ${c.label} ${subiu ? 'subiu' : 'caiu'} ${pct}% em relação ao esperado no período atual? ${suffix}`
  }
  return `Por que o ${c.label} ficou ${subiu ? 'acima' : 'abaixo'} do esperado no período atual? ${suffix}`
}

// Abre o AskAIDrawer pré-preenchido: o drawer (montado no layout do dashboard)
// escuta `odin:ask` no window e injeta a pergunta no textarea + abre o painel.
function askWhy(c: WhatChangedLine) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('odin:ask', { detail: { question: buildWhyQuestion(c) } }))
}

function WhatChangedCard({ changes }: { changes: WhatChangedLine[] }) {
  if (!changes || changes.length === 0) return null
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Activity size={14} className="text-cyan-400" />
        <h2 className="text-[11px] font-medium text-gray-400 uppercase tracking-widest">O que mudou</h2>
      </div>
      <ul className="space-y-2">
        {changes.map((c) => {
          // A seta segue o SENTIDO do movimento (subiu/caiu); a cor segue o TOM
          // (bom/ruim) — as duas dimensões, porque CPA subindo é ruim (C10).
          const Dir = c.deltaPct >= 0 ? ArrowUpRight : ArrowDownRight
          return (
            <li key={c.metric} className="flex items-center gap-2">
              <Dir size={15} className={`${CHANGE_TONE_TEXT[c.tone]} shrink-0`} strokeWidth={2.5} aria-hidden />
              <p className="flex-1 min-w-0 text-[13px] text-gray-200 leading-snug">
                {c.text}<span className="sr-only"> ({c.tone === 'bad' ? 'ruim' : 'bom'})</span>
              </p>
              {/* F5 — 1 toque pra IA responder o que o app já sabe (pergunta em código). */}
              <button
                type="button"
                onClick={() => askWhy(c)}
                aria-label={`Perguntar à IA por que ${c.label} mudou no período`}
                className="tap-target--body min-h-11 shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-indigo-300 bg-indigo-500/10 active:bg-indigo-500/20 transition-colors"
              >
                <Sparkles size={13} aria-hidden />
                <span>Por quê?</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Barra de participação ────────────────────────────────────────────────────

function BreakdownBar({ row, bd, accentHex }: { row: MobileBreakdownRow; bd: MobileBreakdown; accentHex: string }) {
  const maxAbs = Math.max(1, ...bd.rows.map((r) => Math.abs(r.value)))
  const share = bd.total !== 0 ? (row.value / bd.total) * 100 : 0
  const width = bd.signed
    ? (Math.abs(row.value) / maxAbs) * 100
    : Math.max(0, Math.min(100, share))
  const positive = row.value >= 0
  const barColor = bd.signed ? (positive ? '#10B981' : '#F43F5E') : accentHex
  const right = bd.signed
    ? `${positive ? '' : '−'}${formatCurrencyCompact(Math.abs(row.value))}`
    : `${formatCurrencyCompact(row.value)} · ${formatPercent(Math.max(0, share))}`

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-gray-300 truncate">{row.label}</span>
        <span className={`text-[12px] tabular-nums shrink-0 ${bd.signed && !positive ? 'text-rose-400' : 'text-gray-400'}`}>
          {right}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#1F2937] overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(width, row.value !== 0 ? 3 : 0)}%`, background: barColor }} />
      </div>
    </div>
  )
}

// ─── C7/C8 — bullet vs. esperado ──────────────────────────────────────────────
// Barra fina (4px) com o preenchimento no valor REAL e um tique no ESPERADO.
// Substitui o "tá bom?" que o número sozinho não responde (Few — glanceable).
// `atual`/`esperado` chegam na MESMA janela modelada (maçã-com-maçã); a cor segue
// a DIREÇÃO da métrica (faturamento/lucro: acima = bom), nunca cor sozinha (C10).

interface KpiBullet {
  atual: number
  esperado: number
  betterWhenHigher: boolean
  /** Dias que entraram na comparação (só os que têm banda modelada). */
  dias: number
  /** Dias do período inteiro — o que o card acima soma. */
  diasPeriodo: number
}

function KpiBulletBar({ bullet }: { bullet: KpiBullet }) {
  const { atual, esperado, betterWhenHigher } = bullet
  const deltaPct = esperado !== 0 ? (atual - esperado) / Math.abs(esperado) : 0
  const good = betterWhenHigher ? atual >= esperado : atual <= esperado
  const scaleMax = Math.max(Math.abs(atual), Math.abs(esperado)) * 1.12 || 1
  const fillPct = Math.max(0, Math.min(100, (Math.abs(atual) / scaleMax) * 100))
  const tickPct = Math.max(0, Math.min(100, (Math.abs(esperado) / scaleMax) * 100))
  const barColor = good ? '#10B981' : '#F43F5E'
  const pctLabel = `${deltaPct >= 0 ? '+' : '−'}${Math.round(Math.abs(deltaPct) * 100)}% vs. esperado`
  // O recorte da comparação é MENOR que o do card acima: só entram os dias que já
  // têm banda modelada (lib/whatChanged exige 5 dias de histórico antes de
  // projetar). Sem dizer isso, o bullet parecia comparar com o total do card e a
  // diferença virava "erro de conta" aos olhos de quem lê.
  const recorte = bullet.dias < bullet.diasPeriodo
    ? `${bullet.dias} de ${bullet.diasPeriodo} dias do período (os 1ºs dias não têm histórico para projetar)`
    : `${bullet.dias} dias do período`
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-1.5 rounded-full bg-[#1F2937]">
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fillPct}%`, background: barColor }} />
          <span
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 rounded-full bg-gray-300"
            style={{ left: `calc(${tickPct}% - 1px)` }}
            aria-hidden
          />
        </div>
        <span className={`shrink-0 text-[11px] font-medium tabular-nums ${good ? 'text-emerald-400' : 'text-rose-400'}`}>
          {pctLabel}
        </span>
      </div>
      <p className="text-[10px] text-gray-500 leading-snug">
        {formatCurrencyCompact(atual)} vs. {formatCurrencyCompact(esperado)} em {recorte}
      </p>
    </div>
  )
}

// ─── Card de KPI expansível ───────────────────────────────────────────────────

function KpiCardMobile({ kpi, bullet, open, onToggle }: { kpi: MobileKpi; bullet?: KpiBullet; open: boolean; onToggle: () => void }) {
  const accentHex = ACCENT_HEX[kpi.accent]
  const valueColor = kpi.key === 'lucro'
    ? (kpi.positive ? 'text-emerald-400' : 'text-rose-400')
    : ACCENT_TEXT[kpi.accent]

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-4 text-left active:bg-[#131c2e] transition-colors"
      >
        <div className="min-w-0">
          <span className="block text-[11px] font-medium text-gray-400 uppercase tracking-wider">{kpi.label}</span>
          <span className={`block text-2xl font-bold tracking-tight tabular-nums ${valueColor}`}>{kpi.totalLabel}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="h-8 w-1 rounded-full" style={{ background: accentHex }} />
          <ChevronDown size={18} className={`text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {bullet && bullet.esperado > 0 && (
        <div className="px-4 pb-3 -mt-1">
          <KpiBulletBar bullet={bullet} />
        </div>
      )}

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-[#1F2937] pt-3">
          {kpi.breakdowns.map((bd) => (
            <div key={bd.title} className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-gray-500 uppercase tracking-widest">{bd.title}</span>
              </div>
              {bd.rows.length > 0 ? (
                <div className="space-y-2">
                  {bd.rows.map((row, i) => (
                    <BreakdownBar key={`${row.label}-${i}`} row={row} bd={bd} accentHex={accentHex} />
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-600">Sem dados neste recorte.</p>
              )}
              {bd.context && <p className="text-[12px] text-gray-500 leading-snug">{bd.context}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Mini gráfico "Performance por dia" ───────────────────────────────────────

// Recharts 3: tipagem do Tooltip é chata — payload solto + Number() em vez de
// tipos explícitos (o `payload` do custom content carrega o datum em .payload).
function ChartTooltip(props: { active?: boolean; payload?: Array<{ payload?: MobileDaily }>; label?: string }) {
  if (!props.active || !props.payload || props.payload.length === 0) return null
  const d = props.payload[0]?.payload
  if (!d) return null
  const fat = Number(d.faturamento) || 0
  const inv = Number(d.investimento) || 0
  const luc = Number(d.lucro) || 0
  const esp = d.esperado
  const temEsp = esp != null && Number.isFinite(esp)
  const rows: { label: string; v: number; c: string }[] = [
    { label: 'Faturamento', v: fat, c: '#06B6D4' },
    { label: 'Gasto', v: inv, c: '#F43F5E' },
    { label: 'Lucro', v: luc, c: luc >= 0 ? '#10B981' : '#F43F5E' },
  ]
  if (temEsp) rows.push({ label: 'Esperado', v: Number(esp), c: '#A78BFA' })
  return (
    <div className="bg-[#1F2937] border border-[#374151] rounded-lg p-2.5 shadow-xl">
      <p className="text-[11px] text-gray-400 mb-1.5">{formatDateBR(String(d.date))}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.c }} />
          <span className="text-gray-400">{r.label}:</span>
          <span className="font-semibold text-white tabular-nums">{formatCurrencyCompact(r.v)}</span>
        </div>
      ))}
      {d.outside && (
        <p className="text-[10px] text-amber-400 mt-1.5">Fora do esperado</p>
      )}
    </div>
  )
}

function PerfChart({ daily }: { daily: MobileDaily[] }) {
  const interval = daily.length > 8 ? Math.floor(daily.length / 6) : 0
  // Recharts desenha uma "range area" quando o dataKey é uma tupla [lo, hi].
  // Só onde a banda é válida (histórico suficiente); senão null → gap.
  const data = daily.map((d) => ({
    ...d,
    band: d.bandLo != null && d.bandHi != null ? ([d.bandLo, d.bandHi] as [number, number]) : null,
  }))
  const temBanda = data.some((d) => d.band != null)
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-[11px] font-medium text-gray-400 uppercase tracking-widest shrink-0">Performance por dia</h2>
        <span className="text-[11px] text-gray-600 truncate text-right">
          {temBanda ? 'faixa lilás = esperado • ⬤ âmbar = fora' : 'verde = lucro • vermelho = prejuízo'}
        </span>
      </div>
      {daily.length > 0 ? (
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => {
                const p = String(v).split('-')
                return p.length === 3 ? `${p[2]}/${p[1]}` : String(v)
              }}
              tick={{ fill: '#6B7280', fontSize: 12 }}
              axisLine={{ stroke: '#1F2937' }}
              tickLine={false}
              interval={interval}
            />
            <YAxis hide domain={[0, 'auto']} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: '#ffffff08' }} />
            {/* F2 — banda [lo, hi] do esperado (atrás das barras) */}
            <Area
              dataKey="band"
              stroke="none"
              fill="#A78BFA"
              fillOpacity={0.13}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
              activeDot={false}
            />
            {/* Barras reais — cor por sinal do lucro; contorno âmbar se fora da banda */}
            <Bar dataKey="faturamento" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={Number(d.lucro) >= 0 ? '#06B6D4' : '#F43F5E'}
                  stroke={d.outside ? '#FBBF24' : undefined}
                  strokeWidth={d.outside ? 2 : 0}
                />
              ))}
            </Bar>
            {/* Linha tracejada do esperado (na frente, fina) */}
            <Line
              dataKey="esperado"
              type="monotone"
              stroke="#A78BFA"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
              activeDot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-[11px] text-gray-600 py-8 text-center">Sem série diária no período.</p>
      )}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function MobileHome({ kpis, daily, hasData, stats, changes }: MobileHomeProps) {
  const [openKey, setOpenKey] = useState<string | null>('faturamento')

  // C8 — bullet vs. esperado. Hoje só o Faturamento tem esperado disponível: a
  // banda F2 (daily.esperado) é calculada sobre o faturamento diário. Somo real e
  // esperado na MESMA janela modelada (dias com banda) → comparação honesta. Se
  // no futuro o server mandar esperado de Gasto/Lucro, é só adicionar aqui.
  const bullets = useMemo<Record<string, KpiBullet>>(() => {
    let atual = 0
    let esperado = 0
    let n = 0
    for (const d of daily) {
      if (d.esperado != null && Number.isFinite(d.esperado)) {
        atual += d.faturamento
        esperado += d.esperado
        n++
      }
    }
    const out: Record<string, KpiBullet> = {}
    if (n >= 3 && esperado > 0) {
      out.faturamento = { atual, esperado, betterWhenHigher: true, dias: n, diasPeriodo: daily.length }
    }
    return out
  }, [daily])

  if (!hasData) {
    return (
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 text-center">
        <p className="text-sm text-gray-400">Sem dados no período selecionado.</p>
        <p className="text-[11px] text-gray-600 mt-1">Ajuste o intervalo de datas ou os filtros acima.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <WhatChangedCard changes={changes ?? []} />
      {kpis.map((kpi) => (
        <KpiCardMobile
          key={kpi.key}
          kpi={kpi}
          bullet={bullets[kpi.key]}
          open={openKey === kpi.key}
          onToggle={() => setOpenKey((prev) => (prev === kpi.key ? null : kpi.key))}
        />
      ))}
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="bg-[#111827] border border-[#1F2937] rounded-xl px-3 py-2.5">
              <span className="block text-[12px] font-medium text-gray-500 uppercase tracking-wider">{s.label}</span>
              <span className={`block text-lg font-bold tabular-nums ${TONE_TEXT[s.tone ?? 'neutral']}`}>{s.value}</span>
            </div>
          ))}
        </div>
      )}
      <PerfChart daily={daily} />
    </div>
  )
}
