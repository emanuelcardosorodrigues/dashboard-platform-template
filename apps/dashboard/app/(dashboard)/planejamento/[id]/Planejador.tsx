'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { clsx } from 'clsx'
import {
  ArrowLeft, LayoutDashboard, Filter as FunilIcon, Package, BarChart3, GitCompare,
  Plus, Trash2, Check, Cloud, CloudOff, Loader2, Star, Printer, Scale, AlertTriangle, TrendingUp, TrendingDown,
  StickyNote, Lightbulb, FileSpreadsheet,
} from 'lucide-react'
import { exportPlanejamentoXlsx } from '@/lib/exportPlanejamentoXlsx'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, CartesianGrid,
} from 'recharts'
import { ACAO_STATUS_FLOW, ACAO_STATUS_LABEL, type AcaoStatus, type SbAcaoCenario, type SbAcaoNota, type SbAcaoVenda, type ImpostoConfig, type CenarioDerivado } from '@/lib/acoesVendas'
import { computeFunil, funilToCenarioDerivado, normalizeFunilState, estagiosDoTipo, type FunilState, type FunilDerivado } from '@/lib/funilEngine'
import { calcLucroBrutoPlano, buildComparacao, snapshotPrevisto, COMPARACAO_METRICAS, type CenarioReal } from '@/lib/planejamento'
import { formatCurrency, formatCurrencyCompact, formatNumber, formatRoas } from '@/lib/formatters'
import { SEMAFORO_CSS } from '@/lib/thresholds'
import { useAutoSave } from '@/lib/useAutoSave'

type Tab = 'dashboard' | 'funil' | 'produtos' | 'graficos' | 'cenarios' | 'comparacao' | 'notas'
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'funil', label: 'Funil', icon: FunilIcon },
  { key: 'produtos', label: 'Produtos', icon: Package },
  { key: 'graficos', label: 'Gráficos', icon: BarChart3 },
  { key: 'cenarios', label: 'Cenários', icon: GitCompare },
  { key: 'comparacao', label: 'Previsto × Realizado', icon: Scale },
  { key: 'notas', label: 'Notas', icon: StickyNote },
]
const CHART_COLORS = ['#64748B', '#10B981', '#F59E0B', '#06B6D4', '#A855F7', '#EC4899', '#84CC16']
const SEMAFORO_LABEL: Record<'green' | 'yellow' | 'red', string> = { green: 'bom', yellow: 'atenção', red: 'ruim' }

