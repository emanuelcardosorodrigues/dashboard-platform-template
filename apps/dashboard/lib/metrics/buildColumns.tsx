'use client'

/**
 * buildColumns — monta as colunas do DataTable a partir de uma lista de IDs
 * visíveis + o catálogo METRIC_REGISTRY. Os renderizadores das células ricas são
 * portados VERBATIM do CriativosClient/CampanhasClient para garantir ZERO
 * regressão visual no preset "Tudo (legado)". O `format` do registry cobre as
 * células simples; `cellRenderers` cobre as bespoke (semáforo, links, cores).
 */

import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Video, Image as ImageIcon, ExternalLink, ScrollText, ClipboardCopy } from 'lucide-react'
import type { CriativoAgregado } from '@/types'
import { formatCurrencyCompact, formatRoas, formatPercent, formatCurrency, formatDateBR, formatNumber, getFrontEndLabel } from '@/lib/formatters'
import { SEMAFORO_CSS, getSemaforoColorForFunil } from '@/lib/thresholds'
import { METRIC_BY_ID, type MetricScope, type MetricFormat } from './registry'
import MetricHover from '@/components/metrics/MetricHover'
import { deriveDailyValue, METRICAS_COM_SPARKLINE, type DailyComp } from './dailyDerive'

/** Formata um número escalar conforme o formato da métrica (string pro hover). */
function fmtScalar(fmt: MetricFormat | undefined, n: number): string {
  switch (fmt) {
    case 'currencyCompact': return formatCurrencyCompact(n)
    case 'currency': return formatCurrency(n)
    case 'percent': return formatPercent(n)
    case 'roas': return formatRoas(n)
    case 'integer': return String(Math.round(n))
    case 'decimal': return formatNumber(n, 2)
    default: return String(n)
  }
}

export type Row = CriativoAgregado & Record<string, unknown>

/** Compatível com Column<T> do DataTable (+ `info` pro botão de ajuda da Fase 3.2). */
export interface BuiltColumn {
  key: keyof Row
  label: string
  tooltip?: string
  info?: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  width?: number
  render?: (value: Row[keyof Row], row: Row) => ReactNode
}

/**
 * Largura padrão visível por coluna: base pelo formato + garante caber o label
 * (clampado). Assim toda coluna — inclusive as recém-adicionadas — já nasce
 * legível, sem virar fatia fina quando o layout fica fixo.
 */
function defaultColWidth(id: string, label: string, fmt: MetricFormat | undefined, scope: MetricScope): number {
  if (id === 'semaforo') return 60
  if (id === 'criativo') return scope === 'criativos' ? 240 : 260 // nome (criativo/campanha/conjunto)
  if (id === 'status' || id === 'statusMeta') return 96
  const base =
    fmt === 'currencyCompact' || fmt === 'currency' ? 122
    : fmt === 'roas' ? 96
    : fmt === 'percent' ? 110
    : fmt === 'integer' ? 104
    : fmt === 'decimal' ? 96
    : fmt === 'dateBR' ? 112
    : fmt === 'text' ? 150
    : 112
  // Garante caber o cabeçalho INTEIRO por padrão: o header é uppercase + tracking-wider
  // (mais largo por caractere) e tem ícone (i) + seta de ordenação + padding.
  // ~8.6px/char (uppercase espaçado) + 50px (ícones + padding). Teto maior (300)
  // pra nomes longos não truncarem ao adicionar a coluna.
  const labelW = Math.ceil(label.length * 8.6) + 50
  return Math.max(80, Math.min(300, Math.max(base, labelW)))
}

export interface BuildCtx {
  scope: MetricScope
  funil?: string
  ticketMedioPeriodo?: number
  onReelRecap?: (name: string) => void
  onCopyLink?: (link: string) => void
  /** Minigráficos hover (histórico 7d + projeção 7d). Ativos quando `hoje` é dado. */
  hoje?: string
  dowFatores?: number[]
}

const Dash = () => <span className="text-gray-500">–</span>
const n = (v: unknown) => Number(v)

