'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X, ExternalLink } from 'lucide-react'
import DataTable from '@/components/tables/DataTable'
import { formatCurrency, formatPercent } from '@/lib/formatters'
import type { CriativoAgregado } from '@/types'

type Row = CriativoAgregado & Record<string, unknown>
type TabKey = 'campanhas' | 'conjuntos' | 'anuncios' | 'criativos'

const brl = (v: unknown) => formatCurrency(Number(v) || 0)
const pct = (v: unknown) => formatPercent(Number(v) || 0)
const roasFmt = (v: unknown) => `${(Number(v) || 0).toFixed(2)}x`

// Colunas fixas (Gasto · Vendas · Faturamento · Lucro · ROAS · CPA · CTR · CPM · Ticket).
const COLUMNS = [
  { key: 'criativo' as const, label: 'Nome', align: 'left' as const, sortable: true, width: 260,
    render: (v: unknown) => <span className="text-white/90 truncate block" title={String(v ?? '')}>{String(v ?? '—')}</span> },
  { key: 'investimento' as const, label: 'Gasto', align: 'right' as const, sortable: true, render: brl },
  { key: 'vendas' as const, label: 'Vendas', align: 'right' as const, sortable: true, render: (v: unknown) => String(Math.round(Number(v) || 0)) },
  { key: 'faturamento' as const, label: 'Faturamento', align: 'right' as const, sortable: true, render: brl },
  { key: 'lucro' as const, label: 'Lucro', align: 'right' as const, sortable: true,
    render: (v: unknown) => { const n = Number(v) || 0; return <span className={n >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{brl(n)}</span> } },
  { key: 'roas' as const, label: 'ROAS', align: 'right' as const, sortable: true, render: roasFmt },
  { key: 'cpa' as const, label: 'CPA', align: 'right' as const, sortable: true, render: brl },
  { key: 'ctr' as const, label: 'CTR', align: 'right' as const, sortable: true, render: pct },
  { key: 'cpm' as const, label: 'CPM', align: 'right' as const, sortable: true, render: brl },
  { key: 'ticketMedio' as const, label: 'Ticket', align: 'right' as const, sortable: true, render: brl },
]

const TABS: { key: TabKey; label: string }[] = [
  { key: 'campanhas', label: 'Campanhas' },
  { key: 'conjuntos', label: 'Conjuntos' },
  { key: 'anuncios', label: 'Anúncios' },
  { key: 'criativos', label: 'Criativos' },
]

export default function ExpandTable({
  campanhas,
  conjuntos,
  anuncios,
  funilSlug,
  onClose,
}: {
  campanhas: CriativoAgregado[]
  conjuntos: CriativoAgregado[]
  anuncios: CriativoAgregado[]
  funilSlug: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<TabKey>('campanhas')
  const data: Record<Exclude<TabKey, 'criativos'>, CriativoAgregado[]> = { campanhas, conjuntos, anuncios }
  const count = (k: TabKey) => (k === 'criativos' ? null : data[k].length)

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0f1e] flex flex-col">
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/10">
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const c = count(t.key)
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-md text-[13px] ${
                  tab === t.key ? 'bg-purple-500/20 text-purple-200 border border-purple-400/40' : 'text-white/55 hover:text-white border border-transparent'
                }`}
              >
                {t.label}{c != null && <span className="ml-1.5 text-white/35">{c}</span>}
              </button>
            )
          })}
        </div>
        <button onClick={onClose} title="Fechar (Esc)" className="p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/5">
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'criativos' ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-white/60 text-sm max-w-md">
              A análise completa de criativos (preview, transcrição, tags, chat) vive na aba dedicada.
            </p>
            <Link
              href={`/criativos-ia?funil=${encodeURIComponent(funilSlug)}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-500/20 border border-purple-400/40 text-purple-200 hover:bg-purple-500/30 text-sm"
            >
              <ExternalLink size={14} /> Abrir Análise de Criativos
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
            <DataTable
              columns={COLUMNS}
              data={data[tab] as unknown as Row[]}
              pageSize={30}
              rowKey={(_, i) => i}
              storageKey={`perpetuo-expand-${tab}`}
            />
          </div>
        )}
      </div>
    </div>
  )
}
