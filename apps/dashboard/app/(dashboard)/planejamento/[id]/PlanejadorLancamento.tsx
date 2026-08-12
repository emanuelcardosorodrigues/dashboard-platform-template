'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { clsx } from 'clsx'
import {
  ArrowLeft, LayoutDashboard, SlidersHorizontal, Layers, Target as TargetIcon, BarChart3, GitCompare,
  Plus, Trash2, Check, Cloud, CloudOff, Loader2, Star, Printer, Scale, AlertTriangle, TrendingUp, TrendingDown,
  StickyNote, Lightbulb, FileSpreadsheet,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, CartesianGrid,
} from 'recharts'
import { exportPlanejamentoXlsx } from '@/lib/exportPlanejamentoXlsx'
import { computeCenario, normalizeEstado } from '@/lib/simulador'
import { computeReverso } from '@/lib/planejamentoReverso'
import { ACAO_STATUS_FLOW, ACAO_STATUS_LABEL, type AcaoStatus, type SbAcaoCenario, type SbAcaoNota, type SbAcaoVenda, type SimuladorState, type ImpostoConfig, type CenarioDerivado } from '@/lib/acoesVendas'
import { calcLucroBrutoPlano, buildComparacao, snapshotPrevisto, COMPARACAO_METRICAS, type CenarioReal } from '@/lib/planejamento'
import { formatCurrency, formatCurrencyCompact, formatNumber, formatRoas } from '@/lib/formatters'
import { SEMAFORO_CSS } from '@/lib/thresholds'
import { useAutoSave } from '@/lib/useAutoSave'

type Tab = 'dashboard' | 'plano' | 'lotes' | 'metas' | 'graficos' | 'cenarios' | 'comparacao' | 'notas'
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'plano', label: 'Plano', icon: SlidersHorizontal },
  { key: 'lotes', label: 'Lotes', icon: Layers },
  { key: 'metas', label: 'Metas', icon: TargetIcon },
  { key: 'graficos', label: 'Gráficos', icon: BarChart3 },
  { key: 'cenarios', label: 'Cenários', icon: GitCompare },
  { key: 'comparacao', label: 'Previsto × Realizado', icon: Scale },
  { key: 'notas', label: 'Notas', icon: StickyNote },
]
const CHART_COLORS = ['#64748B', '#10B981', '#F59E0B', '#06B6D4', '#A855F7', '#EC4899', '#84CC16']
const SEMAFORO_LABEL: Record<'green' | 'yellow' | 'red', string> = { green: 'bom', yellow: 'atenção', red: 'ruim' }

