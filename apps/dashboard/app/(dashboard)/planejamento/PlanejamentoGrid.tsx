'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { clsx } from 'clsx'
import { Plus, X, Rocket, Target, Sparkles, Video, Copy, Archive, ArchiveRestore, MoreVertical, ChevronRight, PieChart } from 'lucide-react'
import { ACAO_TIPO_LABEL, ACAO_STATUS_LABEL, type AcaoTipo, type AcaoStatus, type SbAcaoVenda } from '@/lib/acoesVendas'
import { formatCurrencyCompact, formatNumber } from '@/lib/formatters'
import type { ResumoPlanoMap } from './page'

// Tipos disponíveis (lançamento gratuito ainda em breve).
const TIPOS_DISPONIVEIS: AcaoTipo[] = ['lancamento_pago', 'low_ticket', 'perpetuo_vsl']
const TIPO_ICON: Record<AcaoTipo, typeof Rocket> = {
  lancamento_pago: Rocket,
  lancamento_gratis: Sparkles,
  low_ticket: Target,
  perpetuo_vsl: Video,
}
// Gradiente determinístico da thumbnail por tipo.
const TIPO_GRADIENT: Record<AcaoTipo, string> = {
  lancamento_pago: 'from-cyan-500/30 via-indigo-500/20 to-slate-900',
  lancamento_gratis: 'from-emerald-500/30 via-teal-500/20 to-slate-900',
  low_ticket: 'from-amber-500/30 via-orange-500/20 to-slate-900',
  perpetuo_vsl: 'from-fuchsia-500/30 via-purple-500/20 to-slate-900',
}
const STATUS_BG: Record<AcaoStatus, string> = {
  rascunho: 'bg-slate-500/15 text-slate-300',
  planejando: 'bg-sky-500/15 text-sky-300',
  planejado: 'bg-indigo-500/15 text-indigo-300',
  acao_andamento: 'bg-cyan-500/15 text-cyan-300',
  acao_concluida: 'bg-emerald-500/15 text-emerald-300',
  arquivado: 'bg-zinc-700/40 text-zinc-400',
  ativo: 'bg-cyan-500/15 text-cyan-300',
  encerrado: 'bg-emerald-500/15 text-emerald-300',
}

