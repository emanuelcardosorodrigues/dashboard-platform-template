'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import {
  Plus,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Play,
  Pause,
  Archive,
  Trash2,
  Pencil,
  HelpCircle,
  AlertCircle,
  Users,
  CheckCircle2,
  TrendingDown,
  Copy,
  Check,
  Filter,
  X,
  ShoppingCart,
  Tag,
} from 'lucide-react'
import type { SbQuiz, SbQuizConfig } from '@/lib/supabase'
import { formatDateBR } from '@/lib/formatters'
import FilterToggle from '@/components/filters/FilterToggle'

const QUIZ_BASE = 'example.com/q'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  paused: 'Pausado',
  archived: 'Arquivado',
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  active: 'bg-emerald-500/20 text-emerald-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  archived: 'bg-zinc-700/40 text-zinc-500',
}

interface FunnelStep {
  step_index: number
  step_id: string
  views: number
  answers: number
  dropouts: number
  completions: number
  checkout_clicks: number
}

interface SessionsAgg { total: number; completed: number; lastStarted: string | null }
interface SalesAgg { count: number; revenue: number }
interface UtmAgg {
  source: Record<string, number>
  medium: Record<string, number>
  campaign: Record<string, number>
  content: Record<string, number>
}

interface Props {
  quizzes: SbQuiz[]
  sessionsBySlug: Record<string, SessionsAgg>
  salesBySlug: Record<string, SalesAgg>
  funnelBySlug: Record<string, FunnelStep[]>
  utmsBySlug: Record<string, UtmAgg>
  checkoutClicksBySlug: Record<string, number>
}

function fmt(n: number) {
  return n.toLocaleString('pt-BR')
}

function fmtPct(n: number) {
  return n.toFixed(1).replace('.', ',') + '%'
}

function fmtBRL(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export default function QuizzesClient({ quizzes, sessionsBySlug, salesBySlug, funnelBySlug, utmsBySlug, checkoutClicksBySlug }: Props) {
  const router = useRouter()
  const [showNew, setShowNew] = useState(false)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  // Auto-expand: priority is the first ACTIVE quiz with funnel data
  const initialExpanded = quizzes.find(q => q.status === 'active' && (funnelBySlug[q.slug]?.length ?? 0) > 0)?.slug
    ?? quizzes.find(q => (funnelBySlug[q.slug]?.length ?? 0) > 0)?.slug
    ?? null
  const [expandedSlug, setExpandedSlug] = useState<string | null>(initialExpanded)
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set())
  const editingQuiz = quizzes.find(q => q.slug === editingSlug) ?? null

  function refresh() {
    router.refresh()
  }

  function toggleSlug(slug: string) {
    setSelectedSlugs(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  // Empty selection = show all (matches the spec: "todos quando nenhum selecionado")
  const filteredQuizzes = selectedSlugs.size === 0
    ? quizzes
    : quizzes.filter(q => selectedSlugs.has(q.slug))

  // Aggregated metrics — Conversão = vendas (sck_slug match) / sessões únicas
  const totals = filteredQuizzes.reduce(
    (acc, q) => {
      const s = sessionsBySlug[q.slug] ?? { total: 0, completed: 0, lastStarted: null }
      const v = salesBySlug[q.slug] ?? { count: 0, revenue: 0 }
      acc.sessions += s.total
      acc.leads += s.completed
      acc.checkoutClicks += checkoutClicksBySlug[q.slug] ?? 0
      acc.sales += v.count
      acc.revenue += v.revenue
      return acc
    },
    { sessions: 0, leads: 0, checkoutClicks: 0, sales: 0, revenue: 0 }
  )
  const aggConv = totals.sessions > 0 ? (totals.sales / totals.sessions) * 100 : 0

  return (
    <>
      <FilterToggle prefix="q" />

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Quizzes interativos</h2>
          <p className="text-xs text-gray-500 mt-1">
            Configuração no Supabase, servidos pelo Worker em {QUIZ_BASE}/{`{slug}`}.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
        >
          <Plus size={16} />
          Novo quiz
        </button>
      </div>

      {quizzes.length > 0 && (
        <QuizFilter
          quizzes={quizzes}
          sessionsBySlug={sessionsBySlug}
          salesBySlug={salesBySlug}
          selectedSlugs={selectedSlugs}
          onToggle={toggleSlug}
          onClear={() => setSelectedSlugs(new Set())}
          totals={totals}
          aggConv={aggConv}
          showingCount={filteredQuizzes.length}
          totalCount={quizzes.length}
        />
      )}

      {quizzes.length === 0 ? (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-10 text-center">
          <HelpCircle size={32} className="mx-auto text-gray-400 mb-3" />
          <p className="text-sm text-gray-400">Nenhum quiz cadastrado ainda.</p>
          <p className="text-xs text-gray-400 mt-1">Clique em "Novo quiz" para criar o primeiro.</p>
        </div>
      ) : filteredQuizzes.length === 0 ? (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-8 text-center">
          <Filter size={24} className="mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-400">Nenhum quiz corresponde ao filtro.</p>
          <button
            onClick={() => setSelectedSlugs(new Set())}
            className="text-xs text-cyan-400 hover:text-cyan-300 mt-2 cursor-pointer"
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredQuizzes.map(q => {
            const sess = sessionsBySlug[q.slug] ?? { total: 0, completed: 0, lastStarted: null }
            const sales = salesBySlug[q.slug] ?? { count: 0, revenue: 0 }
            const utms = utmsBySlug[q.slug] ?? { source: {}, medium: {}, campaign: {}, content: {} }
            const funnel = funnelBySlug[q.slug] ?? []
            const checkoutClicks = checkoutClicksBySlug[q.slug] ?? 0
            const conversionRate = sess.total > 0 ? (sales.count / sess.total) * 100 : 0
            const expanded = expandedSlug === q.slug
            return (
              <QuizRow
                key={q.slug}
                quiz={q}
                sess={sess}
                sales={sales}
                utms={utms}
                funnel={funnel}
                checkoutClicks={checkoutClicks}
                conversionRate={conversionRate}
                expanded={expanded}
                onToggle={() => setExpandedSlug(expanded ? null : q.slug)}
                onEdit={() => setEditingSlug(q.slug)}
                onChanged={refresh}
              />
            )
          })}
        </div>
      )}

      {showNew && (
        <QuizModal
          mode="create"
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); refresh() }}
        />
      )}

      {editingQuiz && (
        <QuizModal
          mode="edit"
          quiz={editingQuiz}
          onClose={() => setEditingSlug(null)}
          onSaved={() => { setEditingSlug(null); refresh() }}
        />
      )}
    </>
  )
}

