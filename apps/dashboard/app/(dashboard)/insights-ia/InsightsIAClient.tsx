'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Lightbulb, ListChecks, Sparkles, RefreshCw, FileText, Users, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import type { SbAiInsight, SbClarityDaily, AiInsightItem } from '@/lib/supabase'
import { SEMAFORO_CSS, SEMAFORO_BG, SEMAFORO_BORDER } from '@/lib/thresholds'
import { formatCurrency, formatNumber, formatPercent, formatRoas } from '@/lib/formatters'
import type { CreativeStats } from '@/lib/creativeAnalysis'
import type { CreativeCohort } from '@/lib/cohortAnalysis'
import CreativeQuadrantMatrix from '@/components/ai/CreativeQuadrantMatrix'

interface Props {
  from: string
  to: string
  insight: SbAiInsight | null
  metricas: SbClarityDaily[]
  creatives: CreativeStats[]
  cohorts: CreativeCohort[]
}

const SEVERIDADE_CSS: Record<NonNullable<AiInsightItem['severidade']>, string> = {
  alta: 'border-rose-500/40 bg-rose-500/5',
  media: 'border-amber-500/40 bg-amber-500/5',
  baixa: 'border-emerald-500/40 bg-emerald-500/5',
}

export default function InsightsIAClient({ from, to, insight, metricas, creatives, cohorts }: Props) {
  const router = useRouter()
  const [regenerating, setRegenerating] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)

  async function handleRegenerate() {
    setRegenerating(true)
    setRegenError(null)
    try {
      const res = await fetch('/api/ai/regenerate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      const json = await res.json()
      if (!res.ok) {
        setRegenError(json.error ?? 'Falha ao regenerar')
        return
      }
      router.refresh()
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Erro de rede')
    } finally {
      setRegenerating(false)
    }
  }

  const periodoHuman = formatRange(from, to)
  const dias = useMemo(() => diffDays(from, to), [from, to])
  const claritySessionsTotal = useMemo(() => {
    return metricas.filter((m) => m.recorte === 'total').reduce((s, r) => s + (r.sessions ?? 0), 0)
  }, [metricas])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="text-sm text-gray-400">
          Período: <span className="text-white font-medium">{periodoHuman}</span>
          <span className="text-gray-400"> · </span>
          {dias} {dias === 1 ? 'dia' : 'dias'}
          <span className="text-gray-400"> · </span>
          <Link href={`/clarity?de=${from}&ate=${to}`} className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1">
            Tabela Clarity completa <ExternalLink className="w-3 h-3" />
          </Link>
          {claritySessionsTotal > 0 && (
            <>
              <span className="text-gray-400"> · </span>
              {formatNumber(claritySessionsTotal)} sessions Clarity
            </>
          )}
        </div>
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            regenerating
              ? 'bg-[#1F2937] text-gray-500 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          )}
        >
          <RefreshCw className={clsx('w-4 h-4', regenerating && 'animate-spin')} />
          {regenerating ? 'Gerando análise…' : 'Regenerar análise do período'}
        </button>
        {regenError && <span className="text-rose-400 text-sm">{regenError}</span>}
      </div>

      {!insight ? (
        <EmptyState from={from} to={to} />
      ) : (
        <>
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
            <div className="flex items-start gap-3">
              <div className="bg-indigo-500/10 p-2 rounded-lg">
                <Sparkles className="w-5 h-5 text-indigo-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Resumo do período
                </h2>
                <p className="text-lg text-white leading-relaxed">{insight.tldr ?? '—'}</p>
                <p className="text-xs text-gray-500 mt-3">
                  Gerado em {formatDateTime(insight.gerado_at)} · {insight.modelo} · {insight.prompt_version} ·{' '}
                  {formatTokens(insight.tokens_input, insight.tokens_output)} tokens ·{' '}
                  <span className="capitalize">{insight.gerado_por}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InsightColumn
              title="Alertas"
              icon={<AlertTriangle className="w-4 h-4 text-rose-400" />}
              accent="text-rose-400"
              items={insight.alertas ?? []}
              emptyMsg="Nenhum alerta no período."
            />
            <InsightColumn
              title="Oportunidades"
              icon={<Lightbulb className="w-4 h-4 text-amber-400" />}
              accent="text-amber-400"
              items={insight.oportunidades ?? []}
              emptyMsg="Nenhuma oportunidade identificada."
            />
            <InsightColumn
              title="Recomendações"
              icon={<ListChecks className="w-4 h-4 text-emerald-400" />}
              accent="text-emerald-400"
              items={insight.recomendacoes ?? []}
              emptyMsg="Sem recomendações."
            />
          </div>
        </>
      )}

      <CreativeQuadrantMatrix creatives={creatives} />

      <CreativeHealthTable creatives={creatives} />

      <CohortPanel cohorts={cohorts} />
    </div>
  )
}