export default function PlanejamentoGrid({ planejamentos, resumo }: { planejamentos: SbAcaoVenda[]; resumo: ResumoPlanoMap }) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [showArquivados, setShowArquivados] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const visiveis = planejamentos.filter((p) => (showArquivados ? true : !p.arquivada_em))
  const nArquivados = planejamentos.filter((p) => p.arquivada_em).length

  async function duplicar(id: string) {
    setBusy(id)
    try {
      const res = await fetch('/api/planejamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duplicarDe: id }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      router.refresh()
    } catch (e) { alert('Erro ao duplicar: ' + (e instanceof Error ? e.message : String(e))) } finally { setBusy(null) }
  }

  async function toggleArquivar(p: SbAcaoVenda) {
    setBusy(p.id)
    try {
      const res = await fetch(`/api/planejamento/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arquivada_em: p.arquivada_em ? null : new Date().toISOString() }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      router.refresh()
    } catch (e) { alert('Erro: ' + (e instanceof Error ? e.message : String(e))) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-500">{visiveis.length} {visiveis.length === 1 ? 'planejamento' : 'planejamentos'}</p>
          {nArquivados > 0 && (
            <button onClick={() => setShowArquivados((s) => !s)} className="text-[11px] text-gray-400 hover:text-cyan-300 transition-colors cursor-pointer">
              {showArquivados ? 'ocultar arquivados' : `mostrar arquivados (${nArquivados})`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/planejamento/centro"
            className="inline-flex items-center gap-2 rounded-lg border border-[#1F2937] hover:border-cyan-500/40 text-gray-200 px-4 py-2 text-sm font-medium transition-colors">
            <PieChart size={16} /> Centro de Planejamento
          </Link>
          <button onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 text-sm font-medium transition-colors cursor-pointer">
            {showForm ? <X size={16} /> : <Plus size={16} />} {showForm ? 'Fechar' : 'Criar planejamento'}
          </button>
        </div>
      </div>

      {showForm && <NovoPlanoForm onDone={(id) => { setShowForm(false); if (id) router.push(`/planejamento/${id}`); else router.refresh() }} />}

      {visiveis.length === 0 ? (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-10 text-center">
          <p className="text-sm text-gray-400">Nenhum planejamento ainda.</p>
          <p className="text-xs text-gray-400 mt-1">Clique em &quot;Criar planejamento&quot; para simular seu primeiro lançamento pago.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {visiveis.map((p) => {
            const r = resumo[p.id]
            const Icon = TIPO_ICON[p.tipo] ?? Rocket
            return (
              <div key={p.id} className={clsx('group relative bg-[#111827] border border-[#1F2937] rounded-2xl overflow-hidden hover:border-cyan-500/40 hover:shadow-lg hover:shadow-black/20 transition-all', p.arquivada_em && 'opacity-60')}>
                <CardMenu busy={busy === p.id} arquivado={!!p.arquivada_em} onDuplicar={() => duplicar(p.id)} onArquivar={() => toggleArquivar(p)} />
                <Link href={`/planejamento/${p.id}`} className="block">
                  {/* Thumbnail */}
                  <div className={clsx('relative h-28 bg-gradient-to-br flex items-center justify-center', TIPO_GRADIENT[p.tipo])}>
                    {p.thumbnail_url
                      ? <Thumb url={p.thumbnail_url} fallbackIcon={<Icon size={30} className="text-white/70" />} />
                      : <Icon size={30} className="text-white/70" />}
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-white truncate group-hover:text-cyan-300">{p.nome}</h3>
                        <p className="text-[11px] text-gray-500 mt-0.5">{ACAO_TIPO_LABEL[p.tipo]}{p.sigla ? ` · ${p.sigla}` : ''}</p>
                      </div>
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded shrink-0', STATUS_BG[p.status] ?? STATUS_BG.rascunho)}>{ACAO_STATUS_LABEL[p.status] ?? p.status}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      <Mini label="Investimento" value={formatCurrencyCompact(r?.investimento ?? 0)} />
                      <Mini label="Faturamento" value={formatCurrencyCompact(r?.faturamento ?? 0)} />
                      <Mini label="Lucro" value={formatCurrencyCompact(r?.lucro ?? 0)} accent={(r?.lucro ?? 0) >= 0 ? 'pos' : 'neg'} />
                    </div>
                    <div className="flex items-center justify-between mt-3 text-[11px] text-gray-500">
                      <span className="tabular-nums">ROAS {r?.roas ? `${formatNumber(r.roas, 2)}x` : '—'}{r?.melhorNome ? ` · ${r.melhorNome}` : ''}</span>
                      <span className="text-gray-400 group-hover:text-cyan-400 inline-flex items-center">abrir <ChevronRight size={13} /></span>
                    </div>
                  </div>
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Thumb({ url, fallbackIcon }: { url: string; fallbackIcon: React.ReactNode }) {
  const [erro, setErro] = useState(false)
  if (erro) return <>{fallbackIcon}</>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" onError={() => setErro(true)} />
}

function CardMenu({ busy, arquivado, onDuplicar, onArquivar }: { busy: boolean; arquivado: boolean; onDuplicar: () => void; onArquivar: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="absolute top-2 right-2 z-10">
      <button onClick={(e) => { e.preventDefault(); setOpen((o) => !o) }} disabled={busy}
        className="p-1.5 rounded-md bg-black/30 text-gray-300 hover:bg-black/50 hover:text-white transition-colors cursor-pointer backdrop-blur-sm" aria-label="Ações">
        <MoreVertical size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.preventDefault(); setOpen(false) }} />
          <div className="absolute right-0 mt-1 z-20 w-40 bg-[#0A0F1E] border border-[#1F2937] rounded-lg shadow-xl py-1">
            <button onClick={(e) => { e.preventDefault(); setOpen(false); onDuplicar() }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-[#111827] hover:text-white cursor-pointer">
              <Copy size={13} /> Duplicar
            </button>
            <button onClick={(e) => { e.preventDefault(); setOpen(false); onArquivar() }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-[#111827] hover:text-white cursor-pointer">
              {arquivado ? <><ArchiveRestore size={13} /> Desarquivar</> : <><Archive size={13} /> Arquivar</>}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: 'pos' | 'neg' }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={clsx('text-sm font-semibold tabular-nums', accent === 'pos' ? 'text-emerald-300' : accent === 'neg' ? 'text-rose-400' : 'text-white')}>{value}</div>
    </div>
  )
}

function NovoPlanoForm({ onDone }: { onDone: (id?: string) => void }) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<AcaoTipo>('lancamento_pago')
  const [sigla, setSigla] = useState('')
  const [perpetuo, setPerpetuo] = useState(false)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [saving, setSaving] = useState(false)

  const siglaValida = sigla === '' || /^[A-Z0-9]{3,}$/.test(sigla)

  async function salvar() {
    if (!nome.trim()) { alert('Dê um nome ao planejamento'); return }
    if (!siglaValida) { alert('Sigla inválida: use ≥3 caracteres (A-Z, 0-9), sem espaços.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/planejamento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), tipo, sigla: sigla.trim() || null, perpetuo, data_inicio: dataInicio || null, data_fim: perpetuo ? null : dataFim || null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      const nova = await res.json()
      onDone(nova?.id)
    } catch (e) { alert('Erro ao criar: ' + (e instanceof Error ? e.message : String(e))) } finally { setSaving(false) }
  }

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-2xl p-6 space-y-5">
      {/* Tipo de ação */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Tipo de ação de venda</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(Object.keys(ACAO_TIPO_LABEL) as AcaoTipo[]).map((t) => {
            const Icon = TIPO_ICON[t]
            const disponivel = TIPOS_DISPONIVEIS.includes(t)
            return (
              <button key={t} disabled={!disponivel} onClick={() => setTipo(t)}
                className={clsx('flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-center transition-colors',
                  !disponivel ? 'border-[#1F2937] opacity-40 cursor-not-allowed' : tipo === t ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-200 cursor-pointer' : 'border-[#1F2937] text-gray-400 hover:text-white cursor-pointer')}>
                <Icon size={18} />
                <span className="text-[11px] leading-tight">{ACAO_TIPO_LABEL[t]}</span>
                {!disponivel && <span className="text-[9px] text-gray-500">em breve</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Nome do planejamento</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Lançamento Pago — Turma de Junho"
            className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Sigla (opcional — casa o investimento real do Meta)</span>
          <input value={sigla} onChange={(e) => setSigla(e.target.value.toUpperCase())} placeholder="Ex: LANC2406"
            className={clsx('bg-[#0A0F1E] border rounded-lg px-3 py-2 text-sm text-gray-200 tabular-nums focus:outline-none', siglaValida ? 'border-[#1F2937] focus:border-cyan-500/60' : 'border-rose-500/60')} />
          {!siglaValida && <span className="text-[10px] text-rose-400">≥3 caracteres, só A-Z e 0-9, sem espaço.</span>}
          {siglaValida && sigla && <span className="text-[10px] text-gray-500">Coloque esta sigla no nome da campanha/conjunto/anúncio no Meta.</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Início (opcional)</span>
          <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
            className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Fim {perpetuo ? '(não se aplica — perpétuo)' : '(opcional)'}</span>
          <input type="date" value={dataFim} disabled={perpetuo} onChange={(e) => setDataFim(e.target.value)}
            className={clsx('bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60', perpetuo && 'opacity-40 cursor-not-allowed')} />
        </label>
      </div>
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={perpetuo} onChange={(e) => setPerpetuo(e.target.checked)} className="accent-cyan-500" />
        <span className="text-xs text-gray-300">Perpétuo (sem data de fim — agrega vendas continuamente)</span>
      </label>

      <div className="flex justify-end">
        <button onClick={salvar} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black px-4 py-2 text-sm font-medium transition-colors cursor-pointer">
          {saving ? 'Criando…' : 'Criar e abrir planejador'}
        </button>
      </div>
    </div>
  )
}
