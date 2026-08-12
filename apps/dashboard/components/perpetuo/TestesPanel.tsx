'use client'

import Link from 'next/link'
import { X, FlaskConical, ExternalLink, Trophy } from 'lucide-react'
import type { SbExperiment } from '@/lib/supabase'

const STATUS: Record<SbExperiment['status'], { label: string; cls: string }> = {
  active: { label: 'Rodando', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  paused: { label: 'Pausado', cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
  draft: { label: 'Rascunho', cls: 'bg-white/5 text-white/50 border-white/10' },
  ended: { label: 'Encerrado', cls: 'bg-white/5 text-white/40 border-white/10' },
}
const TIPO: Record<SbExperiment['type'], string> = { page: 'Página', checkout: 'Checkout', ob: 'Order bump' }
const fmtDia = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')

/** Painel "Testes" do Perpétuo — lista compacta dos experimentos A/B do workspace.
 *  Números finos (passagem/lift/vencedor) ficam na aba /experimentos (link). */
export default function TestesPanel({ experimentos, onClose }: { experimentos: SbExperiment[]; onClose: () => void }) {
  const ordenados = [...experimentos].sort((a, b) => {
    const rank = (s: SbExperiment['status']) => (s === 'active' ? 0 : s === 'paused' ? 1 : s === 'draft' ? 2 : 3)
    return rank(a.status) - rank(b.status)
  })

  return (
    <div className="absolute top-16 right-3 bottom-3 z-20 w-full max-w-md flex flex-col rounded-xl border border-white/10 bg-[#0f1420]/95 backdrop-blur shadow-2xl">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <FlaskConical size={15} className="text-purple-300" /> Testes A/B
          <span className="text-white/40 font-normal">({experimentos.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/experimentos" className="inline-flex items-center gap-1 text-[11px] text-purple-300 hover:text-purple-200 px-2 py-1 rounded-md hover:bg-white/5">
            Detalhes <ExternalLink size={12} />
          </Link>
          <button onClick={onClose} title="Fechar" className="p-1 rounded text-white/50 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {ordenados.length === 0 ? (
          <p className="text-white/45 text-sm py-10 text-center">Nenhum experimento A/B configurado.</p>
        ) : (
          ordenados.map((e) => {
            const st = STATUS[e.status]
            return (
              <div key={e.id} className="rounded-lg border border-white/10 bg-[#111827] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] text-white/90 font-medium leading-tight">{e.name}</p>
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${st.cls}`}>{st.label}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-white/45">
                  <span className="px-1.5 py-0.5 rounded bg-white/5">{TIPO[e.type]}</span>
                  <span>{e.variants?.length ?? 0} variantes</span>
                  <span>·</span>
                  <span>desde {fmtDia(e.started_at)}</span>
                  {e.champion_variant && (
                    <span className="inline-flex items-center gap-1 text-amber-300">
                      <Trophy size={11} /> {e.champion_variant}
                    </span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