function nomeLabel(scope: MetricScope): string {
  if (scope === 'campanhas') return 'Campanha'
  if (scope === 'conjuntos') return 'Conjunto de Anúncios'
  return 'Criativo'
}

/** Célula simples a partir do formato declarado no registry. */
function formatCell(fmt: MetricFormat | undefined, v: Row[keyof Row]): ReactNode {
  switch (fmt) {
    case 'currencyCompact': return formatCurrencyCompact(n(v))
    case 'currency': return formatCurrency(n(v))
    case 'percent': return formatPercent(n(v))
    case 'roas': return formatRoas(n(v))
    case 'integer': return String(n(v))
    case 'decimal': return formatNumber(n(v), 2)
    case 'dateBR': return formatDateBR(String(v ?? ''))
    case 'text': return String(v ?? '–')
    default: return String(v ?? '–')
  }
}

/** Renderizadores custom (port verbatim). Indexados pelo id da métrica. */
function cellRenderers(ctx: BuildCtx): Record<string, (v: Row[keyof Row], row: Row) => ReactNode> {
  const { funil, ticketMedioPeriodo, onReelRecap, onCopyLink } = ctx
  return {
    semaforo: (v) => {
      const color = v as 'green' | 'yellow' | 'red'
      return (
        <div className={clsx('w-3 h-3 rounded-full mx-auto',
          color === 'green' ? 'bg-emerald-400' : color === 'yellow' ? 'bg-amber-400' : 'bg-rose-500'
        )} />
      )
    },
    // Campanhas/Conjuntos: só o nome (sem ícone/link/recap). Criativos: célula rica.
    criativo: (v, row) => ctx.scope !== 'criativos' ? (
      <span className="text-white text-xs truncate max-w-64 block" title={String(v)}>{String(v)}</span>
    ) : (
      <div className="flex items-center gap-2">
        {row.tipo === 'imagem'
          ? <ImageIcon size={14} className="text-gray-500 shrink-0" />
          : <Video size={14} className="text-gray-500 shrink-0" />}
        <span className="truncate max-w-72 text-white text-xs" title={String(v)}>{String(v)}</span>
        {row.link && (
          <a href={String(row.link)} target="_blank" rel="noopener noreferrer" aria-label="Ver criativo"
            className="shrink-0 text-gray-500 hover:text-cyan-400 transition-colors">
            <ExternalLink size={12} />
          </a>
        )}
        <button
          onClick={() => onReelRecap?.(String(v))}
          title="Reel Recap — resumo de performance"
          className="shrink-0 text-gray-500 hover:text-purple-400 transition-colors cursor-pointer"
        >
          <ScrollText size={12} />
        </button>
        {row.link && (
          <button
            onClick={() => onCopyLink?.(String(row.link))}
            title="Copiar link e abrir transcritor"
            className="shrink-0 text-gray-500 hover:text-cyan-400 transition-colors cursor-pointer"
          >
            <ClipboardCopy size={12} />
          </button>
        )}
        {n(row.investimento) < 50 && (
          <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">Insuf.</span>
        )}
      </div>
    ),
    statusMeta: (v) => {
      const s = String(v || '')
      if (!s) return <span className="text-gray-600">—</span>
      const active = s === 'ACTIVE'
      return <span className={clsx('text-[11px] px-2 py-0.5 rounded-md', active ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-700 text-gray-300')}>{active ? 'Ativo' : 'Pausado'}</span>
    },
    lucro: (v) => <span className={n(v) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrencyCompact(n(v))}</span>,
    roas: (v) => <span className={clsx('font-semibold', SEMAFORO_CSS[getSemaforoColorForFunil('roasLiquido', n(v), funil)])}>{formatRoas(n(v))}</span>,
    roasLiquido: (v) => <span className={clsx('font-semibold', SEMAFORO_CSS[getSemaforoColorForFunil('roasLiquido', n(v), funil)])}>{formatRoas(n(v))}</span>,
    cpa: (v) => {
      const val = n(v)
      if (!val) return <Dash />
      return <span className={clsx('font-semibold', SEMAFORO_CSS[getSemaforoColorForFunil('cpa', val, funil, ticketMedioPeriodo)])}>{formatCurrency(val)}</span>
    },
    cpa24h: (v) => {
      const val = n(v)
      if (!val) return <Dash />
      return <span className={clsx('font-semibold', SEMAFORO_CSS[getSemaforoColorForFunil('cpa', val, funil, ticketMedioPeriodo)])}>{formatCurrency(val)}</span>
    },
    ticketMedio: (v) => n(v) > 0 ? <>{formatCurrency(n(v))}</> : <>–</>,
    ctr: (v) => <span className={clsx(SEMAFORO_CSS[getSemaforoColorForFunil('ctr', n(v), funil)])}>{formatPercent(n(v))}</span>,
    // Criativos: sempre formata. Campanhas/Conjuntos: '–' quando sem impressões (igual ao legado).
    cpm: (v, row) => (ctx.scope !== 'criativos' && n(row.impressoes) <= 0) ? <>–</> : <>{formatCurrency(n(v))}</>,
    cpc: (v, row) => (ctx.scope !== 'criativos' && n(row.impressoes) <= 0) ? <>–</> : <>{formatCurrency(n(v))}</>,
    hookRate: (v, row) => n(row.impressoes) > 0
      ? <span className={clsx(SEMAFORO_CSS[getSemaforoColorForFunil('taxaGancho', n(v), funil)])}>{formatPercent(n(v))}</span>
      : <>–</>,
    retencaoRate: (v, row) => n(row.views3s) > 0
      ? <span className={clsx(SEMAFORO_CSS[getSemaforoColorForFunil('taxaRetencao', n(v), funil)])}>{formatPercent(n(v))}</span>
      : <>–</>,
    cvrPagina: (v, row) => n(row.cliques) > 0 ? <>{formatPercent(n(v))}</> : <>–</>,
    cvrCheckout: (v, row) => n(row.landingViews) > 0 ? <>{formatPercent(n(v))}</> : <>–</>,
    conversaoCheckout: (v, row) => (n(row.checkouts) > 0 && n(v) > 0) ? <>{formatPercent(n(v))}</> : <>–</>,
    convClique: (v) => {
      const val = n(v)
      if (!val) return <Dash />
      return <span className={clsx('font-semibold', SEMAFORO_CSS[getSemaforoColorForFunil('txConversaoClique', val, funil)])}>{formatPercent(val)}</span>
    },
    txConversaoPagina: (v, row) => (n(row.landingViews) > 0 && n(v) > 0) ? <>{formatPercent(n(v))}</> : <>–</>,
    vendasFront: (v) => v !== undefined && v !== null ? <>{String(n(v))}</> : <>0</>,
    vendasOB1: (v) => n(v) > 0 ? <>{String(n(v))}</> : <>–</>,
    vendasOB2: (v) => n(v) > 0 ? <>{String(n(v))}</> : <>–</>,
    vendasOB3: (v) => n(v) > 0 ? <>{String(n(v))}</> : <>–</>,
    vendasOB4: (v) => n(v) > 0 ? <>{String(n(v))}</> : <>–</>,
    vendasUpsell: (v) => { const val = n(v); return !val ? <Dash /> : <span className="text-purple-300 font-semibold">{val}</span> },
    vendasDownsell: (v) => { const val = n(v); return !val ? <Dash /> : <span className="text-purple-300 font-semibold">{val}</span> },
    taxaUpsell: (v) => {
      const val = n(v)
      if (!val) return <Dash />
      return <span className={clsx('font-semibold', val >= 20 ? 'text-emerald-400' : val >= 8 ? 'text-amber-300' : 'text-rose-400')}>{formatPercent(val)}</span>
    },
    taxaDownsell: (v) => {
      const val = n(v)
      if (!val) return <Dash />
      return <span className={clsx('font-semibold', val >= 20 ? 'text-emerald-400' : val >= 8 ? 'text-amber-300' : 'text-rose-400')}>{formatPercent(val)}</span>
    },
    pctQualificados: (v) => {
      const val = n(v)
      if (!val) return <Dash />
      return <span className={clsx(val >= 20 ? 'text-emerald-400' : val >= 10 ? 'text-amber-400' : 'text-rose-400')}>{formatPercent(val)}</span>
    },
    alunosMentoria: (v) => { const val = n(v); return !val ? <Dash /> : <span className="text-purple-400 font-semibold">{val}</span> },
    receitaMentoria: (v) => { const val = n(v); return !val ? <Dash /> : <span className="text-purple-300 font-semibold">{formatCurrency(val)}</span> },
    qualifCount: (v) => { const val = n(v); return !val ? <Dash /> : <span className="text-purple-300 font-semibold">{val}</span> },
    lucroTotal: (v) => { const val = n(v); return <span className={val >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrencyCompact(val)}</span> },
    roasTotal: (v) => {
      const val = n(v)
      if (!val) return <Dash />
      return <span className={clsx('font-semibold', SEMAFORO_CSS[getSemaforoColorForFunil('roasLiquido', val, funil)])}>{formatRoas(val)}</span>
    },
    ultimoDia: (v) => {
      const val = String(v || '')
      if (!val || val === 'undefined' || val === 'null') return <Dash />
      return <span className="text-gray-400">{formatDateBR(val)}</span>
    },
  }
}

/** Monta Column[] do DataTable a partir dos IDs visíveis (na ordem dada). */
export function buildColumns(visibleIds: string[], ctx: BuildCtx): BuiltColumn[] {
  const renderers = cellRenderers(ctx)
  const out: BuiltColumn[] = []
  for (const id of visibleIds) {
    const m = METRIC_BY_ID[id]
    if (!m) continue // preset antigo com métrica removida → ignora
    const label = m.labelDynamic === 'frontEnd'
      ? getFrontEndLabel(ctx.funil)
      : m.labelDynamic === 'nome'
        ? nomeLabel(ctx.scope)
        : m.label
    const custom = renderers[id]
    const base: ((v: Row[keyof Row], row: Row) => ReactNode) | undefined =
      custom ?? (m.format ? (v) => formatCell(m.format, v) : undefined)
    // Métricas que dependem de match vTurb: sem dado → "n/d" (não 0/NaN).
    const renderBase = m.requiresVturb
      ? (v: Row[keyof Row], row: Row) =>
          v === undefined || v === null
            ? <span className="text-gray-500 italic">n/d</span>
            : base ? base(v, row) : String(v)
      : base

    // Minigráficos hover: envolve a célula quando a métrica tem série diária e a
    // página forneceu `ctx.hoje` + `row.__daily`. Não toca em células sem suporte.
    const hoverable = ctx.hoje && METRICAS_COM_SPARKLINE.has(id)
    const render = hoverable
      ? (v: Row[keyof Row], row: Row) => {
          const cell = renderBase ? renderBase(v, row) : String(v ?? '–')
          const daily = (row as Record<string, unknown>).__daily as DailyComp[] | undefined
          if (!daily?.length) return cell
          const serie = daily.map((c) => ({ date: c.d, value: deriveDailyValue(id, c) }))
          // Fallback da projeção = valor agregado da célula (já derivado das
          // métricas que influenciam esta, no período) — garante projeção mesmo
          // sem nenhum dia isolado com a métrica calculável.
          const aggregate = typeof v === 'number' && Number.isFinite(v) ? v : null
          return (
            <MetricHover history={serie} hoje={ctx.hoje!} dowFatores={ctx.dowFatores} label={label}
              fallback={aggregate} format={(n) => fmtScalar(m.format, n)}>
              {cell}
            </MetricHover>
          )
        }
      : renderBase

    out.push({
      key: id as keyof Row,
      label,
      tooltip: m.description,
      info: m.description,
      sortable: m.sortable ?? true,
      align: m.align,
      width: defaultColWidth(id, label, m.format, ctx.scope),
      render,
    })
  }
  return out
}