function InsightColumn({
  title,
  icon,
  accent,
  items,
  emptyMsg,
}: {
  title: string
  icon: React.ReactNode
  accent: string
  items: AiInsightItem[]
  emptyMsg: string
}) {
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className={clsx('text-sm font-semibold uppercase tracking-wider', accent)}>
          {title} {items.length > 0 && <span className="text-gray-500">({items.length})</span>}
        </h3>
      </div>
      {items.length === 0 ? (
        <p className="text-gray-500 text-sm">{emptyMsg}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li
              key={i}
              className={clsx(
                'border rounded-lg p-3 text-sm',
                item.severidade ? SEVERIDADE_CSS[item.severidade] : 'border-[#1F2937] bg-transparent'
              )}
            >
              <p className="font-semibold text-white mb-1">{item.titulo}</p>
              <p className="text-gray-300 leading-relaxed">{item.descricao}</p>
              {item.metrica && (
                <p className="text-xs text-gray-500 mt-2 font-mono">{item.metrica}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CreativeHealthTable({ creatives }: { creatives: CreativeStats[] }) {
  const sorted = useMemo(() => [...creatives].sort((a, b) => b.score - a.score), [creatives])
  if (!sorted.length) return null
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
      <h3 className="text-sm font-semibold text-white mb-1">Score de saúde por criativo</h3>
      <p className="text-xs text-gray-500 mb-4">Combinação ponderada de LPV + ROAS + Conv. página. Verde ≥ 70, amarelo ≥ 40.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase border-b border-[#1F2937]">
              <th className="py-2 pr-4">Criativo</th>
              <th className="py-2 pr-4 text-right">LPV</th>
              <th className="py-2 pr-4 text-right">Compras</th>
              <th className="py-2 pr-4 text-right">Receita</th>
              <th className="py-2 pr-4 text-right">ROAS Líq.</th>
              <th className="py-2 pr-4 text-right">CPA</th>
              <th className="py-2 pr-4 text-right">Conv. pág</th>
              <th className="py-2 pr-0 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 30).map((c) => (
              <tr key={c.key} className="border-b border-[#1F2937] hover:bg-[#131c2e]">
                <td className="py-2 pr-4 text-gray-300 max-w-[300px] truncate" title={c.criativo}>{c.criativo}</td>
                <td className="py-2 pr-4 text-right text-white tabular-nums">{formatNumber(c.landing_views)}</td>
                <td className="py-2 pr-4 text-right text-gray-300 tabular-nums">{c.compras}</td>
                <td className="py-2 pr-4 text-right text-gray-300 tabular-nums">{formatCurrency(c.receita)}</td>
                <td className="py-2 pr-4 text-right text-gray-300 tabular-nums">{formatRoas(c.roas)}</td>
                <td className="py-2 pr-4 text-right text-gray-300 tabular-nums">{c.cpa != null ? formatCurrency(c.cpa) : '—'}</td>
                <td className="py-2 pr-4 text-right text-gray-300 tabular-nums">{formatPercent(c.conv_pagina * 100, 2)}</td>
                <td className="py-2 pr-0 text-right">
                  <span
                    className={clsx(
                      'inline-block px-2 py-0.5 rounded-md tabular-nums font-medium border',
                      SEMAFORO_CSS[c.health],
                      SEMAFORO_BG[c.health],
                      SEMAFORO_BORDER[c.health]
                    )}
                  >
                    {c.score}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CohortPanel({ cohorts }: { cohorts: CreativeCohort[] }) {
  const top = useMemo(() => [...cohorts].sort((a, b) => b.n_compradores - a.n_compradores).slice(0, 6), [cohorts])
  if (!top.length) return null

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-4 h-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Cohort de compradores por criativo</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">Top 6 criativos por volume — perfil dos dentistas que compraram (cruzando com qualificação por e-mail).</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {top.map((c) => (
          <div key={c.criativo} className="border border-[#1F2937] rounded-lg p-4 text-sm">
            <p className="font-semibold text-white mb-2 truncate" title={c.criativo}>{c.criativo}</p>
            <p className="text-xs text-gray-500 mb-3">
              {c.n_compradores} compras · {c.n_fichas} fichas · ticket {formatCurrency(c.ticket_medio)}
            </p>
            <CohortLine label="Dores" values={c.top_dores} />
            <CohortLine label="Medos" values={c.top_medos} />
            <CohortLine label="Objetivos" values={c.top_objetivos} />
            <CohortLine label="Faturamento" values={c.top_faturamento} />
          </div>
        ))}
      </div>
    </div>
  )
}

function CohortLine({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null
  return (
    <div className="mb-1.5">
      <span className="text-xs text-gray-500">{label}: </span>
      <span className="text-xs text-gray-300">{values.join(' · ')}</span>
    </div>
  )
}

function EmptyState({ from, to }: { from: string; to: string }) {
  const same = from === to
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-12 text-center">
      <FileText className="w-10 h-10 text-gray-400 mx-auto mb-3" />
      <p className="text-gray-300 mb-1">
        Nenhuma análise IA para {same ? from : `${from} → ${to}`} ainda.
      </p>
      <p className="text-gray-500 text-sm">
        Clique em "Regenerar análise do período" pra gerar agora.
      </p>
    </div>
  )
}

function formatRange(from: string, to: string): string {
  if (from === to) return formatDate(from)
  return `${formatDate(from)} → ${formatDate(to)}`
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

function diffDays(from: string, to: string): number {
  const [yf, mf, df] = from.split('-').map(Number)
  const [yt, mt, dt] = to.split('-').map(Number)
  const a = Date.UTC(yf, mf - 1, df)
  const b = Date.UTC(yt, mt - 1, dt)
  return Math.round((b - a) / 86400000) + 1
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatTokens(input: number | null, output: number | null): string {
  const total = (input ?? 0) + (output ?? 0)
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`
  return String(total)
}
