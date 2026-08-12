'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import type { SbAiInsight, SbClarityDaily, ClarityRecorte } from '@/lib/supabase'
import { ClarityTable, aggregateClarityRows } from '@/components/clarity/ClarityTable'

interface Props {
  from: string
  to: string
  insight: SbAiInsight | null
  metricas: SbClarityDaily[]
  /**
   * Mensagem de erro quando a busca de `metricas` falhou (erro de banco/rede) —
   * distinto de `metricas` vir vazia por realmente não haver dados no período.
   * Hoje `fetchClarityDailyRange` (lib/supabase.ts) engole o erro e devolve `[]`
   * em qualquer um dos dois casos, então quem chamar este componente ainda
   * precisa plugar essa prop (fora do escopo deste componente) pra o aviso
   * abaixo realmente aparecer — o componente já está pronto pro sinal.
   */
  metricasError?: string | null
}

const RECORTE_TABS: Array<{ key: ClarityRecorte; label: string }> = [
  { key: 'url', label: 'Por URL' },
  { key: 'device', label: 'Por Device' },
  { key: 'source', label: 'Por Source' },
  { key: 'total', label: 'Total' },
]

export default function ClarityClient({ from, to, insight, metricas, metricasError = null }: Props) {
  const [tab, setTab] = useState<ClarityRecorte>('url')

  const rowsByTab = useMemo(() => {
    const filtered = metricas.filter((m) => m.recorte === tab)
    return aggregateClarityRows(filtered)
  }, [metricas, tab])

  const diasComDados = useMemo(() => {
    return new Set(metricas.map((m) => m.data)).size
  }, [metricas])

  const periodoHuman = formatRange(from, to)
  const insightsUrl = `/insights-ia?de=${from}&ate=${to}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-gray-400">
          Período: <span className="text-white font-medium">{periodoHuman}</span>
          <span className="text-gray-400"> · </span>
          {diasComDados} {diasComDados === 1 ? 'dia' : 'dias'} com dados
        </p>
        <a
          href="https://clarity.microsoft.com"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-gray-400 hover:text-indigo-400 inline-flex items-center gap-1"
        >
          Heatmaps e recordings no painel Clarity
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
        <div className="flex gap-2 border-b border-[#1F2937] mb-4">
          {RECORTE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'px-3 py-2 text-sm transition-colors border-b-2',
                tab === t.key
                  ? 'text-indigo-400 border-indigo-500'
                  : 'text-gray-500 hover:text-gray-300 border-transparent'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {metricasError ? (
          <div className="py-8 text-center space-y-1">
            <p className="text-rose-400 text-sm font-medium">Erro ao carregar dados do Clarity</p>
            <p className="text-gray-500 text-xs">{metricasError}</p>
          </div>
        ) : rowsByTab.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">
            Sem dados Clarity para esse recorte em {periodoHuman}.
          </p>
        ) : (
          <ClarityTable rows={rowsByTab} recorte={tab} />
        )}
      </div>

      {insight ? (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="bg-indigo-500/10 p-2 rounded-lg shrink-0">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Resumo do período
              </p>
              <p className="text-sm text-gray-200 leading-relaxed">{insight.tldr ?? '—'}</p>
              <Link
                href={insightsUrl}
                className="inline-flex items-center gap-1 mt-3 text-xs text-indigo-400 hover:text-indigo-300"
              >
                Ver análise completa →
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <p className="text-sm text-gray-400">
            Nenhuma análise IA para esse período ainda.{' '}
            <Link href={insightsUrl} className="text-indigo-400 hover:text-indigo-300">
              Gerar agora →
            </Link>
          </p>
        </div>
      )}
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
