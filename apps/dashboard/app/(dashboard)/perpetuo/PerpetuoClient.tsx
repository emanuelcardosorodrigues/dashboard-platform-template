'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeMouseHandler,
  type EdgeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useRouter } from 'next/navigation'
import { Plus, Save, Loader2, Check, AlertTriangle, X, ChevronsLeftRight, Maximize2, RefreshCw, FlaskConical, LayoutGrid } from 'lucide-react'
import type { PeriodSummary } from '@/lib/periodSummary'
import type { CriativoAgregado } from '@/types'
import type { PerpetuoDetalhes } from '@/lib/perpetuoDetalhes'
import type { SbExperiment } from '@/lib/supabase'
import ExpandTable from '@/components/perpetuo/ExpandTable'
import NodeModal from '@/components/perpetuo/NodeModal'
import TestesPanel from '@/components/perpetuo/TestesPanel'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (v: number) => `${v.toFixed(2)}%`
const compact = (v: number) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)

// ─── B-P2: painel de ETAPA (a "bolinha" da conexão dos vídeos) ───────────────
type StageKey = 'pagina' | 'upsell' | 'ob'
const StageCtx = createContext<(k: StageKey) => void>(() => {})

const STAGE_META: Record<StageKey, (s: PeriodSummary) => { title: string; rows: { label: string; value: string }[] }> = {
  pagina: (s) => ({
    title: 'Tráfego → Página → Checkout',
    rows: [
      { label: 'Impressões', value: compact(s.impressoes) },
      { label: 'CPM', value: brl(s.cpm) },
      { label: 'CTR', value: pct(s.ctr) },
      { label: 'Cliques', value: compact(s.cliques) },
      { label: 'CPC', value: brl(s.cpc) },
      { label: 'Carregamento', value: pct(s.carregamento) },
      { label: 'Visitas (LP)', value: compact(s.landingViews) },
      { label: 'CPPV (real)', value: s.cppvRealizado > 0 ? brl(s.cppvRealizado) : '-' },
      { label: 'Conv. Página', value: pct(s.convPagina) },
      { label: 'Checkouts', value: compact(s.checkouts) },
      { label: 'Conv. Checkout', value: pct(s.conversaoCheckout) },
      { label: 'Vendas Front', value: compact(s.vendasFront) },
      { label: 'CPA', value: brl(s.cpa) },
    ],
  }),
  upsell: (s) => ({
    title: 'Produto → Upsell',
    rows: [
      { label: 'Taxa Upsell', value: pct(s.taxaUpsell) },
      { label: 'Vendas Upsell', value: compact(s.vendasUpsell) },
      { label: 'Taxa Downsell', value: pct(s.taxaDownsell) },
      { label: 'Vendas Downsell', value: compact(s.vendasDownsell) },
    ],
  }),
  ob: (s) => ({
    title: 'Order bumps',
    rows: [
      { label: 'Take Rate OB', value: pct(s.takeRateOB) },
      { label: 'OB1 / OB2 (vendas)', value: `${compact(s.vendasOB1)} / ${compact(s.vendasOB2)}` },
      { label: 'OB3 / OB4 (vendas)', value: `${compact(s.vendasOB3)} / ${compact(s.vendasOB4)}` },
      { label: 'Take OB1', value: pct(s.takeRateOB1) },
    ],
  }),
}