export default function Planejador({ acao, cenariosIniciais, notasIniciais, impostos, real, horizonte }: {
  acao: SbAcaoVenda; cenariosIniciais: SbAcaoCenario[]; notasIniciais: SbAcaoNota[]; impostos: ImpostoConfig
  real: CenarioReal; horizonte: { diasDecorridos: number; diasTotais: number }
}) {
  const router = useRouter()
  const { status, pendingCount, schedule } = useAutoSave()
  const [tab, setTab] = useState<Tab>('funil')
  const [statusAcao, setStatusAcao] = useState<AcaoStatus>(acao.status)
  const [checklist, setChecklist] = useState<Record<string, boolean>>(acao.comparacao_kpis ?? {})
  const [notas, setNotas] = useState<SbAcaoNota[]>(notasIniciais)
  const estagios = estagiosDoTipo(acao.tipo)

  // Cenários (estado = FunilState normalizado). Auto-save por cenário.
  const [cenarios, setCenarios] = useState<{ id: string; nome: string; ordem: number; kind: 'simulado' | 'real'; estado: FunilState; is_melhor: boolean }[]>(
    () => [...cenariosIniciais].sort((a, b) => a.ordem - b.ordem).map((c) => ({
      id: c.id, nome: c.nome, ordem: c.ordem, kind: c.kind, is_melhor: c.is_melhor, estado: normalizeFunilState(c.estado as unknown as Partial<FunilState>),
    })),
  )
  const updatedAt = useRef<Record<string, string>>(Object.fromEntries(cenariosIniciais.map((c) => [c.id, c.updated_at])))
  const base = cenarios.find((c) => c.ordem === 0) ?? cenarios[0]

  const funilDeriv = useMemo(() => new Map(cenarios.map((c) => [c.id, computeFunil(c.estado, acao.tipo)])), [cenarios, acao.tipo])
  const derivados = useMemo(() => new Map(cenarios.map((c) => [c.id, funilToCenarioDerivado(c.estado, funilDeriv.get(c.id)!)])), [cenarios, funilDeriv])
  const lucros = useMemo(() => new Map(cenarios.map((c) => {
    const d = derivados.get(c.id)!
    return [c.id, calcLucroBrutoPlano(d.faturamentoTotal, c.estado.investimento, d.totalIngressos, impostos)]
  })), [cenarios, derivados, impostos])
  const melhorId = useMemo(() => {
    let best: { id: string; roas: number } | null = null
    for (const c of cenarios) { const r = derivados.get(c.id)!.roas; if (r > 0 && (!best || r > best.roas)) best = { id: c.id, roas: r } }
    return best?.id ?? null
  }, [cenarios, derivados])

  function persistCenario(cid: string, estado: FunilState, nome?: string) {
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
  // Edita inputs COMPARTILHADOS (tudo menos variação) → espelha em todos os cenários.
  function updateShared(fn: (s: FunilState) => FunilState) {
    const next = cenarios.map((c) => ({ ...c, estado: { ...fn(c.estado), variacao: c.estado.variacao } }))
    setCenarios(next)
    for (const c of next) persistCenario(c.id, c.estado)
  }
  function updateVariacao(cid: string, variacao: FunilState['variacao']) {
    const next = cenarios.map((c) => (c.id === cid ? { ...c, estado: { ...c.estado, variacao } } : c))
    setCenarios(next)
    const alvo = next.find((c) => c.id === cid)
    if (alvo) persistCenario(cid, alvo.estado)
  }

  const acaoPatch = useRef<Record<string, unknown>>({})
  function updateAcao(patch: Record<string, unknown>) {
    acaoPatch.current = { ...acaoPatch.current, ...patch }
    schedule('acao', async () => {
      const body = acaoPatch.current; acaoPatch.current = {}
      if (Object.keys(body).length === 0) return
      const res = await fetch(`/api/planejamento/${acao.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
    })
  }
  function toggleChecklist(key: string) {
    const next = { ...checklist, [key]: checklist[key] === false ? true : false }
    setChecklist(next); updateAcao({ comparacao_kpis: next })
  }

  async function addCenario() {
    const res = await fetch(`/api/planejamento/${acao.id}/cenarios`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!res.ok) { alert('Erro ao adicionar cenário: ' + ((await res.json().catch(() => ({})))?.error || res.status)); return }
    const novo = await res.json()
    updatedAt.current[novo.id] = novo.updated_at
    setCenarios((prev) => [...prev, { id: novo.id, nome: novo.nome, ordem: novo.ordem, kind: novo.kind, is_melhor: false, estado: normalizeFunilState(novo.estado) }])
  }
  async function removeCenario(cid: string) {
    if (!confirm('Remover este cenário?')) return
    const res = await fetch(`/api/planejamento/${acao.id}/cenarios/${cid}`, { method: 'DELETE' })
    if (!res.ok) { alert('Erro: ' + ((await res.json().catch(() => ({})))?.error || res.status)); return }
    setCenarios((prev) => prev.filter((c) => c.id !== cid))
  }

  // Notas
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

  function handleExport() {
    try {
      exportPlanejamentoXlsx(acao.nome, cenarios.map((c) => ({ nome: c.nome, estado: c.estado as unknown as Record<string, unknown>, derivado: derivados.get(c.id)!, lucro: lucros.get(c.id)!.lucroBruto, investimento: c.estado.investimento })))
    } catch (err) {
      alert('Erro ao exportar planilha: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[#1F2937] px-6 md:px-8 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/planejamento" aria-label="Voltar para o planejamento" className="text-gray-400 hover:text-white transition-colors"><ArrowLeft size={18} /></Link>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-white truncate">{acao.nome}</h1>
            <p className="text-[11px] text-gray-500">{acao.sigla ? `${acao.sigla} · ` : ''}{acao.perpetuo ? 'Perpétuo' : `${acao.data_inicio || '—'} → ${acao.data_fim || '—'}`}</p>
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

      <div className="border-b border-[#1F2937] px-6 md:px-8 flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx('inline-flex items-center gap-1.5 px-3.5 py-3.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer',
              tab === t.key ? 'border-cyan-500 text-cyan-300' : 'border-transparent text-gray-400 hover:text-white')}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 md:space-y-8 max-w-6xl w-full mx-auto">
        {tab === 'dashboard' && <DashboardTab cenarios={cenarios} derivados={derivados} lucros={lucros} melhorId={melhorId} />}
        {tab === 'funil' && base && <FunilTab base={base} cenarios={cenarios} funilDeriv={funilDeriv} estagios={estagios} onShared={updateShared} onVariacao={updateVariacao} />}
        {tab === 'produtos' && base && <ProdutosTab base={base} funilDeriv={funilDeriv.get(base.id)!} estagios={estagios} onShared={updateShared} />}
        {tab === 'graficos' && <GraficosTab cenarios={cenarios} derivados={derivados} />}
        {tab === 'cenarios' && <CenariosTab cenarios={cenarios} derivados={derivados} lucros={lucros} melhorId={melhorId} real={real} onAdd={addCenario} onRemove={removeCenario} />}
        {tab === 'comparacao' && base && (
          <ComparacaoTab base={base} derivados={derivados} impostos={impostos} real={real} horizonte={horizonte} checklist={checklist} onToggle={toggleChecklist} onRefresh={() => router.refresh()} />
        )}
        {tab === 'notas' && <NotasTab notas={notas} status={statusAcao} onAdd={addNota} onEdit={editNota} onDel={delNota} />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────── Compartilhados ───────────────────────
function SaveIndicator({ status, pendingCount }: { status: string; pendingCount: number }) {
  if (status === 'saving') return <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-300"><Loader2 size={13} className="animate-spin" /> salvando{pendingCount > 1 ? ` (${pendingCount})` : ''}…</span>
  if (status === 'error') return <span className="inline-flex items-center gap-1.5 text-[11px] text-rose-400"><CloudOff size={13} /> erro ao salvar</span>
  if (status === 'saved') return <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400"><Check size={13} /> salvo</span>
  return <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500"><Cloud size={13} /> sincronizado</span>
}
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

// ─────────────────────────────────────── Funil (edição) ───────────────────────
function FunilTab({ base, cenarios, funilDeriv, estagios, onShared, onVariacao }: {
  base: { id: string; estado: FunilState }; cenarios: { id: string; nome: string; ordem: number; estado: FunilState }[]
  funilDeriv: Map<string, FunilDerivado>; estagios: { vsl: boolean; lotes: boolean; pagina: boolean }
  onShared: (fn: (s: FunilState) => FunilState) => void; onVariacao: (cid: string, v: FunilState['variacao']) => void
}) {
  const s = base.estado
  const d = funilDeriv.get(base.id)!
  const set = (k: keyof FunilState, v: number) => onShared((st) => ({ ...st, [k]: v }))
  const extras = cenarios.filter((c) => c.ordem !== 0)
  const varKeys: { k: keyof FunilState['variacao']; label: string; show: boolean }[] = [
    { k: 'cpm', label: 'CPM', show: true }, { k: 'ctr', label: 'CTR', show: true },
    { k: 'carregamento', label: 'Carregamento', show: true },
    { k: 'playRate', label: 'Play Rate', show: estagios.vsl },
    { k: 'passagem', label: 'Passagem', show: true }, { k: 'convCheckout', label: 'Conv. Checkout', show: true },
  ]

  return (
    <>
      <Card title="📡 Investimento & Tráfego" desc="Métricas do funil do cenário base. A cadeia calcula vendas e CPA automaticamente.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumField label="Meta de Investimento" prefix="R$" step={1000} value={s.investimento} onChange={(v) => set('investimento', v)} />
          <NumField label="CPM" prefix="R$" value={s.cpm} onChange={(v) => set('cpm', v)} />
          <NumField label="CTR (link)" suffix="%" value={s.ctr} onChange={(v) => set('ctr', v)} />
          <NumField label="Carregamento da Página" suffix="%" value={s.carregamento} onChange={(v) => set('carregamento', v)} />
          {estagios.vsl && <NumField label="Play Rate (VSL)" suffix="%" value={s.playRate} onChange={(v) => set('playRate', v)} />}
          <NumField label="Passagem da Página" suffix="%" value={s.passagem} onChange={(v) => set('passagem', v)} />
          <NumField label="Conversão do Checkout" suffix="%" value={s.convCheckout} onChange={(v) => set('convCheckout', v)} />
          <NumField label="Meta de Vendas (opcional)" value={s.metaVendas} onChange={(v) => set('metaVendas', v)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Impressões" value={formatNumber(d.impressoes)} />
          <Stat label="Cliques" value={formatNumber(d.cliques)} />
          <Stat label="Visualizações" value={formatNumber(d.visualizacoes)} />
          {estagios.vsl && <Stat label="Plays VSL" value={formatNumber(d.plays)} />}
          <Stat label="Início Checkout" value={formatNumber(d.inicioCheckout)} />
          <Stat label="Vendas Principal" value={formatNumber(d.vendasPrincipal)} accent="text-cyan-300" />
          <Stat label="CPA" value={formatCurrency(d.cpa)} accent="text-cyan-300" />
          <Stat label="CPA Estimado" value={formatCurrency(d.cpaEstimado)} />
        </div>
      </Card>

      {s.metaVendas > 0 && (
        <div className={clsx('rounded-2xl border p-5 flex items-center gap-4', d.viavel ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30')}>
          {d.viavel ? <Check size={18} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={18} className="text-rose-400 shrink-0" />}
          <div className="text-sm">
            <p className={clsx('font-medium', d.viavel ? 'text-emerald-200' : 'text-rose-200')}>
              {d.viavel ? 'Tráfego viável para a meta' : 'Tráfego acima do orçamento da meta'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5 tabular-nums">CPA máximo (orçamento ÷ meta): <strong className="text-gray-200">{formatCurrency(d.cpaMaximo)}</strong> · CPA estimado (funil): <strong className={d.viavel ? 'text-emerald-300' : 'text-rose-300'}>{formatCurrency(d.cpaEstimado)}</strong></p>
          </div>
        </div>
      )}

      {extras.length > 0 && (
        <Card title="Variação dos Cenários" desc="Quanto cada métrica varia vs o Base (CPM negativo = melhor).">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {extras.map((c) => (
              <div key={c.id} className="border border-[#1F2937] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-cyan-300">{c.nome}</span>
                  <span className="text-[11px] text-gray-500">CPA: {formatCurrency(funilDeriv.get(c.id)!.cpa)}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {varKeys.filter((v) => v.show).map((v) => (
                    <NumField key={v.k} label={v.label} suffix="%" value={c.estado.variacao[v.k] ?? 0}
                      onChange={(val) => onVariacao(c.id, { ...c.estado.variacao, [v.k]: val })} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}

// ─────────────────────────────────────── Produtos (edição) ────────────────────
function ProdutosTab({ base, funilDeriv, estagios, onShared }: {
  base: { id: string; estado: FunilState }; funilDeriv: FunilDerivado; estagios: { vsl: boolean; lotes: boolean; pagina: boolean }
  onShared: (fn: (s: FunilState) => FunilState) => void
}) {
  const s = base.estado
  const d = funilDeriv
  const lista = (key: 'orderBumps' | 'upsells') => ({
    set: (i: number, patch: Partial<FunilState['orderBumps'][0]>) => onShared((st) => ({ ...st, [key]: st[key].map((o, j) => (j === i ? { ...o, ...patch } : o)) })),
    add: () => onShared((st) => ({ ...st, [key]: [...st[key], { nome: '', ticket: 0, conversao: 0 }] })),
    del: (i: number) => onShared((st) => ({ ...st, [key]: st[key].filter((_, j) => j !== i) })),
  })
  const ob = lista('orderBumps'); const up = lista('upsells')
  const setLote = (i: number, patch: Partial<FunilState['lotes'][0]>) => onShared((st) => ({ ...st, lotes: st.lotes.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))

  return (
    <>
      <Card title="🎯 Produto Principal" desc="Ticket do produto vendido no checkout. Lotes são opcionais (lançamento).">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {!s.usaLotes && <NumField label="Ticket Principal" prefix="R$" value={s.ticketPrincipal} onChange={(v) => onShared((st) => ({ ...st, ticketPrincipal: v }))} />}
          <Stat label="Vendas Principal" value={formatNumber(d.vendasPrincipal)} accent="text-cyan-300" />
          <Stat label="Faturamento Principal" value={formatCurrency(d.faturamentoPrincipal)} accent="text-emerald-300" />
        </div>
        {estagios.lotes && (
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={s.usaLotes} onChange={(e) => onShared((st) => ({ ...st, usaLotes: e.target.checked }))} className="accent-cyan-500" />
            <span className="text-xs text-gray-300">Usar lotes (ticket médio ponderado por % de vendas)</span>
          </label>
        )}
        {s.usaLotes && (
          <div className="space-y-2">
            <div className="hidden sm:grid sm:grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-gray-500 px-1">
              <span className="col-span-5">Lote</span><span className="col-span-3">Ticket (R$)</span><span className="col-span-3">Vendas (%)</span><span></span>
            </div>
            {s.lotes.map((l, i) => (
              <div key={i} className="flex flex-col sm:grid sm:grid-cols-12 gap-2 sm:items-center">
                <input className="col-span-5 bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" placeholder={`Lote ${i + 1}`} value={l.nome} onChange={(e) => setLote(i, { nome: e.target.value })} />
                <input type="number" className="col-span-3 bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 tabular-nums focus:outline-none focus:border-cyan-500/60" value={l.ticket} onChange={(e) => setLote(i, { ticket: Number(e.target.value) || 0 })} />
                <input type="number" className="col-span-3 bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 tabular-nums focus:outline-none focus:border-cyan-500/60" value={l.vendas} onChange={(e) => setLote(i, { vendas: Number(e.target.value) || 0 })} />
                {s.lotes.length > 1 && (
                  <ConfirmTrashButton label={`Remover ${l.nome || `lote ${i + 1}`}`} className="col-span-1"
                    onConfirm={() => onShared((st) => ({ ...st, lotes: st.lotes.filter((_, j) => j !== i) }))} />
                )}
              </div>
            ))}
            <button onClick={() => onShared((st) => ({ ...st, lotes: [...st.lotes, { nome: '', ticket: 0, vendas: 0 }] }))} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 cursor-pointer"><Plus size={14} /> Adicionar lote</button>
            <Stat label="Ticket Médio (lotes)" value={formatCurrency(d.ticketMedio)} accent="text-indigo-300" />
          </div>
        )}
      </Card>

      <OfertasCard title="🛒 Order Bumps" desc="Conversão = % dos compradores do produto principal." itens={s.orderBumps} deriv={d.orderBumps} onSet={ob.set} onAdd={ob.add} onDel={ob.del} />
      <OfertasCard title="⬆️ Upsells" desc="Conversão = % dos compradores do produto principal." itens={s.upsells} deriv={d.upsells} onSet={up.set} onAdd={up.add} onDel={up.del} />

      <Card title="🎤 Ascensão (Webinário / Workshop)" desc="Comparecimento dos compradores → conversão no pitch → ticket alto.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <TextField label="Nome" value={s.ascensao.nome} onChange={(v) => onShared((st) => ({ ...st, ascensao: { ...st.ascensao, nome: v } }))} />
          <NumField label="Comparecimento" suffix="%" value={s.ascensao.comparecimento} onChange={(v) => onShared((st) => ({ ...st, ascensao: { ...st.ascensao, comparecimento: v } }))} />
          <NumField label="Conversão" suffix="%" value={s.ascensao.conversao} onChange={(v) => onShared((st) => ({ ...st, ascensao: { ...st.ascensao, conversao: v } }))} />
          <NumField label="Ticket" prefix="R$" value={s.ascensao.ticket} onChange={(v) => onShared((st) => ({ ...st, ascensao: { ...st.ascensao, ticket: v } }))} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Pessoas" value={formatNumber(d.ascensao.pessoas)} />
          <Stat label="Vendas" value={formatNumber(d.ascensao.vendas)} />
          <Stat label="Faturamento" value={formatCurrency(d.ascensao.faturamento)} accent="text-emerald-300" />
        </div>
      </Card>

      <Card title="📊 Resumo do Cenário Base">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Faturamento Total" value={formatCurrency(d.faturamentoTotal)} accent="text-emerald-300" />
          <Stat label="Investimento" value={formatCurrency(s.investimento)} />
          <Stat label="Ticket Médio" value={formatCurrency(d.ticketMedio)} />
          <Stat label="ROAS" value={formatRoas(d.roas)} accent="text-cyan-300" />
        </div>
      </Card>
    </>
  )
}

function OfertasCard({ title, desc, itens, deriv, onSet, onAdd, onDel }: {
  title: string; desc: string; itens: FunilState['orderBumps']; deriv: { vendas: number; faturamento: number }[]
  onSet: (i: number, patch: Partial<FunilState['orderBumps'][0]>) => void; onAdd: () => void; onDel: (i: number) => void
}) {
  return (
    <Card title={title} desc={desc} action={<button onClick={onAdd} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 cursor-pointer"><Plus size={14} /> Adicionar</button>}>
      {itens.length === 0 ? <p className="text-xs text-gray-500">Nenhum item.</p> : (
        <div className="space-y-2">
          {itens.map((o, i) => (
            <div key={i} className="flex flex-col sm:grid sm:grid-cols-12 gap-2 sm:items-end">
              <div className="col-span-5"><TextField label={i === 0 ? 'Nome' : ''} value={o.nome} onChange={(v) => onSet(i, { nome: v })} /></div>
              <div className="col-span-3"><NumField label={i === 0 ? 'Ticket' : ''} prefix="R$" value={o.ticket} onChange={(v) => onSet(i, { ticket: v })} /></div>
              <div className="col-span-3"><NumField label={i === 0 ? 'Conversão' : ''} suffix="%" value={o.conversao} onChange={(v) => onSet(i, { conversao: v })} /></div>
              <ConfirmTrashButton label={`Remover ${o.nome || `item ${i + 1}`}`} className="col-span-1 pb-2.5" onConfirm={() => onDel(i)} />
              <div className="col-span-12 text-[11px] text-gray-500 -mt-1">{formatNumber(deriv[i]?.vendas ?? 0)} vendas · <span className="text-emerald-300">{formatCurrency(deriv[i]?.faturamento ?? 0)}</span></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─────────────────────────────────────── Dashboard ────────────────────────────
function DashboardTab({ cenarios, derivados, lucros, melhorId }: {
  cenarios: { id: string; nome: string; estado: FunilState }[]; derivados: Map<string, CenarioDerivado>; lucros: Map<string, ReturnType<typeof calcLucroBrutoPlano>>; melhorId: string | null
}) {
  const melhor = melhorId ? cenarios.find((c) => c.id === melhorId) : null
  const dMelhor = melhor ? derivados.get(melhor.id)! : null
  return (
    <>
      {melhor && dMelhor && (
        <div className="bg-gradient-to-br from-cyan-500/10 to-[#111827] border border-cyan-500/30 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4"><Star size={15} className="text-cyan-300" /><span className="text-xs font-semibold text-cyan-300">Melhor Performance · {melhor.nome}</span></div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Investimento" value={formatCurrency(melhor.estado.investimento)} />
            <Stat label="Vendas" value={formatNumber(dMelhor.totalIngressos)} />
            <Stat label="Fat. Front" value={formatCurrency(dMelhor.eventoSubtotal)} />
            <Stat label="Fat. Produto" value={formatCurrency(dMelhor.produtoSubtotal)} />
            <Stat label="ROAS" value={formatRoas(dMelhor.roas)} accent="text-cyan-300" />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {cenarios.map((c) => {
          const d = derivados.get(c.id)!; const l = lucros.get(c.id)!
          return (
            <div key={c.id} className={clsx('bg-[#111827] border rounded-2xl p-5', c.id === melhorId ? 'border-cyan-500/40' : 'border-[#1F2937]')}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-white">{c.nome}</span>
                {c.id === melhorId && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">melhor</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Linha label="CPA" value={formatCurrency(d.cpa)} /><Linha label="Vendas" value={formatNumber(d.totalIngressos)} />
                <Linha label="Ticket Médio" value={formatCurrency(d.ticketMedio)} /><Linha label="Fat. Front" value={formatCurrencyCompact(d.eventoSubtotal)} />
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
function Linha({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-gray-500">{label}</span><span className="text-gray-200 tabular-nums">{value}</span></div>
}

// ─────────────────────────────────────── Gráficos ─────────────────────────────
function GraficosTab({ cenarios, derivados }: { cenarios: { id: string; nome: string; ordem: number }[]; derivados: Map<string, CenarioDerivado> }) {
  const dataFat = cenarios.map((c, i) => ({ nome: c.nome, Faturamento: derivados.get(c.id)!.faturamentoTotal, fill: CHART_COLORS[i % CHART_COLORS.length] }))
  const dataRoas = cenarios.map((c, i) => ({ nome: c.nome, ROAS: Number(derivados.get(c.id)!.roas.toFixed(2)), fill: CHART_COLORS[i % CHART_COLORS.length] }))
  const dataCpa = cenarios.map((c, i) => ({ nome: c.nome, CPA: Number(derivados.get(c.id)!.cpa.toFixed(2)), fill: CHART_COLORS[i % CHART_COLORS.length] }))
  const base = cenarios.find((c) => c.ordem === 0) ?? cenarios[0]
  const dBase = base ? derivados.get(base.id)! : null
  const comp = dBase ? [
    { name: 'Front', value: dBase.faturamentoIngressos }, { name: 'OBs', value: dBase.eventoSubtotal - dBase.faturamentoIngressos },
    { name: 'Produto', value: dBase.produtoSubtotal },
  ].filter((x) => x.value > 0) : []
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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
  return <div className="bg-[#111827] border border-[#1F2937] rounded-2xl p-6"><h3 className="text-sm font-semibold text-white mb-4">{title}</h3>{children}</div>
}
function BarChartView({ data, dataKey, money }: { data: Record<string, unknown>[]; dataKey: string; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
        <XAxis dataKey="nome" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#1F2937' }} />
        <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#1F2937' }} tickFormatter={(v) => (money ? formatCurrencyCompact(v) : String(v))} />
        <Tooltip formatter={(v) => (money ? formatCurrency(Number(v)) : String(v))} contentStyle={{ background: '#0A0F1E', border: '1px solid #1F2937', borderRadius: 8, fontSize: 12 }} cursor={{ fill: '#ffffff08' }} />
        <Bar dataKey={dataKey} radius={[4, 4, 0, 0]}>{data.map((dd, i) => <Cell key={i} fill={(dd.fill as string) ?? '#06B6D4'} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────── Cenários ─────────────────────────────
function CenariosTab({ cenarios, derivados, lucros, melhorId, real, onAdd, onRemove }: {
  cenarios: { id: string; nome: string; ordem: number; kind: 'simulado' | 'real' }[]; derivados: Map<string, CenarioDerivado>; lucros: Map<string, ReturnType<typeof calcLucroBrutoPlano>>; melhorId: string | null
  real: CenarioReal; onAdd: () => void; onRemove: (cid: string) => void
}) {
  const cpaReal = real.analise.vendasFront > 0 ? real.investimento / real.analise.vendasFront : 0
  return (
    <Card title="Cenários" desc="Base, A, B + até 4 extras (simulados) e o Cenário Real (dados reais). Melhor ROAS simulado destacado.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[10px] uppercase tracking-wider text-gray-500 text-left">
            <th className="py-2 pr-3">Cenário</th><th className="py-2 px-3">CPA</th><th className="py-2 px-3">Vendas</th><th className="py-2 px-3">Faturamento</th><th className="py-2 px-3">Lucro</th><th className="py-2 px-3">ROAS</th><th className="py-2 pl-3"></th>
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

// ─────────────────────────────── Previsto × Realizado × Previsão ───────────────
function ComparacaoTab({ base, derivados, impostos, real, horizonte, checklist, onToggle, onRefresh }: {
  base: { id: string; estado: FunilState }; derivados: Map<string, CenarioDerivado>; impostos: ImpostoConfig; real: CenarioReal
  horizonte: { diasDecorridos: number; diasTotais: number }; checklist: Record<string, boolean>
  onToggle: (key: string) => void; onRefresh: () => void
}) {
  const previsto = snapshotPrevisto(derivados.get(base.id)!, base.estado.investimento, impostos)
  const linhas = buildComparacao(previsto, real, impostos, horizonte, checklist)
  const fmt = (key: string, val: number) => (key === 'roas' ? formatRoas(val) : key === 'vendas' ? formatNumber(val) : formatCurrency(val))
  return (
    <>
      {real.fonteInvestimento === 'sem_sigla' ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-200">
            <p className="font-medium">Investimento real não casado.</p>
            <p className="text-amber-200/80 mt-0.5">Defina uma <strong>sigla</strong> e use-a no nome da campanha/conjunto/anúncio do Meta para somar o investimento real automaticamente.</p>
          </div>
        </div>
      ) : (
        <div className="bg-[#111827] border border-[#1F2937] rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-[11px] text-gray-400">
          <span>Investimento real por sigla: <strong className="text-gray-200">{real.matchMeta.ads}</strong> anúncios · {formatCurrency(real.investimento)}</span>
          <button onClick={onRefresh} className="text-cyan-300 hover:text-cyan-200 cursor-pointer">atualizar agora</button>
        </div>
      )}
      <Card title="Previsto × Realizado × Previsão" desc="Previsto = cenário Base · Realizado = dados reais · Previsão = projeção do fim pelo pace. Receita realizada é projeção (Hotmart cai em D+1/D+2).">
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
              {linhas.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-gray-500 text-xs">Nenhuma métrica selecionada.</td></tr>}
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
        <p className="text-[10px] text-gray-500">Horizonte: {horizonte.diasDecorridos} de {horizonte.diasTotais || '—'} dias.</p>
      </Card>
    </>
  )
}
function DeltaPct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-gray-600 text-xs">—</span>
  const up = v >= 0
  return <span className={clsx('inline-flex items-center gap-0.5 text-xs tabular-nums', up ? 'text-emerald-400' : 'text-rose-400')}>{up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{Math.abs(v).toFixed(0)}%</span>
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
        <p className="text-xs text-gray-500">Registre pensamentos, decisões e aprendizados. A IA do dashboard lê estas notas.</p>
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black px-4 py-2 text-sm font-medium transition-colors cursor-pointer"><Plus size={15} /> Adicionar nota</button>
        </div>
      </Card>
      <div className="space-y-3">
        {notas.length === 0 && <p className="text-sm text-gray-500 text-center py-6">Nenhuma nota ainda.</p>}
        {notas.map((n) => (
          <div key={n.id} className="bg-[#111827] border border-[#1F2937] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-gray-500 tabular-nums">{(n.created_at || '').slice(0, 16).replace('T', ' ')}{n.autor_email ? ` · ${n.autor_email}` : ''}</span>
              <button onClick={() => onDel(n.id)} aria-label="Remover nota" title="Remover nota" className="text-gray-600 hover:text-rose-400 cursor-pointer"><Trash2 size={14} /></button>
            </div>
            <textarea defaultValue={n.corpo} rows={Math.min(8, Math.max(2, (n.corpo.match(/\n/g)?.length ?? 1) + 1))} onChange={(e) => onEdit(n.id, e.target.value)}
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
    const txt = ['📌 Lição aprendida', cenarioVencedor && `• Cenário vencedor: ${cenarioVencedor}`, metrica && `• Métrica-chave: ${metrica}`, gargalo && `• Gargalo: ${gargalo}`, proximo && `• Próximo passo: ${proximo}`].filter(Boolean).join('\n')
    if (!confirm('Registrar esta lição nas notas deste planejamento?')) return
    onSave(txt)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#0A0F1E] border border-[#1F2937] rounded-2xl p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2"><Lightbulb size={16} className="text-amber-300" /><h3 className="text-sm font-semibold text-white">Capturar lição aprendida</h3></div>
        <TextField label="Cenário vencedor" value={cenarioVencedor} onChange={setCenarioVencedor} placeholder="Ex: Cenário B" />
        <TextField label="Métrica-chave" value={metrica} onChange={setMetrica} placeholder="Ex: ROAS 3,2x · CPA R$48" />
        <TextField label="Gargalo / o que travou" value={gargalo} onChange={setGargalo} placeholder="Ex: connect rate baixo" />
        <TextField label="Próximo passo" value={proximo} onChange={setProximo} placeholder="Ex: testar 5 hooks novos" />
        <p className="text-[10px] text-gray-500">A lição é salva nas notas (e fica disponível para a IA).</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-xs text-gray-400 hover:text-white cursor-pointer">Cancelar</button>
          <button onClick={salvar} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 text-xs font-medium cursor-pointer"><Check size={14} /> Salvar lição</button>
        </div>
      </div>
    </div>
  )
}