export default function PlanejadorLancamento({ acao, cenariosIniciais, notasIniciais, impostos, real, horizonte }: {
  acao: SbAcaoVenda; cenariosIniciais: SbAcaoCenario[]; notasIniciais: SbAcaoNota[]; impostos: ImpostoConfig
  real: CenarioReal; horizonte: { diasDecorridos: number; diasTotais: number }
}) {
  const router = useRouter()
  const { status, pendingCount, schedule } = useAutoSave()
  const [tab, setTab] = useState<Tab>('plano')
  const [statusAcao, setStatusAcao] = useState<AcaoStatus>(acao.status)
  const [checklist, setChecklist] = useState<Record<string, boolean>>(acao.comparacao_kpis ?? {})
  const [notas, setNotas] = useState<SbAcaoNota[]>(notasIniciais)

  // Cenários normalizados em estado local (fonte de verdade da UI). Auto-save por cenário.
  const [cenarios, setCenarios] = useState<SbAcaoCenario[]>(
    () => [...cenariosIniciais].sort((a, b) => a.ordem - b.ordem).map((c) => ({ ...c, estado: normalizeEstado(c.estado) })),
  )
  const updatedAt = useRef<Record<string, string>>(Object.fromEntries(cenariosIniciais.map((c) => [c.id, c.updated_at])))
  const base = cenarios.find((c) => c.ordem === 0) ?? cenarios[0]

  const derivados = useMemo(() => new Map(cenarios.map((c) => [c.id, computeCenario(c.estado)])), [cenarios])
  const lucros = useMemo(() => new Map(cenarios.map((c) => {
    const d = derivados.get(c.id)!
    return [c.id, calcLucroBrutoPlano(d.faturamentoTotal, c.estado.verbaTotal, d.totalIngressos, impostos)]
  })), [cenarios, derivados, impostos])
  const melhorId = useMemo(() => {
    let best: { id: string; roas: number } | null = null
    for (const c of cenarios) { const r = derivados.get(c.id)!.roas; if (r > 0 && (!best || r > best.roas)) best = { id: c.id, roas: r } }
    return best?.id ?? null
  }, [cenarios, derivados])

  // ── Persistência de um cenário (auto-save com concorrência otimista) ──
  function persistCenario(cid: string, estado: SimuladorState, nome?: string) {
    schedule(cid, async () => {
      const res = await fetch(`/api/planejamento/${acao.id}/cenarios/${cid}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado, nome, updated_at: updatedAt.current[cid] }),
      })
      if (res.status === 409) { router.refresh(); throw new Error('conflito') }
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      const j = await res.json()
      if (j?.cenario?.updated_at) updatedAt.current[cid] = j.cenario.updated_at
    })
  }

  // Edita inputs COMPARTILHADOS (tudo menos variação) → espelha em todos os cenários (modelo LaunchSim).
  // Schedule fora do updater do setState (evita setState durante render).
  function updateShared(fn: (s: SimuladorState) => SimuladorState) {
    const next = cenarios.map((c) => ({ ...c, estado: { ...fn(c.estado), variacao: c.estado.variacao } }))
    setCenarios(next)
    for (const c of next) persistCenario(c.id, c.estado)
  }
  // Edita a variação de UM cenário.
  function updateVariacao(cid: string, variacao: SimuladorState['variacao']) {
    const next = cenarios.map((c) => (c.id === cid ? { ...c, estado: { ...c.estado, variacao } } : c))
    setCenarios(next)
    const alvo = next.find((c) => c.id === cid)
    if (alvo) persistCenario(cid, alvo.estado)
  }

  // Acumula patches da ação (mescla sob a chave 'acao' p/ não perder campos entre debounces).
  const acaoPatch = useRef<Record<string, unknown>>({})
  function updateAcao(patch: Record<string, unknown>) {
    acaoPatch.current = { ...acaoPatch.current, ...patch }
    schedule('acao', async () => {
      const body = acaoPatch.current
      acaoPatch.current = {}
      if (Object.keys(body).length === 0) return
      const res = await fetch(`/api/planejamento/${acao.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
    })
  }

  function toggleChecklist(key: string) {
    const next = { ...checklist, [key]: checklist[key] === false ? true : false }
    setChecklist(next)
    updateAcao({ comparacao_kpis: next })
  }

  // ── Notas ──
  async function addNota(corpo: string) {
    const res = await fetch(`/api/planejamento/${acao.id}/notas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corpo }) })
    if (!res.ok) { alert('Erro ao criar nota'); return }
    const nova = (await res.json()) as SbAcaoNota
    setNotas((prev) => [nova, ...prev])
  }
  function editNota(nid: string, corpo: string) {
    setNotas((prev) => prev.map((n) => (n.id === nid ? { ...n, corpo } : n)))
    schedule(`nota:${nid}`, async () => {
      const res = await fetch(`/api/planejamento/${acao.id}/notas/${nid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corpo }) })
      if (!res.ok) throw new Error('falha ao salvar nota')
    })
  }
  async function delNota(nid: string) {
    if (!confirm('Remover esta nota?')) return
    const anterior = notas
    setNotas((prev) => prev.filter((n) => n.id !== nid))
    const res = await fetch(`/api/planejamento/${acao.id}/notas/${nid}`, { method: 'DELETE' })
    if (!res.ok) {
      setNotas(anterior)
      alert('Erro ao remover nota: ' + ((await res.json().catch(() => ({})))?.error || res.status))
    }
  }

  async function addCenario() {
    const res = await fetch(`/api/planejamento/${acao.id}/cenarios`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!res.ok) { alert('Erro ao adicionar cenário: ' + ((await res.json().catch(() => ({})))?.error || res.status)); return }
    const novo = (await res.json()) as SbAcaoCenario
    updatedAt.current[novo.id] = novo.updated_at
    setCenarios((prev) => [...prev, { ...novo, estado: normalizeEstado(novo.estado) }])
  }
  async function removeCenario(cid: string) {
    if (!confirm('Remover este cenário?')) return
    const res = await fetch(`/api/planejamento/${acao.id}/cenarios/${cid}`, { method: 'DELETE' })
    if (!res.ok) { alert('Erro: ' + ((await res.json().catch(() => ({})))?.error || res.status)); return }
    setCenarios((prev) => prev.filter((c) => c.id !== cid))
  }

  function handleExport() {
    try {
      exportPlanejamentoXlsx(acao.nome, cenarios.map((c) => ({ nome: c.nome, estado: c.estado as unknown as Record<string, unknown>, derivado: derivados.get(c.id)!, lucro: lucros.get(c.id)!.lucroBruto, investimento: c.estado.verbaTotal })))
    } catch (err) {
      alert('Erro ao exportar planilha: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-[#1F2937] px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/planejamento" aria-label="Voltar para o planejamento" className="text-gray-400 hover:text-white transition-colors"><ArrowLeft size={18} /></Link>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-white truncate">{acao.nome}</h1>
            <p className="text-[11px] text-gray-500">{acao.sigla ? `${acao.sigla} · ` : ''}{acao.data_inicio || '—'} → {acao.data_fim || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator status={status} pendingCount={pendingCount} />
          <select value={statusAcao} onChange={(e) => { const v = e.target.value as AcaoStatus; setStatusAcao(v); updateAcao({ status: v }) }}
            aria-label="Status da ação"
            className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-cyan-500/60 cursor-pointer">
            {ACAO_STATUS_FLOW.map((s) => <option key={s} value={s}>{ACAO_STATUS_LABEL[s]}</option>)}
          </select>
          <button onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1F2937] hover:border-emerald-500/40 text-gray-300 px-3 py-1.5 text-xs transition-colors cursor-pointer">
            <FileSpreadsheet size={14} /> Exportar planilha
          </button>
          <Link href={`/planejamento-print/${acao.id}`} target="_blank"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1F2937] hover:border-cyan-500/40 text-gray-300 px-3 py-1.5 text-xs transition-colors">
            <Printer size={14} /> PDF
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#1F2937] px-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx('inline-flex items-center gap-1.5 px-3 py-2.5 text-xs border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer',
              tab === t.key ? 'border-cyan-500 text-cyan-300' : 'border-transparent text-gray-400 hover:text-white')}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {tab === 'dashboard' && <DashboardTab cenarios={cenarios} derivados={derivados} lucros={lucros} melhorId={melhorId} />}
        {tab === 'plano' && base && <PlanoTab base={base} cenarios={cenarios} derivados={derivados} onShared={updateShared} onVariacao={updateVariacao} acao={acao} onAcao={updateAcao} onAddCenario={addCenario} onRemoveCenario={removeCenario} impostos={impostos} />}
        {tab === 'lotes' && base && <LotesTab base={base} cenarios={cenarios} derivados={derivados} onShared={updateShared} />}
        {tab === 'metas' && base && <MetasTab base={base} cenarios={cenarios} derivados={derivados} onShared={updateShared} />}
        {tab === 'graficos' && <GraficosTab cenarios={cenarios} derivados={derivados} />}
        {tab === 'cenarios' && <CenariosTab cenarios={cenarios} derivados={derivados} lucros={lucros} melhorId={melhorId} real={real} onAdd={addCenario} onRemove={removeCenario} />}
        {tab === 'comparacao' && base && (
          <ComparacaoTab base={base} derivados={derivados} impostos={impostos} real={real} horizonte={horizonte} checklist={checklist} onToggle={toggleChecklist} onRefresh={() => router.refresh()} />
        )}
        {tab === 'notas' && (
          <NotasTab notas={notas} status={statusAcao} onAdd={addNota} onEdit={editNota} onDel={delNota} />
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────── Save indicator ───────────────────────
function SaveIndicator({ status, pendingCount }: { status: string; pendingCount: number }) {
  if (status === 'saving') return <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-300"><Loader2 size={13} className="animate-spin" /> salvando{pendingCount > 1 ? ` (${pendingCount})` : ''}…</span>
  if (status === 'error') return <span className="inline-flex items-center gap-1.5 text-[11px] text-rose-400"><CloudOff size={13} /> erro ao salvar</span>
  if (status === 'saved') return <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400"><Check size={13} /> salvo</span>
  return <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500"><Cloud size={13} /> sincronizado</span>
}

// ─────────────────────────────────────── Campos ───────────────────────────────
function NumField({ label, value, onChange, prefix, suffix, step }: { label: string; value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; step?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-gray-500">{label}</span>
      <div className="flex items-center bg-[#0A0F1E] border border-[#1F2937] rounded-lg focus-within:border-cyan-500/60 overflow-hidden">
        {prefix && <span className="pl-2.5 text-xs text-gray-500">{prefix}</span>}
        <input type="number" step={step ?? 'any'} value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="w-full bg-transparent px-2.5 py-2 text-sm text-gray-200 tabular-nums focus:outline-none" />
        {suffix && <span className="pr-2.5 text-xs text-gray-500">{suffix}</span>}
      </div>
    </label>
  )
}
function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (s: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-gray-500">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" />
    </label>
  )
}
function Card({ title, desc, children, action }: { title: string; desc?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-2xl p-6 md:p-7 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-[15px] font-semibold text-white tracking-tight">{title}</h3>{desc && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{desc}</p>}</div>
        {action}
      </div>
      {children}
    </div>
  )
}
function Stat({ label, value, accent, hint }: { label: string; value: string; accent?: string; hint?: string }) {
  return (
    <div className="bg-[#0A0F1E] border border-[#1F2937] rounded-xl px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={clsx('text-lg font-semibold tabular-nums mt-1', accent ?? 'text-white')}>{value}</div>
      {hint && <div className="text-[10px] text-gray-500 mt-1">{hint}</div>}
    </div>
  )
}
/**
 * Botão de exclusão com confirmação de DOIS CLIQUES on-theme (sem dialog nativo do browser).
 * 1º clique arma (ícone vira alerta por ~2,5s); 2º clique dentro da janela confirma a exclusão.
 * Some do estado "armado" ao perder o foco ou passar o tempo, sem disparar nada.
 */
function ConfirmTrashButton({ label, onConfirm, className }: { label: string; onConfirm: () => void; className?: string }) {
  const [armado, setArmado] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function limpar() { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  function onClick() {
    if (armado) { limpar(); setArmado(false); onConfirm(); return }
    setArmado(true)
    timer.current = setTimeout(() => setArmado(false), 2500)
  }
  return (
    <button type="button" onClick={onClick} onBlur={() => { limpar(); setArmado(false) }}
      aria-label={armado ? `Confirmar: ${label}` : label}
      title={armado ? 'Clique novamente para confirmar' : label}
      className={clsx('cursor-pointer transition-colors', armado ? 'text-rose-400' : 'text-gray-600 hover:text-rose-400', className)}>
      {armado ? <AlertTriangle size={14} /> : <Trash2 size={14} />}
    </button>
  )
}

/** Controle de variação de um parâmetro (igual à referência): direção (Reduzir/Aumentar/Manter) + magnitude %. */
function ParamVar({ label, melhor, value, onChange }: { label: string; melhor: 'reduzir' | 'aumentar'; value: number; onChange: (v: number) => void }) {
  const dir = value < 0 ? 'reduzir' : value > 0 ? 'aumentar' : 'manter'
  const mag = Math.abs(value)
  const aplica = (novaDir: string, novaMag: number) => onChange(novaDir === 'reduzir' ? -novaMag : novaDir === 'aumentar' ? novaMag : 0)
  const Icon = melhor === 'reduzir' ? TrendingDown : TrendingUp
  return (
    <div className="border border-[#1F2937] rounded-lg p-3 space-y-2 bg-[#111827]">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-300"><Icon size={13} className="text-gray-500" /> {label}</div>
      <select value={dir} onChange={(e) => aplica(e.target.value, mag)}
        className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-md px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-cyan-500/60 cursor-pointer">
        <option value="reduzir">↘ Reduzir{melhor === 'reduzir' ? ' (melhor)' : ''}</option>
        <option value="aumentar">↗ Aumentar{melhor === 'aumentar' ? ' (melhor)' : ''}</option>
        <option value="manter">Manter igual ao Base</option>
      </select>
      <div className="flex items-center bg-[#0A0F1E] border border-[#1F2937] rounded-md focus-within:border-cyan-500/60 overflow-hidden">
        <input type="number" value={dir === 'manter' ? 0 : mag} disabled={dir === 'manter'}
          onChange={(e) => aplica(dir, Number(e.target.value) || 0)}
          className={clsx('w-full bg-transparent px-2 py-1.5 text-sm text-gray-200 tabular-nums focus:outline-none', dir === 'manter' && 'opacity-40')} />
        <span className="pr-2 text-xs text-gray-500">%</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────── Plano ────────────────────────────────
// Cores dos cenários (badge), na ordem A, B, Extra 1..4 — igual à referência (A verde, B laranja).
const CENARIO_THEME = [
  { badge: 'bg-emerald-500 text-black', cpa: 'text-emerald-300' },   // ordem 1 (A)
  { badge: 'bg-amber-500 text-black', cpa: 'text-amber-300' },       // ordem 2 (B)
  { badge: 'bg-cyan-500 text-black', cpa: 'text-cyan-300' },         // extra 1
  { badge: 'bg-fuchsia-500 text-black', cpa: 'text-fuchsia-300' },   // extra 2
  { badge: 'bg-rose-500 text-black', cpa: 'text-rose-300' },         // extra 3
  { badge: 'bg-lime-500 text-black', cpa: 'text-lime-300' },         // extra 4
]
const VAR_PARAMS: { key: keyof SimuladorState['variacao']; label: string; melhor: 'reduzir' | 'aumentar' }[] = [
  { key: 'variacaoCpm', label: 'CPM', melhor: 'reduzir' },
  { key: 'variacaoCtr', label: 'CTR', melhor: 'aumentar' },
  { key: 'variacaoConnectRate', label: 'Connect Rate', melhor: 'aumentar' },
  { key: 'variacaoTxConversao', label: 'Tx. Conversão', melhor: 'aumentar' },
]
const MAX_CENARIOS_EXTRAS = 6 // A + B + até 4 extras

function PlanoTab({ base, cenarios, derivados, onShared, onVariacao, acao, onAcao, onAddCenario, onRemoveCenario, impostos }: {
  base: SbAcaoCenario; cenarios: SbAcaoCenario[]; derivados: Map<string, CenarioDerivado>
  onShared: (fn: (s: SimuladorState) => SimuladorState) => void; onVariacao: (cid: string, v: SimuladorState['variacao']) => void
  acao: SbAcaoVenda; onAcao: (patch: Record<string, unknown>) => void
  onAddCenario: () => void; onRemoveCenario: (cid: string) => void; impostos: ImpostoConfig
}) {
  const s = base.estado
  // Calculadora reversa (padrão) × Simulador forward — só muda a direção, mesmo cenário.
  const modo = s.modo ?? 'meta'
  const setModo = (m: 'meta' | 'simulador') => onShared((st) => ({ ...st, modo: m }))
  const dBase = derivados.get(base.id)!
  const [sigla, setSigla] = useState(acao.sigla ?? '')
  const [capa, setCapa] = useState(acao.thumbnail_url ?? '')
  const [ini, setIni] = useState(acao.data_inicio ?? '')
  const [fim, setFim] = useState(acao.data_fim ?? '')
  const siglaOk = sigla === '' || /^[A-Z0-9]{3,}$/.test(sigla)
  const setT = (k: keyof SimuladorState['dadosTrafego'], v: number) => onShared((st) => ({ ...st, dadosTrafego: { ...st.dadosTrafego, [k]: v } }))
  const setD = (k: keyof SimuladorState['distribuicaoVerba'], v: number) => onShared((st) => ({ ...st, distribuicaoVerba: { ...st.distribuicaoVerba, [k]: v } }))
  const setC = (k: keyof SimuladorState['canaisVenda'], v: number) => onShared((st) => ({ ...st, canaisVenda: { ...st.canaisVenda, [k]: v } }))
  const totalVerba = s.distribuicaoVerba.vendaIngressos + s.distribuicaoVerba.vendaProduto + s.distribuicaoVerba.distribuicaoConteudo + s.distribuicaoVerba.rmktAquecimento
  const totalCanais = s.canaisVenda.trafego + s.canaisVenda.organico + s.canaisVenda.baseInterna + s.canaisVenda.outrosCanais
  const extras = cenarios.filter((c) => c.ordem !== 0).sort((a, b) => a.ordem - b.ordem)
  // CPA máximo por ingresso (igual à planilha): verba de aquisição ÷ ingressos via TRÁFEGO PAGO.
  // Orgânico/base/conteúdo não consomem CPA, então só contam os ingressos do tráfego.
  const verbaIngressos = s.verbaTotal * (s.distribuicaoVerba.vendaIngressos / 100)
  const ingressosTrafego = s.metaIngressos * (s.canaisVenda.trafego / 100)
  const cpaMaximo = ingressosTrafego > 0 ? verbaIngressos / ingressosTrafego : 0
  const cpaEstimado = dBase.cpa
  const viavel = cpaMaximo > 0 ? cpaEstimado <= cpaMaximo : true

  return (
    <>
      <ModoToggle modo={modo} onChange={setModo} />
      <Card title="🆔 Identidade & Período" desc="Sigla casa o investimento real do Meta. Capa aparece no card.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">Sigla (≥3, A-Z 0-9) — use no nome da campanha Meta</span>
            <input value={sigla} onChange={(e) => { const v = e.target.value.toUpperCase(); setSigla(v); if (v === '' || /^[A-Z0-9]{3,}$/.test(v)) onAcao({ sigla: v || null }) }}
              className={clsx('bg-[#0A0F1E] border rounded-lg px-2.5 py-2 text-sm text-gray-200 tabular-nums focus:outline-none', siglaOk ? 'border-[#1F2937] focus:border-cyan-500/60' : 'border-rose-500/60')} placeholder="Ex: LANC2406" />
            {!siglaOk && <span className="text-[10px] text-rose-400">≥3 caracteres, só A-Z e 0-9.</span>}
          </label>
          <TextField label="Capa (URL da imagem — opcional)" value={capa} onChange={(v) => { setCapa(v); onAcao({ thumbnail_url: v || null }) }} placeholder="https://…" />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">Início</span>
            <input type="date" value={ini} onChange={(e) => { setIni(e.target.value); onAcao({ data_inicio: e.target.value || null }) }}
              className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">Fim</span>
            <input type="date" value={fim} onChange={(e) => { setFim(e.target.value); onAcao({ data_fim: e.target.value || null }) }}
              className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" />
          </label>
        </div>
      </Card>

      {modo === 'simulador' ? (<>
      <Card title="📡 Dados de Tráfego" desc="Métricas de tráfego pago do cenário base">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumField label="CPM" prefix="R$" value={s.dadosTrafego.cpm} onChange={(v) => setT('cpm', v)} />
          <NumField label="CTR" suffix="%" value={s.dadosTrafego.ctr} onChange={(v) => setT('ctr', v)} />
          <NumField label="Connect Rate" suffix="%" value={s.dadosTrafego.connectRate} onChange={(v) => setT('connectRate', v)} />
          <NumField label="Taxa Conversão Página" suffix="%" value={s.dadosTrafego.txConversao} onChange={(v) => setT('txConversao', v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Vendas a cada 1.000 impressões" value={formatNumber(dBase.vendasPorMil, 2)} accent="text-white" />
          <Stat label="CPA (Custo por Venda)" value={formatCurrency(dBase.cpa)} accent="text-cyan-300" />
        </div>
      </Card>

      <Card title="Variação Percentual dos Cenários" desc="Defina como cada parâmetro varia em relação ao cenário base"
        action={extras.length < MAX_CENARIOS_EXTRAS ? (
          <button onClick={onAddCenario} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 cursor-pointer"><Plus size={14} /> Adicionar cenário</button>
        ) : undefined}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {extras.map((c, idx) => {
            const theme = CENARIO_THEME[idx] ?? CENARIO_THEME[CENARIO_THEME.length - 1]
            const dC = derivados.get(c.id)!
            return (
              <div key={c.id} className="border border-[#1F2937] rounded-xl p-4 space-y-4 bg-[#0A0F1E]/40">
                <div className="flex items-center justify-between">
                  <span className={clsx('text-[11px] font-semibold px-2.5 py-1 rounded-md', theme.badge)}>{c.nome}</span>
                  {c.ordem >= 3 && <button onClick={() => onRemoveCenario(c.id)} aria-label={`Remover cenário ${c.nome}`} className="text-gray-600 hover:text-rose-400 cursor-pointer" title="Remover cenário"><Trash2 size={14} /></button>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {VAR_PARAMS.map((p) => (
                    <ParamVar key={p.key} label={p.label} melhor={p.melhor} value={c.estado.variacao[p.key] ?? 0}
                      onChange={(v) => onVariacao(c.id, { ...c.estado.variacao, [p.key]: v })} />
                  ))}
                </div>
                <div className="pt-2 border-t border-[#1F2937] text-xs text-gray-400">CPA Resultante: <span className={clsx('font-semibold', theme.cpa)}>{formatCurrency(dC.cpa)}</span></div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="💰 Distribuição de Verba" desc="Orçamento total e distribuição entre etapas">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumField label="Verba Total do Projeto" prefix="R$" step={100} value={s.verbaTotal} onChange={(v) => onShared((st) => ({ ...st, verbaTotal: v }))} />
          <NumField label="Dias de Captação" value={s.diasCaptacao} onChange={(v) => onShared((st) => ({ ...st, diasCaptacao: v }))} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumField label="Vendas de Ingressos" suffix="%" value={s.distribuicaoVerba.vendaIngressos} onChange={(v) => setD('vendaIngressos', v)} />
          <NumField label="Vendas do Produto" suffix="%" value={s.distribuicaoVerba.vendaProduto} onChange={(v) => setD('vendaProduto', v)} />
          <NumField label="Distribuição de Conteúdo" suffix="%" value={s.distribuicaoVerba.distribuicaoConteudo} onChange={(v) => setD('distribuicaoConteudo', v)} />
          <NumField label="Rmkt + Aquecimento" suffix="%" value={s.distribuicaoVerba.rmktAquecimento} onChange={(v) => setD('rmktAquecimento', v)} />
        </div>
        <p className={clsx('text-[11px]', Math.round(totalVerba) === 100 ? 'text-emerald-400' : 'text-amber-400')}>Total distribuição: {formatNumber(totalVerba, 1)}%</p>
      </Card>

      <Card title="🛒 Canais de Vendas de Ingressos" desc="Distribua as vendas entre os canais">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumField label="Tráfego Pago" suffix="%" value={s.canaisVenda.trafego} onChange={(v) => setC('trafego', v)} />
          <NumField label="Orgânico" suffix="%" value={s.canaisVenda.organico} onChange={(v) => setC('organico', v)} />
          <NumField label="Base Interna" suffix="%" value={s.canaisVenda.baseInterna} onChange={(v) => setC('baseInterna', v)} />
          <NumField label="Outros Canais" suffix="%" value={s.canaisVenda.outrosCanais} onChange={(v) => setC('outrosCanais', v)} />
        </div>
        <p className={clsx('text-[11px]', Math.round(totalCanais) === 100 ? 'text-emerald-400' : 'text-amber-400')}>Total canais: {formatNumber(totalCanais, 1)}%</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Projeção Ingressos (Base)" value={formatNumber(dBase.projecaoIngressos)} />
          <Stat label="Total Ingressos (Base)" value={formatNumber(dBase.totalIngressos)} accent="text-cyan-300" />
          <Stat label="CPA Tráfego" value={formatCurrency(dBase.cpaTrafego)} />
          <Stat label="CPA Global" value={formatCurrency(dBase.cpaGlobal)} accent="text-cyan-300" />
        </div>
      </Card>

      <Card title="🎯 CPA Máximo por Ingresso" desc="Defina sua meta de ingressos para descobrir quanto pode pagar por venda do tráfego pago — e se o tráfego cabe nesse teto.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumField label="Meta de Ingressos (total)" value={s.metaIngressos} onChange={(v) => onShared((st) => ({ ...st, metaIngressos: v }))} />
          <Stat label={`Ingressos via Tráfego (${formatNumber(s.canaisVenda.trafego, 0)}%)`} value={formatNumber(ingressosTrafego)} hint="meta × % tráfego pago" />
          <Stat label="Verba de Aquisição" value={formatCurrency(verbaIngressos)} hint="verba × % vendas de ingressos" />
          <Stat label="CPA Máximo por Ingresso" value={cpaMaximo > 0 ? formatCurrency(cpaMaximo) : '—'} accent="text-indigo-300" hint="verba de aquisição ÷ ingressos via tráfego" />
        </div>
        {s.metaIngressos > 0 && (
          <div className={clsx('rounded-xl border p-4 flex items-center gap-3', viavel ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30')}>
            {viavel ? <Check size={16} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={16} className="text-rose-400 shrink-0" />}
            <div className="text-xs">
              <p className={clsx('font-medium', viavel ? 'text-emerald-200' : 'text-rose-200')}>{viavel ? 'Tráfego cabe na meta' : 'CPA estimado acima do máximo'}</p>
              <p className="text-gray-400 mt-0.5 tabular-nums">CPA máximo: <strong className="text-gray-200">{formatCurrency(cpaMaximo)}</strong> · CPA estimado (do CPM): <strong className={viavel ? 'text-emerald-300' : 'text-rose-300'}>{formatCurrency(cpaEstimado)}</strong></p>
            </div>
          </div>
        )}
      </Card>
      </>) : <PainelMeta base={base} impostos={impostos} onShared={onShared} />}
    </>
  )
}

// ─────────────────────────── Calculadora reversa (Por meta) ───────────────────
function ModoToggle({ modo, onChange }: { modo: 'meta' | 'simulador'; onChange: (m: 'meta' | 'simulador') => void }) {
  const btn = (active: boolean) => clsx(
    'flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors',
    active ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-white',
  )
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#1F2937] bg-[#0A0F1E] p-1.5 max-w-md">
      <button onClick={() => onChange('meta')} className={btn(modo === 'meta')}>🎯 Por meta de lucro</button>
      <button onClick={() => onChange('simulador')} className={btn(modo === 'simulador')}>🔧 Simulador</button>
    </div>
  )
}

function PainelMeta({ base, impostos, onShared }: { base: SbAcaoCenario; impostos: ImpostoConfig; onShared: (fn: (s: SimuladorState) => SimuladorState) => void }) {
  const s = base.estado
  const r = computeReverso(s, impostos)
  const setMeta = (v: number) => onShared((st) => ({ ...st, metaLucro: v }))
  const setVerba = (v: number) => onShared((st) => ({ ...st, verbaTotal: v }))
  const setPrinc = (k: 'ticket' | 'conversao', v: number) => onShared((st) => ({ ...st, ofertaPrincipal: { ...st.ofertaPrincipal, [k]: v } }))
  const setT = (k: keyof SimuladorState['dadosTrafego'], v: number) => onShared((st) => ({ ...st, dadosTrafego: { ...st.dadosTrafego, [k]: v } }))
  const pct = (n: number) => `${formatNumber(n, 2)}%`

  return (
    <>
      <Card title="🎯 Meta & Produto principal" desc="A partir do lucro que você quer, calculamos o CPA máximo por ingresso e as metas de funil. Considera só ingressos + produto principal (upsell e order bumps ficam na aba Metas e entram no consolidado).">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <NumField label="Meta de lucro" prefix="R$" value={s.metaLucro ?? 0} onChange={setMeta} step={1000} />
          <NumField label="Investimento em tráfego" prefix="R$" value={s.verbaTotal} onChange={setVerba} step={500} />
          <div />
          <NumField label="Preço do produto principal" prefix="R$" value={s.ofertaPrincipal.ticket} onChange={(v) => setPrinc('ticket', v)} />
          <NumField label="Conversão do principal (sobre ingressos)" suffix="%" value={s.ofertaPrincipal.conversao} onChange={(v) => setPrinc('conversao', v)} />
        </div>
      </Card>

      {!r.viavel ? (
        <Card title="📊 Resultado">
          <p className="text-sm text-gray-400">{r.motivo}</p>
        </Card>
      ) : (
        <>
          <Card title="📊 Metas para bater" desc="Quanto você precisa para lucrar o que definiu.">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Faturamento necessário" value={formatCurrency(r.faturamentoNecessario)} accent="text-white" />
              <Stat label="Vendas do principal" value={formatNumber(r.vendasPrincipal)} accent="text-white" />
              <Stat label="Ingressos necessários" value={formatNumber(r.ingressosNecessarios)} accent="text-white" />
              <Stat label="CPA máximo por ingresso" value={formatCurrency(r.cpaMaximo)} accent="text-cyan-300" hint="o máximo que você pode pagar por ingresso/lead" />
            </div>
          </Card>

          <Card title="📡 Metas de funil" desc="Sua métrica atual → a meta que sozinha fecha o CPA máximo (segurando as outras três). Edite o 'atual' com o que você espera/realiza.">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumField label="CPM (atual)" prefix="R$" value={s.dadosTrafego.cpm} onChange={(v) => setT('cpm', v)} />
              <NumField label="CTR (atual)" suffix="%" value={s.dadosTrafego.ctr} onChange={(v) => setT('ctr', v)} />
              <NumField label="Connect Rate (atual)" suffix="%" value={s.dadosTrafego.connectRate} onChange={(v) => setT('connectRate', v)} />
              <NumField label="Conversão da página (atual)" suffix="%" value={s.dadosTrafego.txConversao} onChange={(v) => setT('txConversao', v)} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
              <Stat label="CPM — meta (máx)" value={`≤ ${formatCurrency(r.metas.cpm.meta)}`} accent="text-cyan-300" hint={`atual ${formatCurrency(r.metas.cpm.atual)}`} />
              <Stat label="CTR — meta (mín)" value={`≥ ${pct(r.metas.ctr.meta)}`} accent="text-cyan-300" hint={`atual ${pct(r.metas.ctr.atual)}`} />
              <Stat label="Connect Rate — meta (mín)" value={`≥ ${pct(r.metas.connectRate.meta)}`} accent="text-cyan-300" hint={`atual ${pct(r.metas.connectRate.atual)}`} />
              <Stat label="Conversão da página — meta (mín)" value={`≥ ${pct(r.metas.conversaoPagina.meta)}`} accent="text-cyan-300" hint={`atual ${pct(r.metas.conversaoPagina.atual)}`} />
            </div>
            <div className={clsx('rounded-xl border p-4 flex items-center gap-3 mt-1', r.bate ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30')}>
              {r.bate ? <Check size={16} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={16} className="text-rose-400 shrink-0" />}
              <div className="text-xs">
                <p className={clsx('font-medium', r.bate ? 'text-emerald-200' : 'text-rose-200')}>{r.bate ? 'Seu funil atual bate a meta' : 'Seu funil atual NÃO bate o CPA máximo'}</p>
                <p className="text-gray-400 mt-0.5 tabular-nums">
                  CPA projetado (funil atual):{' '}
                  <strong className={r.bate ? 'text-emerald-300' : 'text-rose-300'} title={r.cpaProjetadoInviavel ? 'CTR, Connect Rate ou Conversão da página estão zerados — não dá pra estimar vendas, o CPA é infinito (não é tráfego grátis).' : undefined}>
                    {r.cpaProjetadoInviavel ? 'não estimável (∞)' : formatCurrency(r.cpaProjetado)}
                  </strong>{' '}
                  · CPA máximo: <strong className="text-gray-200">{formatCurrency(r.cpaMaximo)}</strong>
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </>
  )
}

// ─────────────────────────────────────── Lotes ────────────────────────────────
function LotesTab({ base, derivados, onShared }: { base: SbAcaoCenario; cenarios: SbAcaoCenario[]; derivados: Map<string, CenarioDerivado>; onShared: (fn: (s: SimuladorState) => SimuladorState) => void }) {
  const s = base.estado
  const d = derivados.get(base.id)!
  const totalVendas = s.lotes.reduce((a, l) => a + l.vendas, 0)
  const setLote = (i: number, patch: Partial<SimuladorState['lotes'][0]>) => onShared((st) => ({ ...st, lotes: st.lotes.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))
  const addLote = () => onShared((st) => (st.lotes.length >= 5 ? st : { ...st, lotes: [...st.lotes, { nome: '', ticket: 0, vendas: 0 }] }))
  const delLote = (i: number) => onShared((st) => (st.lotes.length <= 1 ? st : { ...st, lotes: st.lotes.filter((_, j) => j !== i) }))

  return (
    <Card title="Distribuição de Lotes" desc="Configure os lotes de ingressos e a distribuição de vendas (máx 5)">
      <div className="space-y-2">
        <div className="hidden sm:grid sm:grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-gray-500 px-1">
          <span className="col-span-4">Lote</span><span className="col-span-2">Ticket (R$)</span><span className="col-span-2">Vendas (%)</span><span className="col-span-2">Ingressos</span><span className="col-span-2">Faturamento</span>
        </div>
        {s.lotes.map((l, i) => (
          <div key={i} className="flex flex-col sm:grid sm:grid-cols-12 gap-2 sm:items-center">
            <input className="col-span-4 bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" placeholder={`Lote ${i + 1}`} value={l.nome} onChange={(e) => setLote(i, { nome: e.target.value })} />
            <input type="number" className="col-span-2 bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 tabular-nums focus:outline-none focus:border-cyan-500/60" value={l.ticket} onChange={(e) => setLote(i, { ticket: Number(e.target.value) || 0 })} />
            <input type="number" className="col-span-2 bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 tabular-nums focus:outline-none focus:border-cyan-500/60" value={l.vendas} onChange={(e) => setLote(i, { vendas: Number(e.target.value) || 0 })} />
            <span className="col-span-2 text-sm text-gray-300 tabular-nums">{formatNumber(d.lotes[i]?.ingressos ?? 0)}</span>
            <span className="col-span-2 flex items-center justify-between gap-1">
              <span className="text-sm text-emerald-300 tabular-nums">{formatCurrencyCompact(d.lotes[i]?.faturamento ?? 0)}</span>
              {s.lotes.length > 1 && <ConfirmTrashButton label={`Remover ${l.nome || `lote ${i + 1}`}`} onConfirm={() => delLote(i)} />}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className={clsx('text-[11px]', Math.round(totalVendas) === 100 ? 'text-emerald-400' : 'text-amber-400')}>Total distribuição de vendas: {formatNumber(totalVendas, 1)}%</p>
        {s.lotes.length < 5 && <button onClick={addLote} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 cursor-pointer"><Plus size={14} /> Adicionar lote</button>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Ticket Médio" value={formatCurrency(d.ticketMedio)} accent="text-indigo-300" />
        <Stat label="Total Ingressos" value={formatNumber(d.totalIngressos)} accent="text-emerald-300" />
        <Stat label="Faturamento Ingressos" value={formatCurrency(d.faturamentoIngressos)} accent="text-amber-300" />
      </div>
    </Card>
  )
}

// ─────────────────────────────────────── Metas ────────────────────────────────
function MetasTab({ base, derivados, onShared }: { base: SbAcaoCenario; cenarios: SbAcaoCenario[]; derivados: Map<string, CenarioDerivado>; onShared: (fn: (s: SimuladorState) => SimuladorState) => void }) {
  const s = base.estado
  const d = derivados.get(base.id)!
  const setOB = (i: number, patch: Partial<SimuladorState['eventoOBs'][0]>) => onShared((st) => ({ ...st, eventoOBs: st.eventoOBs.map((o, j) => (j === i ? { ...o, ...patch } : o)) }))
  const addOB = () => onShared((st) => ({ ...st, eventoOBs: [...st.eventoOBs, { nome: '', ticket: 0, conversao: 0 }] }))
  const delOB = (i: number) => onShared((st) => ({ ...st, eventoOBs: st.eventoOBs.filter((_, j) => j !== i) }))
  const setOferta = (patch: Partial<SimuladorState['ofertaPrincipal']>) => onShared((st) => ({ ...st, ofertaPrincipal: { ...st.ofertaPrincipal, ...patch } }))
  const setExtra = (i: number, patch: Partial<SimuladorState['produtoExtras'][0]>) => onShared((st) => ({ ...st, produtoExtras: st.produtoExtras.map((o, j) => (j === i ? { ...o, ...patch } : o)) }))
  const addExtra = () => onShared((st) => ({ ...st, produtoExtras: [...st.produtoExtras, { nome: '', ticket: 0, conversao: 0 }] }))
  const delExtra = (i: number) => onShared((st) => ({ ...st, produtoExtras: st.produtoExtras.filter((_, j) => j !== i) }))

  return (
    <>
      <Card title="🎟️ Evento de Lançamento" desc="Faturamento com ingressos e orderbumps do evento">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Ingressos (vendas)" value={formatNumber(d.totalIngressos)} />
          <Stat label="Ticket Médio" value={formatCurrency(d.ticketMedio)} />
          <Stat label="Faturamento Ingressos" value={formatCurrency(d.faturamentoIngressos)} accent="text-emerald-300" />
        </div>
        <div className="space-y-2">
          <p className="text-[11px] text-gray-500">Orderbumps do evento (conversão = % dos compradores de ingressos)</p>
          {s.eventoOBs.map((o, i) => (
            <div key={i} className="flex flex-col sm:grid sm:grid-cols-12 gap-2 sm:items-end">
              <div className="col-span-5"><TextField label="Produto" value={o.nome} onChange={(v) => setOB(i, { nome: v })} placeholder="Ex: Gravação" /></div>
              <div className="col-span-3"><NumField label="Ticket" prefix="R$" value={o.ticket} onChange={(v) => setOB(i, { ticket: v })} /></div>
              <div className="col-span-3"><NumField label="Conversão" suffix="%" value={o.conversao} onChange={(v) => setOB(i, { conversao: v })} /></div>
              <ConfirmTrashButton label={`Remover ${o.nome || `orderbump ${i + 1}`}`} className="col-span-1 pb-2.5" onConfirm={() => delOB(i)} />
            </div>
          ))}
          <button onClick={addOB} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 cursor-pointer"><Plus size={14} /> Adicionar orderbump do evento</button>
        </div>
        <div className="flex justify-end"><span className="text-sm text-gray-400">Subtotal Evento: <span className="text-emerald-300 font-semibold">{formatCurrency(d.eventoSubtotal)}</span></span></div>
      </Card>

      <Card title="🎁 Produto e Oferta Principal" desc="Faturamento com o produto principal vendido no evento">
        <div className="flex flex-col sm:grid sm:grid-cols-12 gap-2 sm:items-end">
          <div className="col-span-6"><TextField label="Nome do produto" value={s.ofertaPrincipal.nome} onChange={(v) => setOferta({ nome: v })} placeholder="Ex: Programa Demonstrativo" /></div>
          <div className="col-span-3"><NumField label="Ticket" prefix="R$" value={s.ofertaPrincipal.ticket} onChange={(v) => setOferta({ ticket: v })} /></div>
          <div className="col-span-3"><NumField label="Conversão" suffix="%" value={s.ofertaPrincipal.conversao} onChange={(v) => setOferta({ conversao: v })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Vendas Oferta Principal" value={formatNumber(d.ofertaPrincipal.vendas)} />
          <Stat label="Faturamento Oferta" value={formatCurrency(d.ofertaPrincipal.faturamento)} accent="text-emerald-300" />
        </div>
        <div className="space-y-2">
          <p className="text-[11px] text-gray-500">Orderbumps / Upsell (conversão = % dos compradores da oferta principal)</p>
          {s.produtoExtras.map((o, i) => (
            <div key={i} className="flex flex-col sm:grid sm:grid-cols-12 gap-2 sm:items-end">
              <div className="col-span-5"><TextField label="Produto" value={o.nome} onChange={(v) => setExtra(i, { nome: v })} /></div>
              <div className="col-span-3"><NumField label="Ticket" prefix="R$" value={o.ticket} onChange={(v) => setExtra(i, { ticket: v })} /></div>
              <div className="col-span-3"><NumField label="Conversão" suffix="%" value={o.conversao} onChange={(v) => setExtra(i, { conversao: v })} /></div>
              <ConfirmTrashButton label={`Remover ${o.nome || `item ${i + 1}`}`} className="col-span-1 pb-2.5" onConfirm={() => delExtra(i)} />
            </div>
          ))}
          <button onClick={addExtra} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 cursor-pointer"><Plus size={14} /> Adicionar orderbump / upsell</button>
        </div>
        <div className="flex justify-end"><span className="text-sm text-gray-400">Subtotal Produto: <span className="text-emerald-300 font-semibold">{formatCurrency(d.produtoSubtotal)}</span></span></div>
      </Card>

      <Card title="📊 Resumo do Cenário Base">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label="Faturamento Total" value={formatCurrency(d.faturamentoTotal)} accent="text-emerald-300" />
          <Stat label="Investimento" value={formatCurrency(base.estado.verbaTotal)} />
          <Stat label="ROAS" value={formatRoas(d.roas)} accent="text-cyan-300" />
        </div>
      </Card>
    </>
  )
}

// ─────────────────────────────────────── Dashboard ────────────────────────────
function DashboardTab({ cenarios, derivados, lucros, melhorId }: {
  cenarios: SbAcaoCenario[]; derivados: Map<string, CenarioDerivado>; lucros: Map<string, ReturnType<typeof calcLucroBrutoPlano>>; melhorId: string | null
}) {
  const melhor = melhorId ? cenarios.find((c) => c.id === melhorId) : null
  const dMelhor = melhor ? derivados.get(melhor.id)! : null
  return (
    <>
      {melhor && dMelhor && (
        <div className="bg-gradient-to-br from-cyan-500/10 to-[#111827] border border-cyan-500/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3"><Star size={15} className="text-cyan-300" /><span className="text-xs font-semibold text-cyan-300">Melhor Performance · {melhor.nome}</span></div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Investimento" value={formatCurrency(melhor.estado.verbaTotal)} />
            <Stat label="Ingressos" value={formatNumber(dMelhor.totalIngressos)} />
            <Stat label="Fat. Evento" value={formatCurrency(dMelhor.eventoSubtotal)} />
            <Stat label="Fat. Produto" value={formatCurrency(dMelhor.produtoSubtotal)} />
            <Stat label="ROAS" value={formatRoas(dMelhor.roas)} accent="text-cyan-300" />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cenarios.map((c) => {
          const d = derivados.get(c.id)!; const l = lucros.get(c.id)!
          return (
            <div key={c.id} className={clsx('bg-[#111827] border rounded-xl p-4', c.id === melhorId ? 'border-cyan-500/40' : 'border-[#1F2937]')}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-white">{c.nome}</span>
                {c.id === melhorId && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">melhor</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Row label="CPA" value={formatCurrency(d.cpa)} /><Row label="Vendas/1k" value={formatNumber(d.vendasPorMil, 2)} />
                <Row label="Ingressos" value={formatNumber(d.totalIngressos)} /><Row label="Ticket Médio" value={formatCurrency(d.ticketMedio)} />
                <Row label="Evento" value={formatCurrencyCompact(d.eventoSubtotal)} /><Row label="Produto" value={formatCurrencyCompact(d.produtoSubtotal)} />
              </div>
              <div className="border-t border-[#1F2937] mt-3 pt-3 space-y-1">
                <div className="flex justify-between text-sm"><span className="text-gray-400">Faturamento</span><span className="text-emerald-300 font-semibold tabular-nums">{formatCurrency(d.faturamentoTotal)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-400">Lucro bruto</span><span className={clsx('font-semibold tabular-nums', l.lucroBruto >= 0 ? 'text-emerald-300' : 'text-rose-400')}>{formatCurrency(l.lucroBruto)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-400">ROAS</span><span className="text-cyan-300 font-semibold tabular-nums">{formatRoas(d.roas)}</span></div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-gray-500">{label}</span><span className="text-gray-200 tabular-nums">{value}</span></div>
}

// ─────────────────────────────────────── Gráficos ─────────────────────────────
function GraficosTab({ cenarios, derivados }: { cenarios: SbAcaoCenario[]; derivados: Map<string, CenarioDerivado> }) {
  const dataFat = cenarios.map((c, i) => ({ nome: c.nome, Faturamento: derivados.get(c.id)!.faturamentoTotal, fill: CHART_COLORS[i % CHART_COLORS.length] }))
  const dataRoas = cenarios.map((c, i) => ({ nome: c.nome, ROAS: Number(derivados.get(c.id)!.roas.toFixed(2)), fill: CHART_COLORS[i % CHART_COLORS.length] }))
  const dataCpa = cenarios.map((c, i) => ({ nome: c.nome, CPA: Number(derivados.get(c.id)!.cpa.toFixed(2)), fill: CHART_COLORS[i % CHART_COLORS.length] }))
  const base = cenarios.find((c) => c.ordem === 0) ?? cenarios[0]
  const dBase = base ? derivados.get(base.id)! : null
  const comp = dBase ? [
    { name: 'Ingressos', value: dBase.faturamentoIngressos }, { name: 'OBs Evento', value: dBase.eventoSubtotal - dBase.faturamentoIngressos },
    { name: 'Oferta', value: dBase.ofertaPrincipal.faturamento }, { name: 'Extras', value: dBase.produtoSubtotal - dBase.ofertaPrincipal.faturamento },
  ].filter((x) => x.value > 0) : []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Faturamento por Cenário"><BarChartView data={dataFat} dataKey="Faturamento" money /></ChartCard>
      <ChartCard title="ROAS por Cenário"><BarChartView data={dataRoas} dataKey="ROAS" /></ChartCard>
      <ChartCard title="CPA por Cenário"><BarChartView data={dataCpa} dataKey="CPA" money /></ChartCard>
      <ChartCard title="Composição do Faturamento (Base)">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={comp} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
              {comp.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={{ background: '#0A0F1E', border: '1px solid #1F2937', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5"><h3 className="text-sm font-semibold text-white mb-4">{title}</h3>{children}</div>
}
function BarChartView({ data, dataKey, money }: { data: Record<string, unknown>[]; dataKey: string; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
        <XAxis dataKey="nome" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#1F2937' }} />
        <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#1F2937' }} tickFormatter={(v) => (money ? formatCurrencyCompact(v) : String(v))} />
        <Tooltip formatter={(v) => (money ? formatCurrency(Number(v)) : String(v))} contentStyle={{ background: '#0A0F1E', border: '1px solid #1F2937', borderRadius: 8, fontSize: 12 }} cursor={{ fill: '#ffffff08' }} />
        <Bar dataKey={dataKey} radius={[4, 4, 0, 0]}>{data.map((d, i) => <Cell key={i} fill={(d.fill as string) ?? '#06B6D4'} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────── Cenários ─────────────────────────────
function CenariosTab({ cenarios, derivados, lucros, melhorId, real, onAdd, onRemove }: {
  cenarios: SbAcaoCenario[]; derivados: Map<string, CenarioDerivado>; lucros: Map<string, ReturnType<typeof calcLucroBrutoPlano>>; melhorId: string | null
  real: CenarioReal; onAdd: () => void; onRemove: (cid: string) => void
}) {
  const cpaReal = real.analise.vendasFront > 0 ? real.investimento / real.analise.vendasFront : 0
  return (
    <Card title="Cenários" desc="Base, A, B + até 4 extras (simulados) e o Cenário Real (dados reais). O melhor ROAS simulado é destacado.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[10px] uppercase tracking-wider text-gray-500 text-left">
            <th className="py-2 pr-3">Cenário</th><th className="py-2 px-3">CPA</th><th className="py-2 px-3">Ingressos</th><th className="py-2 px-3">Faturamento</th><th className="py-2 px-3">Lucro</th><th className="py-2 px-3">ROAS</th><th className="py-2 pl-3"></th>
          </tr></thead>
          <tbody>
            {cenarios.map((c) => {
              const d = derivados.get(c.id)!; const l = lucros.get(c.id)!
              return (
                <tr key={c.id} className="border-t border-[#1F2937]">
                  <td className="py-2.5 pr-3 font-medium text-white">{c.nome} {c.id === melhorId && <Star size={12} className="inline text-cyan-300 ml-1" />}</td>
                  <td className="py-2.5 px-3 text-gray-300 tabular-nums">{formatCurrency(d.cpa)}</td>
                  <td className="py-2.5 px-3 text-gray-300 tabular-nums">{formatNumber(d.totalIngressos)}</td>
                  <td className="py-2.5 px-3 text-emerald-300 tabular-nums">{formatCurrency(d.faturamentoTotal)}</td>
                  <td className={clsx('py-2.5 px-3 tabular-nums', l.lucroBruto >= 0 ? 'text-emerald-300' : 'text-rose-400')}>{formatCurrency(l.lucroBruto)}</td>
                  <td className="py-2.5 px-3 text-cyan-300 tabular-nums">{formatRoas(d.roas)}</td>
                  <td className="py-2.5 pl-3 text-right">{c.ordem !== 0 && <button onClick={() => onRemove(c.id)} aria-label={`Remover cenário ${c.nome}`} title="Remover cenário" className="text-gray-600 hover:text-rose-400 cursor-pointer"><Trash2 size={14} /></button>}</td>
                </tr>
              )
            })}
            {/* Cenário Real (dados reais) */}
            <tr className="border-t border-cyan-500/30 bg-cyan-500/5">
              <td className="py-2.5 pr-3 font-medium text-cyan-200">Cenário Real {real.fonteInvestimento === 'sem_sigla' && <span title="Sem sigla — investimento real não casado" className="text-amber-400">⚠</span>}</td>
              <td className="py-2.5 px-3 text-gray-300 tabular-nums">{cpaReal > 0 ? formatCurrency(cpaReal) : '—'}</td>
              <td className="py-2.5 px-3 text-gray-300 tabular-nums">{formatNumber(real.analise.vendasFront)}</td>
              <td className="py-2.5 px-3 text-emerald-300 tabular-nums">{formatCurrency(real.faturamento)}</td>
              <td className={clsx('py-2.5 px-3 tabular-nums', real.lucro.lucroBruto >= 0 ? 'text-emerald-300' : 'text-rose-400')}>{formatCurrency(real.lucro.lucroBruto)}</td>
              <td className="py-2.5 px-3 text-cyan-300 tabular-nums">{real.roas > 0 ? formatRoas(real.roas) : '—'}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      {cenarios.filter((c) => c.kind === 'simulado').length < 7 && (
        <button onClick={onAdd} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 cursor-pointer"><Plus size={14} /> Adicionar cenário</button>
      )}
    </Card>
  )
}

// ─────────────────────────────────────── Previsto × Realizado × Previsão ───────
function ComparacaoTab({ base, derivados, impostos, real, horizonte, checklist, onToggle, onRefresh }: {
  base: SbAcaoCenario; derivados: Map<string, CenarioDerivado>; impostos: ImpostoConfig; real: CenarioReal
  horizonte: { diasDecorridos: number; diasTotais: number }; checklist: Record<string, boolean>
  onToggle: (key: string) => void; onRefresh: () => void
}) {
  const previsto = snapshotPrevisto(derivados.get(base.id)!, base.estado.verbaTotal, impostos)
  const linhas = buildComparacao(previsto, real, impostos, horizonte, checklist)
  const fmt = (key: string, v: number) => {
    if (key === 'roas') return formatRoas(v)
    if (key === 'vendas') return formatNumber(v)
    return formatCurrency(v)
  }
  return (
    <>
      {real.fonteInvestimento === 'sem_sigla' ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-200">
            <p className="font-medium">Investimento real não casado.</p>
            <p className="text-amber-200/80 mt-0.5">Defina uma <strong>sigla</strong> no planejamento e use-a no nome da campanha/conjunto/anúncio do Meta para o sistema somar o investimento real automaticamente.</p>
          </div>
        </div>
      ) : (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-[11px] text-gray-400">
          <span>Investimento real casado por sigla: <strong className="text-gray-200">{real.matchMeta.ads}</strong> anúncios · <strong className="text-gray-200">{real.matchMeta.linhas}</strong> registros · {formatCurrency(real.investimento)}</span>
          <button onClick={onRefresh} className="text-cyan-300 hover:text-cyan-200 cursor-pointer">atualizar agora</button>
        </div>
      )}

      <Card title="Previsto × Realizado × Previsão" desc="Previsto = cenário Base · Realizado = dados reais até agora · Previsão = projeção do fim pelo pace atual. Receita realizada é projeção (Hotmart cai em D+1/D+2).">
        {/* Checklist */}
        <div className="flex flex-wrap gap-2">
          {COMPARACAO_METRICAS.map((m) => {
            const on = checklist[m.key] !== false
            return (
              <button key={m.key} onClick={() => onToggle(m.key)}
                className={clsx('text-[11px] px-2 py-1 rounded-md border transition-colors cursor-pointer', on ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-[#1F2937] text-gray-500 hover:text-white')}>
                {on ? '✓ ' : ''}{m.label}
              </button>
            )
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[10px] uppercase tracking-wider text-gray-500 text-left">
              <th className="py-2 pr-3">Métrica</th><th className="py-2 px-3 text-right">Previsto</th><th className="py-2 px-3 text-right">Realizado</th><th className="py-2 px-3 text-right">Δ</th><th className="py-2 px-3 text-right">Previsão (fim)</th><th className="py-2 pl-3 text-right">Δ vs plano</th>
            </tr></thead>
            <tbody>
              {linhas.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-gray-500 text-xs">Nenhuma métrica selecionada no checklist.</td></tr>}
              {linhas.map((l) => (
                <tr key={l.key} className="border-t border-[#1F2937]">
                  <td className="py-2.5 pr-3 text-gray-300 flex items-center gap-1.5">
                    {l.semaforo && (
                      <span role="img" aria-label={`Status: ${SEMAFORO_LABEL[l.semaforo]}`} title={SEMAFORO_LABEL[l.semaforo]}
                        className="w-1.5 h-1.5 rounded-full" style={{ background: l.semaforo === 'green' ? '#10B981' : l.semaforo === 'yellow' ? '#F59E0B' : '#F43F5E' }} />
                    )}
                    {l.label}
                  </td>
                  <td className="py-2.5 px-3 text-right text-gray-200 tabular-nums">{fmt(l.key, l.previsto)}</td>
                  <td className={clsx('py-2.5 px-3 text-right tabular-nums font-medium', l.semaforo ? SEMAFORO_CSS[l.semaforo] : 'text-gray-200')}>{fmt(l.key, l.realizado)}</td>
                  <td className="py-2.5 px-3 text-right"><DeltaPct v={l.deltaReal} /></td>
                  <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{fmt(l.key, l.previsao)}</td>
                  <td className="py-2.5 pl-3 text-right"><DeltaPct v={l.deltaPrevisao} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-gray-500">Horizonte: {horizonte.diasDecorridos} de {horizonte.diasTotais || '—'} dias decorridos.</p>
      </Card>
    </>
  )
}

function DeltaPct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-gray-600 text-xs">—</span>
  const up = v >= 0
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-xs tabular-nums', up ? 'text-emerald-400' : 'text-rose-400')}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{Math.abs(v).toFixed(0)}%
    </span>
  )
}

// ─────────────────────────────────────── Notas ────────────────────────────────
function NotasTab({ notas, status, onAdd, onEdit, onDel }: {
  notas: SbAcaoNota[]; status: AcaoStatus; onAdd: (corpo: string) => void; onEdit: (nid: string, corpo: string) => void; onDel: (nid: string) => void
}) {
  const [nova, setNova] = useState('')
  const podeLicao = status === 'acao_concluida' || status === 'encerrado' || status === 'arquivado'
  const [showLicao, setShowLicao] = useState(false)

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-gray-500">Registre pensamentos, decisões e aprendizados. A IA do dashboard consegue ler estas notas.</p>
        {podeLicao && (
          <button onClick={() => setShowLicao(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 px-3 py-1.5 text-xs transition-colors cursor-pointer">
            <Lightbulb size={14} /> Capturar lição aprendida
          </button>
        )}
      </div>

      {showLicao && <LicaoModal onClose={() => setShowLicao(false)} onSave={(txt) => { onAdd(txt); setShowLicao(false) }} />}

      <Card title="Nova nota">
        <textarea value={nova} onChange={(e) => setNova(e.target.value)} rows={3} placeholder="Escreva uma nota…"
          className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60 resize-y" />
        <div className="flex justify-end">
          <button onClick={() => { if (nova.trim()) { onAdd(nova.trim()); setNova('') } }} disabled={!nova.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black px-4 py-2 text-sm font-medium transition-colors cursor-pointer">
            <Plus size={15} /> Adicionar nota
          </button>
        </div>
      </Card>

      <div className="space-y-3">
        {notas.length === 0 && <p className="text-sm text-gray-500 text-center py-6">Nenhuma nota ainda.</p>}
        {notas.map((n) => (
          <div key={n.id} className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-gray-500 tabular-nums">{(n.created_at || '').slice(0, 16).replace('T', ' ')}{n.autor_email ? ` · ${n.autor_email}` : ''}</span>
              <button onClick={() => onDel(n.id)} aria-label="Remover nota" title="Remover nota" className="text-gray-600 hover:text-rose-400 cursor-pointer"><Trash2 size={14} /></button>
            </div>
            <textarea defaultValue={n.corpo} rows={Math.min(8, Math.max(2, (n.corpo.match(/\n/g)?.length ?? 1) + 1))}
              onChange={(e) => onEdit(n.id, e.target.value)}
              className="w-full bg-transparent text-sm text-gray-200 focus:outline-none resize-y" />
          </div>
        ))}
      </div>
    </>
  )
}

function LicaoModal({ onClose, onSave }: { onClose: () => void; onSave: (texto: string) => void }) {
  const [cenarioVencedor, setCenarioVencedor] = useState('')
  const [metrica, setMetrica] = useState('')
  const [gargalo, setGargalo] = useState('')
  const [proximo, setProximo] = useState('')

  function salvar() {
    const txt = [
      '📌 Lição aprendida',
      cenarioVencedor && `• Cenário vencedor: ${cenarioVencedor}`,
      metrica && `• Métrica-chave: ${metrica}`,
      gargalo && `• Gargalo / o que travou: ${gargalo}`,
      proximo && `• Próximo passo: ${proximo}`,
    ].filter(Boolean).join('\n')
    if (!confirm('Registrar esta lição nas notas deste planejamento?')) return
    onSave(txt)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#0A0F1E] border border-[#1F2937] rounded-xl p-5 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2"><Lightbulb size={16} className="text-amber-300" /><h3 className="text-sm font-semibold text-white">Capturar lição aprendida</h3></div>
        <TextField label="Cenário vencedor" value={cenarioVencedor} onChange={setCenarioVencedor} placeholder="Ex: Cenário B (variações agressivas)" />
        <TextField label="Métrica-chave" value={metrica} onChange={setMetrica} placeholder="Ex: ROAS 3,2x · CPA R$48" />
        <TextField label="Gargalo / o que travou" value={gargalo} onChange={setGargalo} placeholder="Ex: connect rate abaixo do previsto" />
        <TextField label="Próximo passo" value={proximo} onChange={setProximo} placeholder="Ex: testar 5 hooks novos pro próximo lançamento" />
        <p className="text-[10px] text-gray-500">A lição é salva nas notas (e fica disponível para a IA). Você pode depois levá-la ao Segundo Cérebro.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-xs text-gray-400 hover:text-white cursor-pointer">Cancelar</button>
          <button onClick={salvar} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 text-xs font-medium cursor-pointer"><Check size={14} /> Salvar lição</button>
        </div>
      </div>
    </div>
  )
}