// ─── QuizFilter — multi-select chip filter + aggregate totals ──────────────

interface FilterProps {
  quizzes: SbQuiz[]
  sessionsBySlug: Record<string, SessionsAgg>
  salesBySlug: Record<string, SalesAgg>
  selectedSlugs: Set<string>
  onToggle: (slug: string) => void
  onClear: () => void
  totals: { sessions: number; leads: number; checkoutClicks: number; sales: number; revenue: number }
  aggConv: number
  showingCount: number
  totalCount: number
}

function QuizFilter({
  quizzes,
  sessionsBySlug,
  salesBySlug,
  selectedSlugs,
  onToggle,
  onClear,
  totals,
  aggConv,
  showingCount,
  totalCount,
}: FilterProps) {
  const hasSelection = selectedSlugs.size > 0
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Filter size={13} className="text-cyan-400" />
          <span className="font-medium text-gray-300">Filtrar por quiz</span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500">
            {hasSelection
              ? `${showingCount} de ${totalCount} selecionado${showingCount === 1 ? '' : 's'}`
              : `Todos os ${totalCount} quizzes`}
          </span>
        </div>
        {hasSelection && (
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-white transition-colors cursor-pointer"
          >
            <X size={12} />
            Limpar
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {quizzes.map(q => {
          const selected = selectedSlugs.has(q.slug)
          const sess = sessionsBySlug[q.slug] ?? { total: 0, completed: 0, lastStarted: null }
          const sales = salesBySlug[q.slug] ?? { count: 0, revenue: 0 }
          return (
            <button
              key={q.slug}
              onClick={() => onToggle(q.slug)}
              className={clsx(
                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer border',
                selected
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                  : 'bg-[#0B1220] border-[#1F2937] text-gray-400 hover:text-white hover:border-[#2a3445]'
              )}
              title={`/${q.slug} — ${fmt(sess.total)} sessões · ${fmt(sales.count)} vendas`}
            >
              <span
                className={clsx(
                  'w-3.5 h-3.5 rounded border flex items-center justify-center transition-all',
                  selected
                    ? 'bg-cyan-500 border-cyan-500 text-black'
                    : 'border-[#2a3445]'
                )}
              >
                {selected && <Check size={10} strokeWidth={3} />}
              </span>
              <span className="truncate max-w-[180px]">{q.title}</span>
              <span className="text-[10px] text-gray-500 tabular-nums">{fmt(sess.total)}</span>
              {sales.count > 0 && (
                <span className="text-[10px] text-emerald-400 tabular-nums font-semibold">·{fmt(sales.count)}🛒</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Agregado da seleção (ou de todos quando vazio) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-3 border-t border-[#1F2937] text-xs">
        <AggStat label="Sessões únicas" value={fmt(totals.sessions)} />
        <AggStat label="Leads (completaram)" value={fmt(totals.leads)} accent="text-cyan-400" />
        <AggStat label="Cliques no checkout" value={fmt(totals.checkoutClicks)} accent="text-amber-400" />
        <AggStat label="Vendas (SCK)" value={fmt(totals.sales)} accent="text-emerald-400" />
        <AggStat label="Receita" value={totals.revenue > 0 ? fmtBRL(totals.revenue) : '—'} accent="text-emerald-400" />
        <AggStat
          label="Conversão (vendas/sessões)"
          value={totals.sessions > 0 ? fmtPct(aggConv) : '—'}
          accent={aggConv >= 5 ? 'text-emerald-400' : aggConv >= 1 ? 'text-cyan-400' : 'text-gray-400'}
        />
      </div>
    </div>
  )
}

function AggStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      <span className={clsx('text-sm font-semibold tabular-nums', accent ?? 'text-white')}>{value}</span>
    </div>
  )
}

// ─── QuizRow ────────────────────────────────────────────────────────────────

interface RowProps {
  quiz: SbQuiz
  sess: SessionsAgg
  sales: SalesAgg
  utms: UtmAgg
  funnel: FunnelStep[]
  checkoutClicks: number
  conversionRate: number
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onChanged: () => void
}

function QuizRow({ quiz, sess, sales, utms, funnel, checkoutClicks, conversionRate, expanded, onToggle, onEdit, onChanged }: RowProps) {
  const [actionMenu, setActionMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const url = `https://${QUIZ_BASE}/${quiz.slug}`

  function copyUrl() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <button
          onClick={onToggle}
          className="text-gray-500 hover:text-white transition-colors cursor-pointer"
          aria-label={expanded ? 'Recolher' : 'Expandir'}
        >
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-white truncate">{quiz.title}</h3>
            <span className={clsx('text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 font-medium', STATUS_COLOR[quiz.status])}>
              {STATUS_LABEL[quiz.status]}
            </span>
            <span className="text-xs text-gray-500 font-mono">/{quiz.slug}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <button
              onClick={copyUrl}
              className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-cyan-400 font-mono transition-colors cursor-pointer"
              title="Copiar URL"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {QUIZ_BASE}/{quiz.slug}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-cyan-400 transition-colors"
              title="Abrir em nova aba"
            >
              <ExternalLink size={11} />
            </a>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-6 shrink-0">
          <Stat icon={Users} label="Sessões" value={fmt(sess.total)} />
          <Stat icon={CheckCircle2} label="Leads" value={fmt(sess.completed)} accent="text-cyan-400" />
          <Stat icon={ShoppingCart} label="Cliques checkout" value={fmt(checkoutClicks)} accent="text-amber-400" />
          <Stat icon={ShoppingCart} label="Vendas" value={fmt(sales.count)} accent="text-emerald-400" />
          <Stat
            icon={TrendingDown}
            label="Conv. venda"
            value={sess.total > 0 ? fmtPct(conversionRate) : '—'}
            accent={conversionRate >= 5 ? 'text-emerald-400' : conversionRate >= 1 ? 'text-cyan-400' : 'text-gray-400'}
          />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-[#1F2937] transition-colors cursor-pointer"
            title="Editar"
          >
            <Pencil size={14} />
          </button>
          <StatusActions quiz={quiz} onChanged={onChanged} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#1F2937] bg-[#0B1220]/50 px-5 py-5 space-y-6">
          {/* Funnel — % de pessoas que chegaram em cada etapa relativo ao step 0 */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Funil por etapa</h4>
              <span className="text-[11px] text-gray-500">% relativo à entrada (Tela 0)</span>
            </div>
            {funnel.length === 0 ? (
              <p className="text-xs text-gray-500">Sem dados de funil ainda. A view <code className="text-gray-400">quiz_funnel_daily</code> atualiza a cada 15min.</p>
            ) : (
              <FunnelVisual funnel={funnel} salesCount={sales.count} checkoutClicks={checkoutClicks} />
            )}
          </div>

          {/* UTMs */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Tag size={13} className="text-cyan-400" />
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider">UTMs das sessões</h4>
            </div>
            <UtmPanels utms={utms} totalSessions={sess.total} />
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col items-end">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500">
        <Icon size={11} />
        {label}
      </div>
      <div className={clsx('text-sm font-semibold tabular-nums', accent ?? 'text-white')}>{value}</div>
    </div>
  )
}

// Friendly labels for known step IDs (col-q01) — fallback to raw id when unknown
const STEP_LABELS: Record<string, string> = {
  head:              'Tela 0 · Landing',
  q_perfil:          'Tela 1 · Pergunta — Perfil',
  q_sobra:           'Tela 2 · Pergunta — Quanto sobra',
  q_precifica:       'Tela 3 · Pergunta — Como precifica',
  q_medo:            'Tela 4 · Pergunta — Qual medo',
  slide_dado:        'Tela 5 · Dado chocante',
  slide_limpeza:     'Tela 6 · Conta da limpeza',
  slide_comparativo: 'Tela 7 · Comparativo',
  slide_casos:       'Tela 8 · 3 casos reais',
  slide_cliente:     'Tela 9 · Quem é Cliente',
  slide_entrega:     'Tela 10 · O que recebe',
  slide_qualifica:   'Tela 11 · Qualificação',
  oferta:            'Tela 12 · Oferta',
}

// 2ª porcentagem (em relação a quem iniciou o quiz) exibida abaixo da % principal.
function PctIni({ p }: { p: number | null }) {
  if (p === null) return null
  return <div className="text-[10px] text-gray-500 tabular-nums">{fmtPct(p)} do início</div>
}

function FunnelVisual({ funnel, salesCount, checkoutClicks }: { funnel: FunnelStep[]; salesCount: number; checkoutClicks: number }) {
  const entryViews = funnel[0]?.views ?? 0
  // "Iniciou o quiz" = 1º clique/resposta na 1ª tela (answers do step 0).
  // Cap em 100%: re-cliques/bots e o lag da view materializada podem deixar
  // answers > views — sem o cap, a % mente pra cima.
  const iniciou = funnel[0]?.answers ?? 0
  const startPct = entryViews > 0 ? Math.min(100, (iniciou / entryViews) * 100) : 0
  // 2ª base (dupla %): em relação a quem iniciou o quiz, não só a quem viu a 1ª página.
  const pctIniOf = (n: number): number | null => (iniciou > 0 ? Math.min(100, (n / iniciou) * 100) : null)
  const lastStep = funnel[funnel.length - 1]
  const lastViews = lastStep?.views ?? 0
  const offerViews = funnel.find(f => f.step_id === 'oferta')?.views ?? 0
  const totalReach = entryViews > 0 ? (lastViews / entryViews) * 100 : 0
  const offerReach = entryViews > 0 ? (offerViews / entryViews) * 100 : 0
  const checkoutReach = entryViews > 0 ? (checkoutClicks / entryViews) * 100 : 0

  return (
    <div className="space-y-3">
      {/* Resumo executivo do avanço pelas telas */}
      {entryViews > 0 && (
        <div className="bg-gradient-to-br from-cyan-500/10 via-[#0B1220] to-[#0B1220] border border-cyan-500/20 rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-cyan-400 mb-1">Entraram (Tela 0)</div>
              <div className="text-xl font-bold text-white tabular-nums">{fmt(entryViews)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-cyan-400 mb-1">% de Start</div>
              <div className={clsx('text-xl font-bold tabular-nums', startPct >= 60 ? 'text-emerald-400' : startPct >= 35 ? 'text-cyan-300' : 'text-amber-400')}>
                {fmtPct(startPct)}
              </div>
              <div className="text-[10px] text-gray-500 tabular-nums">{fmt(iniciou)} iniciaram</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-cyan-400 mb-1">Chegaram na oferta</div>
              <div className="text-xl font-bold text-cyan-300 tabular-nums">
                {fmt(offerViews)}
                <span className="text-xs font-normal text-cyan-500/70 ml-1.5">{fmtPct(offerReach)}</span>
              </div>
              <PctIni p={pctIniOf(offerViews)} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-cyan-400 mb-1">Chegaram na última tela</div>
              <div className="text-xl font-bold text-white tabular-nums">
                {fmt(lastViews)}
                <span className="text-xs font-normal text-gray-500 ml-1.5">{fmtPct(totalReach)}</span>
              </div>
              <PctIni p={pctIniOf(lastViews)} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">Clicaram no checkout</div>
              <div className="text-xl font-bold text-amber-300 tabular-nums">
                {fmt(checkoutClicks)}
                <span className="text-xs font-normal text-amber-500/70 ml-1.5">{fmtPct(checkoutReach)}</span>
              </div>
              <PctIni p={pctIniOf(checkoutClicks)} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-emerald-400 mb-1">Compraram (SCK)</div>
              <div className="text-xl font-bold text-emerald-300 tabular-nums">
                {fmt(salesCount)}
                <span className="text-xs font-normal text-emerald-500/70 ml-1.5">
                  {entryViews > 0 ? fmtPct((salesCount / entryViews) * 100) : '—'}
                </span>
              </div>
              <PctIni p={pctIniOf(salesCount)} />
            </div>
          </div>
          <p className="text-[10px] text-gray-500 mt-3">
            Cada métrica traz duas leituras: % de quem <span className="text-gray-400">viu a 1ª página</span> (ao lado do número) e % de quem <span className="text-gray-400">iniciou o quiz</span> (linha de baixo). Start = 1º clique ÷ viu a 1ª página.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
      {funnel.map((f, i) => {
        const reachPct = entryViews > 0 ? (f.views / entryViews) * 100 : 0
        const dropFromPrev = i > 0 && funnel[i - 1].views > 0
          ? ((funnel[i - 1].views - f.views) / funnel[i - 1].views) * 100
          : 0
        const label = STEP_LABELS[f.step_id] ?? f.step_id
        return (
          <div
            key={`${f.step_index}-${f.step_id}`}
            className="relative bg-[#111827] rounded-lg overflow-hidden border border-[#1F2937]"
          >
            {/* Barra de fundo proporcional ao % de pessoas que chegaram */}
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500/25 via-cyan-500/15 to-cyan-500/5 transition-all"
              style={{ width: `${reachPct}%` }}
            />
            <div className="relative z-10 grid grid-cols-12 gap-3 items-center px-3 py-2.5 text-xs">
              <div className="col-span-5 flex items-center gap-2 min-w-0">
                <span className="shrink-0 w-6 h-6 rounded-md bg-[#0B1220] border border-[#1F2937] text-[10px] font-mono text-gray-500 flex items-center justify-center">
                  {f.step_index}
                </span>
                <span className="truncate text-gray-200 font-medium">{label}</span>
              </div>
              <div className="col-span-2 text-right">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Pessoas</div>
                <div className="text-white tabular-nums font-semibold">{fmt(f.views)}</div>
              </div>
              <div className="col-span-2 text-right">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">% chegou</div>
                <div className={clsx('tabular-nums font-bold', reachPct >= 50 ? 'text-emerald-400' : reachPct >= 20 ? 'text-cyan-400' : 'text-amber-400')}>
                  {entryViews > 0 ? fmtPct(reachPct) : '—'}
                </div>
                <PctIni p={pctIniOf(f.views)} />
              </div>
              <div className="col-span-3 text-right">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Drop vs anterior</div>
                <div className={clsx('tabular-nums', i === 0 ? 'text-gray-400' : dropFromPrev > 30 ? 'text-rose-400 font-semibold' : dropFromPrev > 0 ? 'text-rose-300' : 'text-gray-500')}>
                  {i === 0 ? '—' : (dropFromPrev > 0 ? `−${fmtPct(dropFromPrev)}` : '0%')}
                </div>
              </div>
            </div>
          </div>
        )
      })}

      </div>

      {/* Linha extra: cliques no botão de checkout (evento checkout_click) */}
      {checkoutClicks > 0 && entryViews > 0 && (
        <div className="relative bg-amber-500/10 rounded-lg overflow-hidden border border-amber-500/30">
          <div
            className="absolute inset-y-0 left-0 bg-amber-500/20"
            style={{ width: `${Math.min(checkoutReach, 100)}%` }}
          />
          <div className="relative z-10 grid grid-cols-12 gap-3 items-center px-3 py-2.5 text-xs">
            <div className="col-span-5 flex items-center gap-2">
              <ShoppingCart size={14} className="text-amber-400" />
              <span className="text-amber-300 font-semibold uppercase tracking-wider text-[11px]">Clicaram no checkout</span>
            </div>
            <div className="col-span-2 text-right">
              <div className="text-[10px] uppercase tracking-wider text-amber-500/70">Cliques</div>
              <div className="text-amber-300 tabular-nums font-semibold">{fmt(checkoutClicks)}</div>
            </div>
            <div className="col-span-2 text-right">
              <div className="text-[10px] uppercase tracking-wider text-amber-500/70">% vs entrada</div>
              <div className="text-amber-300 tabular-nums font-bold">{fmtPct(checkoutReach)}</div>
            </div>
            <div className="col-span-3 text-right text-[10px] text-amber-500/60">
              clique no botão de oferta
            </div>
          </div>
        </div>
      )}

      {/* Linha extra: vendas atribuídas ao quiz (sck_slug) */}
      {salesCount > 0 && entryViews > 0 && (
        <div className="relative bg-emerald-500/10 rounded-lg overflow-hidden border border-emerald-500/30">
          <div
            className="absolute inset-y-0 left-0 bg-emerald-500/20"
            style={{ width: `${(salesCount / entryViews) * 100}%` }}
          />
          <div className="relative z-10 grid grid-cols-12 gap-3 items-center px-3 py-2.5 text-xs">
            <div className="col-span-5 flex items-center gap-2">
              <ShoppingCart size={14} className="text-emerald-400" />
              <span className="text-emerald-300 font-semibold uppercase tracking-wider text-[11px]">Venda confirmada (Hotmart · SCK)</span>
            </div>
            <div className="col-span-2 text-right">
              <div className="text-[10px] uppercase tracking-wider text-emerald-500/70">Compras</div>
              <div className="text-emerald-300 tabular-nums font-semibold">{fmt(salesCount)}</div>
            </div>
            <div className="col-span-2 text-right">
              <div className="text-[10px] uppercase tracking-wider text-emerald-500/70">% conv. final</div>
              <div className="text-emerald-300 tabular-nums font-bold">
                {fmtPct((salesCount / entryViews) * 100)}
              </div>
            </div>
            <div className="col-span-3 text-right text-[10px] text-emerald-500/60">
              vs entrada
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UtmPanels({ utms, totalSessions }: { utms: UtmAgg; totalSessions: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <UtmList title="utm_source" data={utms.source} totalSessions={totalSessions} />
      <UtmList title="utm_medium" data={utms.medium} totalSessions={totalSessions} />
      <UtmList title="utm_campaign" data={utms.campaign} totalSessions={totalSessions} />
      <UtmList title="utm_content" data={utms.content} totalSessions={totalSessions} />
    </div>
  )
}

function UtmList({ title, data, totalSessions }: { title: string; data: Record<string, number>; totalSessions: number }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (entries.length === 0) {
    return (
      <div className="bg-[#111827] border border-[#1F2937] rounded-lg p-3">
        <div className="text-[10px] font-mono text-gray-500 uppercase mb-2">{title}</div>
        <p className="text-xs text-gray-400 italic">Sem dados</p>
      </div>
    )
  }
  const max = entries[0][1]
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono text-cyan-400 uppercase">{title}</span>
        <span className="text-[10px] text-gray-400">top 8 de {Object.keys(data).length}</span>
      </div>
      <div className="space-y-1">
        {entries.map(([key, count]) => {
          const pct = totalSessions > 0 ? (count / totalSessions) * 100 : 0
          const widthPct = (count / max) * 100
          return (
            <div key={key} className="relative bg-[#0B1220] rounded px-2 py-1.5 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-cyan-500/10"
                style={{ width: `${widthPct}%` }}
              />
              <div className="relative z-10 flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-gray-300 font-mono" title={key}>{key}</span>
                <span className="shrink-0 tabular-nums text-gray-500">
                  <span className="text-white font-semibold">{fmt(count)}</span>
                  <span className="ml-1.5 text-gray-500">{fmtPct(pct)}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── StatusActions ──────────────────────────────────────────────────────────

function StatusActions({ quiz, onChanged }: { quiz: SbQuiz; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [pwdPrompt, setPwdPrompt] = useState<null | 'active' | 'paused' | 'archived' | 'delete'>(null)

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-[#1F2937] transition-colors cursor-pointer"
          title="Status"
        >
          <ChevronDown size={14} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-44 bg-[#0B1220] border border-[#1F2937] rounded-lg shadow-2xl py-1 z-20">
              {quiz.status !== 'active' && (
                <MenuItem icon={Play} label="Ativar" onClick={() => { setOpen(false); setPwdPrompt('active') }} />
              )}
              {quiz.status === 'active' && (
                <MenuItem icon={Pause} label="Pausar" onClick={() => { setOpen(false); setPwdPrompt('paused') }} />
              )}
              {quiz.status !== 'archived' && (
                <MenuItem icon={Archive} label="Arquivar" onClick={() => { setOpen(false); setPwdPrompt('archived') }} />
              )}
              {(quiz.status === 'draft' || quiz.status === 'archived') && (
                <MenuItem icon={Trash2} label="Excluir" danger onClick={() => { setOpen(false); setPwdPrompt('delete') }} />
              )}
            </div>
          </>
        )}
      </div>

      {pwdPrompt && (
        <PasswordPrompt
          title={
            pwdPrompt === 'delete'
              ? `Excluir quiz "${quiz.title}"`
              : pwdPrompt === 'active'
                ? `Ativar "${quiz.title}"`
                : pwdPrompt === 'paused'
                  ? `Pausar "${quiz.title}"`
                  : `Arquivar "${quiz.title}"`
          }
          confirmLabel={pwdPrompt === 'delete' ? 'Excluir' : 'Confirmar'}
          danger={pwdPrompt === 'delete'}
          onConfirm={async (pwd) => {
            try {
              if (pwdPrompt === 'delete') {
                const res = await fetch(`/api/quizzes/${quiz.slug}`, {
                  method: 'DELETE',
                  headers: { 'x-admin-password': pwd },
                })
                if (!res.ok) {
                  const j = await res.json().catch(() => ({}))
                  return j.error || 'Erro ao excluir.'
                }
              } else {
                const res = await fetch(`/api/quizzes/${quiz.slug}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
                  body: JSON.stringify({ status: pwdPrompt }),
                })
                if (!res.ok) {
                  const j = await res.json().catch(() => ({}))
                  return j.error || 'Erro ao atualizar status.'
                }
              }
              setPwdPrompt(null)
              onChanged()
              return null
            } catch {
              return 'Erro de rede.'
            }
          }}
          onCancel={() => setPwdPrompt(null)}
        />
      )}
    </>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors cursor-pointer',
        danger ? 'text-rose-400 hover:bg-rose-500/10' : 'text-gray-300 hover:bg-[#1F2937] hover:text-white'
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

// ─── PasswordPrompt ─────────────────────────────────────────────────────────

interface PasswordPromptProps {
  title: string
  confirmLabel: string
  danger?: boolean
  onConfirm: (pwd: string) => Promise<string | null>
  onCancel: () => void
}

function PasswordPrompt({ title, confirmLabel, danger, onConfirm, onCancel }: PasswordPromptProps) {
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function go() {
    if (!pwd || busy) return
    setBusy(true)
    setError('')
    const err = await onConfirm(pwd)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
        <p className="text-xs text-gray-500 mb-4">Digite a senha de admin para confirmar.</p>
        <input
          type="password"
          value={pwd}
          onChange={e => setPwd(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') go() }}
          placeholder="••••••••"
          autoFocus
          className="w-full bg-[#0B1220] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
        />
        {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={go}
            disabled={!pwd || busy}
            className={clsx(
              'px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer',
              !pwd || busy
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : danger
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-black'
            )}
          >
            {busy ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── QuizModal (create/edit) ─────────────────────────────────────────────────

const STARTER_CONFIG: SbQuizConfig = {
  steps: [
    { id: 'intro', type: 'text', title: 'Vamos começar?', body: 'Em ~1 minuto você descobre seu diagnóstico.' },
    {
      id: 'q1',
      type: 'single_choice',
      title: 'Sua primeira pergunta',
      options: [
        { id: 'a', label: 'Opção A' },
        { id: 'b', label: 'Opção B' },
      ],
    },
    { id: 'lead', type: 'form', title: 'Onde enviamos seu resultado?', fields: ['name', 'whatsapp', 'email'] },
  ],
}

function QuizModal({ mode, quiz, onClose, onSaved }: {
  mode: 'create' | 'edit'
  quiz?: SbQuiz
  onClose: () => void
  onSaved: () => void
}) {
  const [slug, setSlug] = useState(quiz?.slug ?? '')
  const [title, setTitle] = useState(quiz?.title ?? '')
  const [status, setStatus] = useState<SbQuiz['status']>(quiz?.status ?? 'draft')
  const [webhookUrl, setWebhookUrl] = useState(quiz?.webhook_url ?? '')
  const [configText, setConfigText] = useState(JSON.stringify(quiz?.config ?? STARTER_CONFIG, null, 2))
  const [adminPwd, setAdminPwd] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setError('')
    let parsedConfig: unknown
    try {
      parsedConfig = JSON.parse(configText)
    } catch {
      setError('JSON inválido em "config". Verifique vírgulas e chaves.')
      return
    }

    if (mode === 'create' && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) {
      setError('Slug inválido. Use kebab-case (a-z, 0-9, hífen), 2–64 chars.')
      return
    }
    if (!title.trim()) {
      setError('Título é obrigatório.')
      return
    }

    setSaving(true)
    try {
      const url = mode === 'create' ? '/api/quizzes' : `/api/quizzes/${quiz!.slug}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const body = mode === 'create'
        ? { slug, title, status, config: parsedConfig, webhook_url: webhookUrl || null }
        : { title, status, config: parsedConfig, webhook_url: webhookUrl || null }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPwd },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Erro ao salvar.')
        return
      }
      onSaved()
    } catch {
      setError('Erro de rede.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1F2937]">
          <h2 className="text-base font-semibold text-white">
            {mode === 'create' ? 'Novo quiz' : `Editar "${quiz?.title}"`}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors cursor-pointer text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {mode === 'create' && (
            <Field label="Slug" hint="URL: example.com/q/{slug} — kebab-case, sem acentos.">
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="diagnostico-piloto"
                className="w-full bg-[#0B1220] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
              />
            </Field>
          )}

          <Field label="Título">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Diagnóstico Piloto"
              className="w-full bg-[#0B1220] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
            />
          </Field>

          <Field label="Status">
            <div className="flex gap-2">
              {(['draft', 'active', 'paused', 'archived'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={clsx(
                    'flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer',
                    status === s
                      ? 'bg-cyan-500 text-black'
                      : 'bg-[#0B1220] border border-[#1F2937] text-gray-400 hover:text-white'
                  )}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Webhook URL (opcional)" hint="Disparado em cada lead capturado. Deixe vazio para desabilitar.">
            <input
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/..."
              className="w-full bg-[#0B1220] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
            />
          </Field>

          <Field label="Config (JSON)" hint="Estrutura: { steps: [{ id, type: 'text' | 'single_choice' | 'multi_choice' | 'form', ... }] }">
            <textarea
              value={configText}
              onChange={e => setConfigText(e.target.value)}
              rows={16}
              className="w-full bg-[#0B1220] border border-[#1F2937] rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 resize-y"
              spellCheck={false}
            />
          </Field>

          <Field label="Senha de admin">
            <input
              type="password"
              value={adminPwd}
              onChange={e => setAdminPwd(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && adminPwd && !saving) handleSave() }}
              placeholder="••••••••"
              className="w-full bg-[#0B1220] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
            />
          </Field>

          {error && (
            <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 text-xs text-rose-400">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !adminPwd}
            className={clsx(
              'w-full rounded-xl py-2.5 text-sm font-medium transition-all cursor-pointer',
              saving || !adminPwd
                ? 'bg-cyan-500/20 text-cyan-500/50 cursor-not-allowed'
                : 'bg-cyan-500 text-black hover:bg-cyan-400'
            )}
          >
            {saving ? 'Salvando...' : mode === 'create' ? 'Criar quiz' : 'Salvar alterações'}
          </button>

          {mode === 'edit' && quiz && (
            <p className="text-[11px] text-gray-400 text-center">
              Última atualização: {formatDateBR(quiz.updated_at)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}