function StagePanel({ stageKey, summary, onClose, isMobile }: { stageKey: StageKey; summary: PeriodSummary; onClose: () => void; isMobile: boolean }) {
  const { title, rows } = STAGE_META[stageKey](summary)

  // MOBILE (E6): bottom-sheet full-width que sobe de baixo (~60svh), no lugar do
  // painel lateral de 300px que cobria a tela de 360px. Painel próprio md:hidden
  // (não usa o BottomSheet global, pra não colidir com outro agente). O `svh`
  // evita o "pulo" quando a barra do Safari reaparece; o md:hidden é rede de
  // segurança de CSS caso o hook demore um frame no limite do breakpoint.
  if (isMobile) {
    return (
      <>
        <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden />
        <div
          className="md:hidden fixed inset-x-0 bottom-0 z-50 flex flex-col h-[60svh] rounded-t-2xl bg-[#0f1420] border-t border-white/10 shadow-2xl"
          role="dialog"
          aria-label={title}
        >
          <div className="flex justify-center pt-2 pb-1" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-white/20" />
          </div>
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <button
              onClick={onClose}
              title="Fechar"
              aria-label="Fechar"
              className="tap-target--body -mr-2 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/5"
            >
              <X size={20} />
            </button>
          </div>
          <div
            className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
          >
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between text-[13px] border-b border-white/5 pb-2">
                <span className="text-white/45">{r.label}</span>
                <span className="text-white font-medium tabular-nums">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </>
    )
  }

  // DESKTOP (md+): painel lateral IDÊNTICO ao atual.
  return (
    <div className="absolute top-0 right-0 h-full w-[300px] bg-[#0f1420]/97 border-l border-white/10 shadow-2xl z-20 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-[#0f1420]">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <button onClick={onClose} title="Fechar" className="p-1 rounded text-white/50 hover:text-white hover:bg-white/5">
          <X size={16} />
        </button>
      </div>
      <div className="p-4 space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-[13px] border-b border-white/5 pb-1.5">
            <span className="text-white/45">{r.label}</span>
            <span className="text-white font-medium tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface FunnelNodeData extends Record<string, unknown> {
  title: string
  rows: { label: string; value: string }[]
  accent: string
  kind?: 'metric' | 'custom'
}
type FunnelNode = Node<FunnelNodeData>

// Nó custom (card escuro). Nós 'custom' (inseridos pelo usuário) podem não ter
// linhas; renomeáveis por duplo-clique (tratado no nível do ReactFlow).
function FunnelNodeView({ data, selected }: { data: FunnelNodeData; selected?: boolean }) {
  const isCustom = data.kind === 'custom'
  return (
    <div
      className={`rounded-xl border bg-[#0f1420]/95 shadow-xl min-w-[220px] ${
        selected ? 'border-purple-400' : 'border-white/10'
      } ${isCustom ? 'border-dashed' : ''}`}
      style={{ borderTop: `3px solid ${data.accent}` }}
    >
      <Handle type="target" position={Position.Left} className="!bg-purple-400 !border-none" />
      <div className="px-4 py-2.5 border-b border-white/10 text-sm font-semibold text-white flex items-center gap-2">
        {data.title}
        {isCustom && <span className="text-[9px] uppercase tracking-wide text-purple-300/70">custom</span>}
      </div>
      {data.rows.length > 0 ? (
        <div className="px-4 py-2.5 space-y-1.5">
          {data.rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between text-[13px]">
              <span className="text-white/45">{r.label}</span>
              <span className="text-white font-medium tabular-nums">{r.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-2.5 text-[11px] text-white/35">duplo-clique p/ renomear</div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-purple-400 !border-none" />
      <Handle type="source" position={Position.Bottom} id="b" className="!bg-amber-400 !border-none" />
    </div>
  )
}

const nodeTypes = { funnel: FunnelNodeView }
const edgeStyle = { stroke: '#a78bfa', strokeWidth: 1.5 }

// Aresta com a "bolinha" no meio (clique → painel de etapa). stageKey vem no data.
function StageEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const open = useContext(StageCtx)
  const isMobile = useIsMobile()
  const stageKey = (data as { stageKey?: StageKey } | undefined)?.stageKey
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {stageKey && (
        <EdgeLabelRenderer>
          {/* E6: alvo de 44px no mobile (h-11), 24px no desktop (h-6) — inalterado. */}
          <button
            type="button"
            className={`nodrag nopan absolute ${isMobile ? 'h-11 w-11' : 'h-6 w-6'} rounded-full bg-[#0f1420] border border-purple-400/50 text-purple-300 hover:bg-purple-500/30 hover:text-white flex items-center justify-center shadow-lg`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
            onClick={(e) => { e.stopPropagation(); open(stageKey) }}
            title="Ver métricas desta etapa"
          >
            <ChevronsLeftRight size={isMobile ? 18 : 12} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
const edgeTypes = { stage: StageEdge }

/** Dados métricos (frescos) por id de nó conhecido — reinjetados a cada load/período. */
function metricDataById(
  s: PeriodSummary,
  funilNome: string,
  cor: string,
  temUpsell: boolean,
  temOb: boolean
): Record<string, FunnelNodeData> {
  const map: Record<string, FunnelNodeData> = {
    trafego: {
      kind: 'metric',
      accent: '#64748b',
      title: 'Novo Tráfego',
      rows: [
        { label: 'Gasto', value: brl(s.investimento) },
        { label: 'CPM', value: brl(s.cpm) },
        { label: 'CTR', value: pct(s.ctr) },
      ],
    },
    produto: {
      kind: 'metric',
      accent: cor,
      title: funilNome,
      rows: [
        { label: 'Vendas', value: compact(s.vendasFront) },
        { label: 'Faturamento', value: brl(s.faturamento) },
        { label: 'Ticket Médio', value: brl(s.ticketMedio) },
      ],
    },
  }
  if (temUpsell) {
    map.upsell = {
      kind: 'metric',
      accent: '#a78bfa',
      title: 'Upsell',
      rows: [
        { label: 'Taxa Upsell', value: pct(s.taxaUpsell) },
        { label: 'Vendas', value: compact(s.vendasUpsell) },
        { label: 'Downsell', value: pct(s.taxaDownsell) },
      ],
    }
  }
  if (temOb) {
    map.ob = {
      kind: 'metric',
      accent: '#f59e0b',
      title: 'Order bumps',
      rows: [
        { label: 'Take Rate', value: pct(s.takeRateOB) },
        { label: 'Vendas', value: compact(s.vendasOB1 + s.vendasOB2 + s.vendasOB3 + s.vendasOB4) },
      ],
    }
  }
  return map
}

/** Layout default (usado quando não há grafo salvo). Posições fixas conhecidas. */
function defaultGraph(metric: Record<string, FunnelNodeData>, temUpsell: boolean, temOb: boolean) {
  const pos: Record<string, { x: number; y: number }> = {
    trafego: { x: 0, y: 130 },
    produto: { x: 340, y: 110 },
    upsell: { x: 700, y: 110 },
    ob: { x: 340, y: 360 },
  }
  const nodes: FunnelNode[] = [
    { id: 'trafego', type: 'funnel', position: pos.trafego, data: metric.trafego },
    { id: 'produto', type: 'funnel', position: pos.produto, data: metric.produto },
  ]
  const edges: Edge[] = [
    { id: 'e-tp', source: 'trafego', target: 'produto', type: 'stage', animated: true, style: edgeStyle, data: { stageKey: 'pagina' } },
  ]
  if (temUpsell && metric.upsell) {
    nodes.push({ id: 'upsell', type: 'funnel', position: pos.upsell, data: metric.upsell })
    edges.push({ id: 'e-pu', source: 'produto', target: 'upsell', type: 'stage', animated: true, style: edgeStyle, data: { stageKey: 'upsell' } })
  }
  if (temOb && metric.ob) {
    nodes.push({ id: 'ob', type: 'funnel', position: pos.ob, data: metric.ob })
    edges.push({ id: 'e-po', source: 'produto', sourceHandle: 'b', target: 'ob', type: 'stage', style: { stroke: '#f59e0b', strokeWidth: 1.5 }, data: { stageKey: 'ob' } })
  }
  return { nodes, edges }
}

type SaveStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error'

interface PerpetuoProps {
  funilSlug: string
  funilNome: string
  cor: string
  temUpsell: boolean
  temOb: boolean
  summary: PeriodSummary
  campanhas?: CriativoAgregado[]
  conjuntos?: CriativoAgregado[]
  anuncios?: CriativoAgregado[]
  detalhes?: PerpetuoDetalhes
  experimentos?: SbExperiment[]
}

function PerpetuoInner({ funilSlug, funilNome, cor, temUpsell, temOb, summary, campanhas, conjuntos, anuncios, detalhes, experimentos }: PerpetuoProps) {
  const router = useRouter()
  const metric = useMemo(
    () => metricDataById(summary, funilNome, cor, temUpsell, temOb),
    [summary, funilNome, cor, temUpsell, temOb]
  )
  const base = useMemo(() => defaultGraph(metric, temUpsell, temOb), [metric, temUpsell, temOb])

  const [nodes, setNodes, onNodesChange] = useNodesState<FunnelNode>(base.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(base.edges)
  const [status, setStatus] = useState<SaveStatus>('loading')
  const [err, setErr] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<StageKey | null>(null)
  const [expandOpen, setExpandOpen] = useState(false)
  const [nodeModal, setNodeModal] = useState<string | null>(null)
  const [view, setView] = useState<'geral' | 'testes'>('geral')
  const [refreshing, setRefreshing] = useState(false)
  const { getViewport } = useReactFlow()
  // E6 / contrato §0.1: editar o grafo é desktop. No mobile o canvas entra em
  // MODO LEITURA — navega (pan/zoom), lê a bolinha de etapa e o modal do nó, mas
  // não arrasta, não conecta e não apaga.
  const isMobile = useIsMobile()

  // "Atualizar": revalida os caches de dados no servidor e recarrega a rota.
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetch('/api/perpetuo/refresh', { method: 'POST' })
      router.refresh()
    } catch {
      /* best-effort — o router.refresh sozinho já repuxa o RSC */
      router.refresh()
    } finally {
      // pequeno atraso pra o spinner não piscar antes do RSC voltar
      setTimeout(() => setRefreshing(false), 600)
    }
  }, [router])

  // Esc fecha o fullscreen de expandir
  useEffect(() => {
    if (!expandOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandOpen])

  // 1) Carrega o layout salvo (uma vez por funil). Reinjeta métricas frescas nos
  //    nós conhecidos e mantém a posição salva; nós custom ficam intactos.
  useEffect(() => {
    let cancel = false
    setStatus('loading')
    ;(async () => {
      try {
        const res = await fetch(`/api/perpetuo/graph?funil=${encodeURIComponent(funilSlug)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (cancel) return
        const g = json.graph
        if (g && Array.isArray(g.nodes) && g.nodes.length) {
          const merged = (g.nodes as FunnelNode[]).map((n) => {
            const fresh = metric[n.id]
            return fresh ? { ...n, type: 'funnel', data: { ...fresh } } : { ...n, type: 'funnel' }
          })
          setNodes(merged)
          setEdges(Array.isArray(g.edges) ? (g.edges as Edge[]) : [])
        } else {
          // funil SEM layout salvo → reseta pro default DESTE funil. Sem isso, ao
          // trocar de funil o componente NÃO remonta (mesmo pathname) e herdaria os
          // nós/custom do funil anterior — e "Salvar" gravaria a topologia errada.
          setNodes(base.nodes)
          setEdges(base.edges)
        }
      } catch {
        // erro de fetch → também reseta pro default do funil atual (não deixa stale)
        if (!cancel) {
          setNodes(base.nodes)
          setEdges(base.edges)
        }
      } finally {
        if (!cancel) setStatus('idle')
      }
    })()
    return () => {
      cancel = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funilSlug])

  // 2) Período mudou (mesmo funil, sem recarregar) → atualiza só os dados dos nós
  //    métricos, preservando posição e nós custom.
  useEffect(() => {
    setNodes((cur) =>
      cur.map((n) => {
        const fresh = metric[n.id]
        return fresh ? { ...n, data: { ...fresh } } : n
      })
    )
  }, [metric, setNodes])

  const onConnect = useCallback(
    (c: Connection) => setEdges((e) => addEdge({ ...c, animated: true, style: edgeStyle }, e)),
    [setEdges]
  )

  const onInsert = useCallback(() => {
    const id = `custom-${globalThis.crypto?.randomUUID?.() ?? Math.round(performance.now())}`
    const vp = getViewport()
    // centro aproximado do canvas em coordenadas de fluxo
    const cx = (-vp.x + 260) / vp.zoom
    const cy = (-vp.y + 180) / vp.zoom
    setNodes((n) => [
      ...n,
      { id, type: 'funnel', position: { x: cx, y: cy }, data: { title: 'Novo nó', rows: [], accent: '#8b5cf6', kind: 'custom' } },
    ])
  }, [getViewport, setNodes])

  // duplo-clique num nó custom → renomeia
  const onNodeDoubleClick = useCallback<NodeMouseHandler<FunnelNode>>(
    (_e, node) => {
      if (node.data.kind !== 'custom') return
      const novo = window.prompt('Nome do nó', node.data.title)
      if (novo == null) return
      setNodes((cur) => cur.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, title: novo || 'Novo nó' } } : n)))
    },
    [setNodes]
  )

  // clique num nó métrico → modal com os detalhes do funil (série/origem/página/…)
  const onNodeClick = useCallback<NodeMouseHandler<FunnelNode>>(
    (_e, node) => {
      if (node.data.kind === 'custom' || !detalhes) return
      setNodeModal(node.data.title)
    },
    [detalhes]
  )

  const onSave = useCallback(async () => {
    setStatus('saving')
    setErr(null)
    try {
      const res = await fetch('/api/perpetuo/graph', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ funil: funilSlug, nodes, edges, viewport: getViewport() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 1600)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [funilSlug, nodes, edges, getViewport])

  return (
    <StageCtx.Provider value={setActiveStage}>
    <div className="relative h-full w-full bg-[#0a0f1e]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={isMobile ? undefined : onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={isMobile ? undefined : onNodeDoubleClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={!isMobile}
        nodesConnectable={!isMobile}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        deleteKeyCode={isMobile ? null : ['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e2536" />
        <Controls className="!bg-[#0f1420] !border-white/10 !shadow-xl" />

        {isMobile ? (
          // MOBILE (E6): só o essencial de LEITURA — sem "Inserir nó" nem "Salvar
          // layout". Empilhado e com flex-wrap pra nunca estourar na horizontal;
          // alvos de 44px (.tap-target--body).
          <Panel position="top-left" className="!m-2 flex flex-col gap-2 items-start max-w-[calc(100vw-1rem)]">
            {/* Toggle Visão Geral / Testes */}
            <div className="inline-flex items-center rounded-lg bg-[#0f1420]/95 border border-white/10 p-0.5 backdrop-blur">
              <button
                onClick={() => setView('geral')}
                className={`tap-target--body inline-flex items-center gap-1 text-[12px] px-3 rounded-md transition-colors ${view === 'geral' ? 'bg-purple-500/20 text-purple-200' : 'text-white/55'}`}
              >
                <LayoutGrid size={14} /> Visão Geral
              </button>
              <button
                onClick={() => setView('testes')}
                className={`tap-target--body inline-flex items-center gap-1 text-[12px] px-3 rounded-md transition-colors ${view === 'testes' ? 'bg-purple-500/20 text-purple-200' : 'text-white/55'}`}
              >
                <FlaskConical size={14} /> Testes{experimentos && experimentos.length ? ` (${experimentos.length})` : ''}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onRefresh}
                disabled={refreshing}
                title="Atualizar: recarrega os dados mais recentes"
                className="tap-target--body inline-flex items-center gap-1.5 text-[13px] px-3 rounded-lg bg-[#0f1420]/95 border border-white/10 text-white/80 backdrop-blur disabled:opacity-50"
              >
                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Atualizar
              </button>
              <button
                onClick={() => setExpandOpen(true)}
                title="Expandir: Campanhas / Conjuntos / Anúncios / Criativos"
                className="tap-target--body inline-flex items-center gap-1.5 text-[13px] px-3 rounded-lg bg-[#0f1420]/95 border border-white/10 text-white/80 backdrop-blur"
              >
                <Maximize2 size={16} /> Expandir
              </button>
            </div>
          </Panel>
        ) : (
          <Panel position="top-left" className="!m-3 flex items-center gap-2">
            <button
              onClick={onInsert}
              className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg bg-[#0f1420] border border-white/10 text-white/80 hover:text-white hover:border-purple-400/40"
            >
              <Plus size={14} /> Inserir nó
            </button>
            <button
              onClick={onSave}
              disabled={status === 'saving' || status === 'loading'}
              className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-400/40 text-purple-200 hover:bg-purple-500/30 disabled:opacity-50"
            >
              {status === 'saving' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : status === 'saved' ? (
                <Check size={14} className="text-emerald-400" />
              ) : (
                <Save size={14} />
              )}
              {status === 'saving' ? 'Salvando…' : status === 'saved' ? 'Salvo' : 'Salvar layout'}
            </button>
            <button
              onClick={() => setExpandOpen(true)}
              title="Expandir: Campanhas / Conjuntos / Anúncios / Criativos"
              className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg bg-[#0f1420] border border-white/10 text-white/80 hover:text-white hover:border-purple-400/40"
            >
              <Maximize2 size={14} /> Expandir
            </button>
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title="Atualizar: recarrega os dados mais recentes (o sync do Meta roda de hora em hora)"
              className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg bg-[#0f1420] border border-white/10 text-white/80 hover:text-white hover:border-purple-400/40 disabled:opacity-50"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Atualizar
            </button>

            {/* Toggle Visão Geral / Testes */}
            <div className="inline-flex items-center rounded-lg bg-[#0f1420] border border-white/10 p-0.5">
              <button
                onClick={() => setView('geral')}
                className={`inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md transition-colors ${view === 'geral' ? 'bg-purple-500/20 text-purple-200' : 'text-white/55 hover:text-white'}`}
              >
                <LayoutGrid size={13} /> Visão Geral
              </button>
              <button
                onClick={() => setView('testes')}
                className={`inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md transition-colors ${view === 'testes' ? 'bg-purple-500/20 text-purple-200' : 'text-white/55 hover:text-white'}`}
              >
                <FlaskConical size={13} /> Testes{experimentos && experimentos.length ? ` (${experimentos.length})` : ''}
              </button>
            </div>
            {status === 'error' && err && (
              <span className="inline-flex items-center gap-1 text-[11px] text-rose-300">
                <AlertTriangle size={12} /> {err}
              </span>
            )}
            <span className="text-[11px] text-white/35 ml-1">arraste · conecte · Delete apaga · duplo-clique renomeia · clique na bolinha da conexão</span>
          </Panel>
        )}
      </ReactFlow>
      {activeStage && <StagePanel stageKey={activeStage} summary={summary} onClose={() => setActiveStage(null)} isMobile={isMobile} />}
      {view === 'testes' && <TestesPanel experimentos={experimentos ?? []} onClose={() => setView('geral')} />}
    </div>
    {expandOpen && (
      <ExpandTable
        campanhas={campanhas ?? []}
        conjuntos={conjuntos ?? []}
        anuncios={anuncios ?? []}
        funilSlug={funilSlug}
        onClose={() => setExpandOpen(false)}
      />
    )}
    {nodeModal && detalhes && (
      <NodeModal title={nodeModal} detalhes={detalhes} onClose={() => setNodeModal(null)} />
    )}
    </StageCtx.Provider>
  )
}

export default function PerpetuoClient(props: PerpetuoProps) {
  return (
    <ReactFlowProvider>
      <PerpetuoInner {...props} />
    </ReactFlowProvider>
  )
}
