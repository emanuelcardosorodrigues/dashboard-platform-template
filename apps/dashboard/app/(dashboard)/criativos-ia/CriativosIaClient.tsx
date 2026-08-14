'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Search, Sparkles, X, SlidersHorizontal, Star, Plus, Pencil, Trash2, ChevronDown, ArrowUpDown } from 'lucide-react'
import { CriativoCard, METRIC_OPTIONS, DEFAULT_BARS, type MetricKey } from '@/components/CriativoCard'
import { TagAdder } from '@/components/criativos/TagAdder'
import { PadroesCampeoes } from '@/components/PadroesCampeoes'
import FilterBar from '@/components/filters/FilterBar'
import FilterFooter from '@/components/filters/FilterFooter'
import { useTableFilters } from '@/lib/useTableFilters'
import { applyFilter } from '@/lib/tableFilters'
import { CARD_FILTER_COLUMNS, CARD_AGGREGATES, CARD_CSV_COLUMNS, augmentForFilter } from '@/lib/criativosIaTableConfig'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import type { CriativoCard as Card } from '@/types/criativos'

// F3 — ChatsTab (766 linhas + deps de chat) só abre sob demanda; lazy-load tira
// esse peso do First Load JS da aba Criativos IA.
const ChatsTab = dynamic(() => import('./tabs/ChatsTab'), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-gray-500">Carregando chat…</div>,
})

// A consulta pesada e o Recharts só são baixados quando o usuário abre o histórico.
const HistoryPerformanceTab = dynamic(() => import('./tabs/HistoryPerformanceTab'), {
  ssr: false,
  loading: () => <div className="py-16 text-center text-sm text-text-secondary">Carregando histórico…</div>,
})

export type CreativeAnalysisTab = 'cards' | 'historico' | 'criativos' | 'insights'

const SUB_TABS: Array<{ id: CreativeAnalysisTab; label: string }> = [
  { id: 'cards', label: 'Criativos em Cards' },
  { id: 'historico', label: 'Histórico de Performance' },
  { id: 'criativos', label: 'Criativos' },
  { id: 'insights', label: 'Insights IA' },
]

// Catálogo COMPLETO de métricas de ordenação (todas disponíveis) com getter (suporta derivadas como Lucro).
type Metrica = { id: string; label: string; dir: 'asc' | 'desc'; get: (c: Card) => number | null }
const METRICAS: Metrica[] = [
  // c.roas é LÍQUIDO (após taxas Hotmart); c.roasBruto casa com o Gerenciador da Meta.
  { id: 'roasBruto', label: 'ROAS Bruto', dir: 'desc', get: (c) => c.roasBruto },
  { id: 'roas', label: 'ROAS Líq.', dir: 'desc', get: (c) => c.roas },
  { id: 'receita', label: 'Receita', dir: 'desc', get: (c) => c.receita },
  { id: 'lucro', label: 'Lucro', dir: 'desc', get: (c) => c.lucro },
  { id: 'vendas', label: 'Vendas', dir: 'desc', get: (c) => c.vendas },
  { id: 'investimento', label: 'Gasto', dir: 'desc', get: (c) => c.investimento },
  { id: 'impressoes', label: 'Impressões', dir: 'desc', get: (c) => c.impressoes },
  { id: 'hook_rate', label: 'Hook Rate', dir: 'desc', get: (c) => c.hook_rate },
  { id: 'hold_rate', label: 'Hold Rate', dir: 'desc', get: (c) => c.hold_rate },
  { id: 'ctr', label: 'CTR', dir: 'desc', get: (c) => c.ctr },
  // Conv. Body isola o MIOLO: de quem aguentou até os 75%, quantos compraram. Hook rate mede
  // o gancho; esta mede se a promessa do corpo converteu quem ficou.
  { id: 'conv_body', label: 'Conv. Body', dir: 'desc', get: (c) => c.conv_body },
  { id: 'conv_clique', label: 'Conv. Clique', dir: 'desc', get: (c) => c.conv_clique },
  { id: 'comentarios', label: 'Comentários', dir: 'desc', get: (c) => c.comentarios },
  { id: 'cpa', label: 'CPA (menor)', dir: 'asc', get: (c) => c.cpa },
  { id: 'cpc_link', label: 'CPC (menor)', dir: 'asc', get: (c) => c.cpc_link },
  { id: 'cpm', label: 'CPM (menor)', dir: 'asc', get: (c) => c.cpm },
  { id: 'custo_por_checkout', label: 'Custo/Checkout (menor)', dir: 'asc', get: (c) => c.custo_por_checkout },
]
const MET_BY_ID: Record<string, Metrica> = Object.fromEntries(METRICAS.map((m) => [m.id, m]))

// Grupos (abas). Os 3 primeiros são fixos; o usuário pode criar/editar/excluir os demais.
type Grupo = { id: string; nome: string; metricId: string; builtin?: boolean }
const GRUPOS_BUILTIN: Grupo[] = [
  { id: 'todos', nome: 'Todos', metricId: '', builtin: true },
  { id: 'ganchos', nome: 'Melhores ganchos', metricId: 'hook_rate', builtin: true },
  { id: 'roas', nome: 'Maiores ROAS', metricId: 'roas', builtin: true },
]

const ORDENAR_KEY = 'criativos-ia-ordenar'
const FAV_KEY = 'criativos-ia-fav-metricas'
const GRUPOS_KEY = 'criativos-ia-grupos'
const METRICAS_KEY = 'criativos-ia-metricas'
// chaves de métrica válidas p/ sanear o que vem do localStorage
const VALID_METRIC_KEYS = new Set<MetricKey>(METRIC_OPTIONS.map((o) => o.key))

function num(v: number | null, dir: 'asc' | 'desc'): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
}

// Linha do banco (criativo_grupos). A métrica de ordenação da aba mora em filtro.metricId.
type DbGrupo = { id: string; nome: string; tipo?: string; filtro?: { metricId?: string } | null; ordem?: number }
// Banco → modelo da UI. metricId inválido/ausente cai no default ('lucro') em vez de sumir.
function dbToGrupo(r: DbGrupo | null | undefined): Grupo | null {
  if (!r?.id || !r?.nome) return null
  const m = r.filtro?.metricId
  return { id: String(r.id), nome: r.nome, metricId: m && MET_BY_ID[m] ? m : 'lucro' }
}
function cacheGrupos(list: Grupo[]) {
  try { localStorage.setItem(GRUPOS_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}
function readLocalGrupos(): Grupo[] {
  try {
    const g = JSON.parse(localStorage.getItem(GRUPOS_KEY) || '[]')
    if (Array.isArray(g)) return g.filter((x) => x && x.id && x.nome && x.metricId) as Grupo[]
  } catch { /* ignore */ }
  return []
}

export default function CriativosIaClient({ initial, hideTabs = false }: { initial: Card[]; hideTabs?: boolean }) {
  // Filtros globais (Header/URL) — usados só pra passar ao PadroesCampeoes.
  const sp = useSearchParams()
  const router = useRouter()
  // B3 — no celular a toolbar colapsa; em md+ o hook devolve false e a UI é a atual.
  const isMobile = useIsMobile()
  const de = sp.get('de') ?? ''
  const ate = sp.get('ate') ?? ''
  const funil = sp.get('funil') ?? 'all'
  const conta = sp.get('conta') ?? 'all'
  const tabParam = sp.get('tab')
  const activeTab: CreativeAnalysisTab = SUB_TABS.some((tab) => tab.id === tabParam)
    ? tabParam as CreativeAnalysisTab
    : 'cards'
  const selectTab = (tab: CreativeAnalysisTab) => {
    const params = new URLSearchParams(sp.toString())
    // Cards é a visualização padrão; omitir mantém links antigos idênticos.
    if (tab === 'cards') params.delete('tab')
    else params.set('tab', tab)
    const query = params.toString()
    router.replace(query ? `?${query}` : '?', { scroll: false })
  }

  // Dados vêm PRONTOS do servidor (sem waterfall de fetch no cliente).
  const criativos = initial
  const [grupo, setGrupo] = useState<string>('todos')
  const [busca, setBusca] = useState('')
  // Ordenação padrão = ROAS; a escolha do usuário fica persistida (vira o padrão dele).
  const [ordenarId, setOrdenarId] = useState<string>('roas')
  const [ordOpen, setOrdOpen] = useState(false)
  // B3 (mobile) — accordion inline "Filtrar e ordenar"; começa fechado.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [favoritos, setFavoritos] = useState<string[]>([])
  const [grupos, setGrupos] = useState<Grupo[]>([])           // grupos customizados do usuário
  const [grupoModal, setGrupoModal] = useState<Grupo | 'novo' | null>(null)

  useEffect(() => {
    try {
      const s = localStorage.getItem(ORDENAR_KEY)
      if (s && MET_BY_ID[s]) setOrdenarId(s)
      const f = JSON.parse(localStorage.getItem(FAV_KEY) || '[]')
      if (Array.isArray(f)) setFavoritos(f.filter((x) => typeof x === 'string' && MET_BY_ID[x]))
      // seleção de métricas do rodapé do card (vira o padrão do usuário)
      const m = JSON.parse(localStorage.getItem(METRICAS_KEY) || 'null')
      if (Array.isArray(m)) {
        const valid = m.filter((x): x is MetricKey => typeof x === 'string' && VALID_METRIC_KEYS.has(x as MetricKey)).slice(0, 4)
        if (valid.length) setMetricas(valid)
      }
    } catch { /* ignore */ }
  }, [])

  // Grupos: BANCO é a fonte de verdade. Na 1a carga lê a API; se o banco vier
  // vazio E houver grupo no localStorage (legado por-navegador), importa uma vez
  // via POST e passa a usar o banco. API fora do ar → cai pro cache local.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const local = readLocalGrupos()
      try {
        const res = await fetch('/api/criativos/grupos')
        if (!res.ok) throw new Error(`grupos GET ${res.status}`)
        const data = await res.json()
        const rows: DbGrupo[] = Array.isArray(data?.grupos) ? data.grupos : []
        const mapped = rows.map(dbToGrupo).filter(Boolean) as Grupo[]

        if (mapped.length === 0 && local.length > 0) {
          // 1a carga: importa os grupos do localStorage para o banco (uma vez).
          const created = await Promise.all(
            local.map(async (g, i) => {
              try {
                const r = await fetch('/api/criativos/grupos', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ nome: g.nome, filtro: { metricId: g.metricId }, ordem: i }),
                })
                if (!r.ok) return null
                return dbToGrupo(await r.json())
              } catch { return null }
            })
          )
          const imported = created.filter(Boolean) as Grupo[]
          if (cancelled) return
          // import falhou pra todos → mantém o local como fallback (não perde os grupos)
          const next = imported.length > 0 ? imported : local
          setGrupos(next)
          cacheGrupos(next)
        } else {
          if (cancelled) return
          setGrupos(mapped)
          cacheGrupos(mapped) // mantém o cache local espelhando o banco
        }
      } catch {
        // API indisponível → usa o cache local para não quebrar a tela
        if (!cancelled) setGrupos(local)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Catálogo de tags do workspace (pro filtro por tag).
  useEffect(() => {
    fetch('/api/criativos/tags')
      .then((r) => r.json())
      .then((d) => setTagCatalog((d?.tags as { id: number; label: string; color: string | null }[]) ?? []))
      .catch(() => {})
  }, [])

  const pickOrdenar = (id: string) => {
    setOrdenarId(id)
    try { localStorage.setItem(ORDENAR_KEY, id) } catch { /* ignore */ }
  }
  const toggleFav = (id: string) => {
    setFavoritos((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  // localStorage vira cache/fallback; o banco é a verdade.
  const persistGrupos = (next: Grupo[]) => {
    setGrupos(next)
    cacheGrupos(next)
  }
  // Criar/editar: aplica otimista e persiste na API. Falha → rollback.
  async function salvarGrupo(g: Grupo) {
    const prev = grupos
    const existe = grupos.some((x) => x.id === g.id)
    setGrupoModal(null)

    if (existe) {
      persistGrupos(grupos.map((x) => (x.id === g.id ? g : x)))
      setGrupo(g.id)
      try {
        const r = await fetch('/api/criativos/grupos', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: g.id, nome: g.nome, filtro: { metricId: g.metricId } }),
        })
        if (!r.ok) throw new Error(`PUT ${r.status}`)
      } catch {
        persistGrupos(prev) // rollback
      }
      return
    }

    // Criar: id local temporário (g_...) até o banco devolver o uuid.
    persistGrupos([...grupos, g])
    setGrupo(g.id)
    try {
      const r = await fetch('/api/criativos/grupos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: g.nome, filtro: { metricId: g.metricId }, ordem: prev.length }),
      })
      if (!r.ok) throw new Error(`POST ${r.status}`)
      const saved = dbToGrupo(await r.json())
      if (saved) {
        // troca o grupo temporário pelo persistido (id do banco)
        setGrupos((cur) => {
          const next = cur.map((x) => (x.id === g.id ? saved : x))
          cacheGrupos(next)
          return next
        })
        setGrupo((cur) => (cur === g.id ? saved.id : cur))
      }
    } catch {
      persistGrupos(prev) // rollback: remove o grupo otimista
      setGrupo((cur) => (cur === g.id ? 'todos' : cur))
    }
  }
  // Excluir: aplica otimista e persiste na API. Falha → rollback.
  async function excluirGrupo(id: string) {
    const prev = grupos
    persistGrupos(grupos.filter((g) => g.id !== id))
    if (grupo === id) setGrupo('todos')
    setGrupoModal(null)
    try {
      const r = await fetch(`/api/criativos/grupos?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`DELETE ${r.status}`)
    } catch {
      persistGrupos(prev) // rollback
    }
  }

  const todosGrupos = useMemo(() => [...GRUPOS_BUILTIN, ...grupos], [grupos])
  // métricas ordenadas: favoritas primeiro (na ordem favoritada), depois o resto
  const metricasOrdenadas = useMemo(() => {
    const fav = favoritos.map((id) => MET_BY_ID[id]).filter(Boolean) as Metrica[]
    const resto = METRICAS.filter((m) => !favoritos.includes(m.id))
    return { fav, resto }
  }, [favoritos])

  const [chatOpen, setChatOpen] = useState(false)
  const [metricas, setMetricas] = useState<MetricKey[]>(DEFAULT_BARS)
  const [metricsOpen, setMetricsOpen] = useState(false)
  // Filtro por TAG (categórico) — casa se o card tem QUALQUER tag selecionada.
  const [tagCatalog, setTagCatalog] = useState<{ id: number; label: string; color: string | null }[]>([])
  const [tagFilter, setTagFilter] = useState<number[]>([])
  const [tagFilterOpen, setTagFilterOpen] = useState(false)
  // Seleção em lote (marcar vários cards → aplicar tags a todos de uma vez)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelect = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // Filtros avançados (mesma engine da aba Criativos) — persiste em ?f= / localStorage.
  const { filter: advFilter, setFilter: setAdvFilter } = useTableFilters({ storageKey: 'criativos-ia-filter' })

  function toggleMetrica(k: MetricKey) {
    setMetricas((prev) => {
      let next = prev
      if (prev.includes(k)) next = prev.length > 1 ? prev.filter((m) => m !== k) : prev
      else next = prev.length < 4 ? [...prev, k] : prev
      if (next !== prev) { try { localStorage.setItem(METRICAS_KEY, JSON.stringify(next)) } catch { /* ignore */ } }
      return next
    })
  }

  const visiveis = useMemo(() => {
    let arr = criativos.map(augmentForFilter)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      arr = arr.filter((c) => (c.ad_name || '').toLowerCase().includes(q) || (c.ad_id || '').includes(q))
    }
    // filtro por tag (manual/equipe/odin): card casa se tem QUALQUER tag selecionada.
    if (tagFilter.length) {
      arr = arr.filter((c) => ((c as unknown as Card).tags ?? []).some((t) => tagFilter.includes(t.id)))
    }
    // filtros avançados (investimento, ROAS, CPA, hook rate, etc.)
    arr = applyFilter(arr as unknown as Record<string, unknown>[], advFilter) as unknown as typeof arr
    // grupo 'todos' usa a ordenação escolhida; grupos (builtin ou custom) forçam a métrica deles.
    const grupoObj = todosGrupos.find((g) => g.id === grupo)
    const ordId = grupo === 'todos' ? ordenarId : (grupoObj?.metricId || ordenarId)
    const metrica = MET_BY_ID[ordId] ?? METRICAS[0]
    const dir = metrica.dir
    return [...arr].sort((a, b) => {
      const va = num(metrica.get(a as Card), dir)
      const vb = num(metrica.get(b as Card), dir)
      return dir === 'asc' ? va - vb : vb - va
    })
  }, [criativos, busca, grupo, ordenarId, advFilter, todosGrupos, tagFilter])

  const grupoObjRender = todosGrupos.find((g) => g.id === grupo)
  const ordIdAtivo = grupo === 'todos' ? ordenarId : (grupoObjRender?.metricId || ordenarId)

  // ad_ids (grupo) de todos os cards selecionados — alvo da aplicação de tag em lote.
  // Itera TODOS os criativos (não só os visíveis): se o usuário seleciona cards e
  // depois filtra, a barra continua mirando o que foi selecionado (senão aplicaria
  // a menos do que o contador mostra, ou o botão ficaria inerte).
  const selectedAdRefs = useMemo(() => {
    const s = new Set<string>()
    for (const card of criativos) {
      if (selected.has(card.ad_id)) for (const id of card.ad_ids ?? []) s.add(id)
    }
    return [...s]
  }, [criativos, selected])

  // ad_ids de TODOS os cards visíveis — passados ao chat p/ escopar o contexto do
  // portfólio. Só quando o filtro estreita o conjunto (senão o chat usa tudo).
  const portfolioAdRefs = useMemo<string[] | undefined>(() => {
    if (visiveis.length >= criativos.length) return undefined
    const s = new Set<string>()
    for (const c of visiveis) for (const id of (c as unknown as Card).ad_ids ?? []) s.add(id)
    return [...s]
  }, [visiveis, criativos.length])

  // Histórico recebe exatamente o mesmo conjunto que os Cards renderizariam.
  // `ad_ids` preserva todos os anúncios reunidos sob um mesmo nome de card.
  const visibleAdRefs = useMemo(() => {
    const ids = new Set<string>()
    for (const card of visiveis) {
      const refs = (card as Card).ad_ids
      if (refs?.length) refs.forEach((id) => ids.add(id))
      else if ((card as Card).ad_id) ids.add((card as Card).ad_id)
    }
    return [...ids]
  }, [visiveis])

  // A-F6 perf: renderiza só uma janela de cards e cresce ao rolar (IntersectionObserver).
  // ~400 cards de uma vez pesam no mount; 48 + incremento corta o DOM inicial sem
  // mudar layout. CSV/rodapé usam `visiveis` inteiro, então totais seguem certos.
  const PAGE = 48
  const [renderLimit, setRenderLimit] = useState(PAGE)
  useEffect(() => { setRenderLimit(PAGE) }, [visiveis])
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setRenderLimit((n) => Math.min(n + PAGE, visiveis.length)) },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visiveis.length])

  // ───────────────────────────────────────────────────────────────────────────
  // B3 — Toolbar colapsável no MOBILE (Onda 2). No celular a "parede de controles"
  // (abas de grupo + Ordenar + Métricas + Tags + FilterBar avançado) some atrás de
  // um botão "Filtrar e ordenar"; só a BUSCA fica sempre visível. Em md+ o
  // `useIsMobile()` devolve false → renderiza a toolbar ATUAL, byte a byte.
  // Os controles são os MESMOS render helpers nos dois layouts (zero divergência).
  // ───────────────────────────────────────────────────────────────────────────
  const advCount = advFilter.groups.reduce((sum, g) => sum + g.rules.length, 0)
  const nFiltros = advCount + tagFilter.length
  const sortLabel = MET_BY_ID[ordIdAtivo]?.label ?? 'ROAS'
  // Resuminho do estado ativo pro botão: métrica/grupo + nº de filtros (ex.: "ROAS Líq. · 2 filtros").
  const resumoFiltros = [
    grupo === 'todos' ? sortLabel : (grupoObjRender?.nome ?? sortLabel),
    nFiltros > 0 ? `${nFiltros} filtro${nFiltros !== 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ')
  const temFiltroAtivo = nFiltros > 0 || grupo !== 'todos'

  // Abas de grupo (3 fixos + custom, com criar/editar/excluir).
  const renderGruposTabs = () => (
    <div className="flex items-center gap-1 border-b border-border flex-wrap">
      {todosGrupos.map((g) => {
        const ativo = grupo === g.id
        return (
          <div key={g.id} className="flex items-center -mb-px">
            <button
              type="button"
              onClick={() => setGrupo(g.id)}
              className={`px-3 py-1.5 text-[12px] border-b-2 transition-colors ${
                ativo ? 'border-purple-400 text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {g.nome}
              {!g.builtin && <span className="ml-1 text-[9px] text-text-secondary">· {MET_BY_ID[g.metricId]?.label ?? g.metricId}</span>}
            </button>
            {!g.builtin && ativo && (
              <button type="button" onClick={() => setGrupoModal(g)} title="Editar grupo"
                className="text-text-secondary hover:text-purple-300 px-1 border-b-2 border-purple-400">
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        )
      })}
      <button type="button" onClick={() => setGrupoModal('novo')} title="Novo grupo de análise"
        className="ml-1 mb-0.5 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-dashed border-border text-text-secondary hover:text-purple-300 hover:border-purple-400/50 transition-colors">
        <Plus className="h-3 w-3" /> Grupo
      </button>
    </div>
  )

  // Busca — as classes de largura mudam por layout, mas o input é o MESMO nos dois
  // (desktop recebe exatamente o className atual: `flex-1 min-w-[180px] max-w-xs`).
  const searchBox = (extraCls: string) => (
    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-border bg-surface ${extraCls}`}>
      <Search className="h-3.5 w-3.5 text-text-secondary" />
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome ou ad_id..."
        className="bg-transparent text-[12px] text-text-primary placeholder:text-text-secondary outline-none w-full"
      />
    </div>
  )

  // Ordenar — dropdown custom: favoritas no topo (★ por usuário) + todas as métricas.
  const renderOrdenar = () => (
    <div className="relative flex items-center gap-1.5 text-[11px] text-text-secondary">
      Ordenar
      <button
        type="button"
        onClick={() => grupo === 'todos' && setOrdOpen((v) => !v)}
        disabled={grupo !== 'todos'}
        className="inline-flex items-center gap-1.5 bg-surface border border-border rounded-md px-2 py-1 text-text-primary text-[12px] disabled:opacity-50 hover:border-purple-400/40"
      >
        <ArrowUpDown className="h-3 w-3 text-text-secondary" />
        {MET_BY_ID[ordIdAtivo]?.label ?? 'ROAS'}
        {grupo === 'todos' && <ChevronDown className="h-3 w-3 text-text-secondary" />}
      </button>
      {ordOpen && grupo === 'todos' && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOrdOpen(false)} />
          <div className="absolute z-20 top-full mt-1 right-0 w-56 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-surface shadow-xl p-1">
            {metricasOrdenadas.fav.length > 0 && (
              <>
                <p className="text-[9px] uppercase tracking-wider text-text-secondary px-2 pt-1 pb-0.5">Favoritas</p>
                {metricasOrdenadas.fav.map((m) => <OrdenarRow key={m.id} m={m} ativo={ordenarId === m.id} fav onPick={() => { pickOrdenar(m.id); setOrdOpen(false) }} onFav={() => toggleFav(m.id)} />)}
                <div className="h-px bg-border my-1" />
              </>
            )}
            <p className="text-[9px] uppercase tracking-wider text-text-secondary px-2 pt-1 pb-0.5">Todas as métricas</p>
            {metricasOrdenadas.resto.map((m) => <OrdenarRow key={m.id} m={m} ativo={ordenarId === m.id} fav={false} onPick={() => { pickOrdenar(m.id); setOrdOpen(false) }} onFav={() => toggleFav(m.id)} />)}
          </div>
        </>
      )}
    </div>
  )

  // Métricas configuráveis (quais barras aparecem no card).
  const renderMetricas = () => (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMetricsOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-md border border-border bg-surface text-text-secondary hover:text-text-primary"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Métricas
        <span className="text-purple-300">{metricas.length}</span>
      </button>
      {metricsOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMetricsOpen(false)} />
          <div className="absolute z-20 mt-1 w-44 rounded-md border border-border bg-surface shadow-xl p-1">
            {METRIC_OPTIONS.map((m) => {
              const on = metricas.includes(m.key)
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleMetrica(m.key)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-[12px] text-left rounded hover:bg-bg-base/60"
                >
                  <span
                    className={`h-3.5 w-3.5 rounded border flex items-center justify-center ${
                      on ? 'bg-purple-500 border-purple-500' : 'border-border'
                    }`}
                  >
                    {on && <span className="text-[9px] text-white">✓</span>}
                  </span>
                  <span className={on ? 'text-text-primary' : 'text-text-secondary'}>{m.label}</span>
                </button>
              )
            })}
            <p className="text-[9px] text-text-secondary px-2 pt-1">1–4 métricas</p>
          </div>
        </>
      )}
    </div>
  )

  // Filtrar por TAG (manual/equipe/odin) — some se o workspace não tem tags.
  const renderTags = () => tagCatalog.length > 0 ? (
    <div className="relative">
      <button
        type="button"
        onClick={() => setTagFilterOpen((v) => !v)}
        className={`flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-md border bg-surface ${
          tagFilter.length ? 'border-purple-400/60 text-text-primary' : 'border-border text-text-secondary hover:text-text-primary'
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Tags
        {tagFilter.length > 0 && <span className="text-purple-300">{tagFilter.length}</span>}
      </button>
      {tagFilterOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setTagFilterOpen(false)} />
          <div className="absolute z-20 mt-1 w-52 max-h-[50vh] overflow-y-auto rounded-md border border-border bg-surface shadow-xl p-1">
            {tagFilter.length > 0 && (
              <button type="button" onClick={() => setTagFilter([])}
                className="w-full text-left text-[11px] px-2 py-1 text-text-secondary hover:text-purple-300">Limpar seleção</button>
            )}
            {tagCatalog.map((t) => {
              const on = tagFilter.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTagFilter((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-[12px] text-left rounded hover:bg-bg-base/60"
                >
                  <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center ${on ? 'bg-purple-500 border-purple-500' : 'border-border'}`}>
                    {on && <span className="text-[9px] text-white">✓</span>}
                  </span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color ?? '#8b5cf6' }} />
                  <span className={`truncate ${on ? 'text-text-primary' : 'text-text-secondary'}`}>{t.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  ) : null

  // Filtros avançados (mesma engine da aba Criativos).
  const renderFilterBar = () => (
    <FilterBar
      columns={CARD_FILTER_COLUMNS}
      filter={advFilter}
      setFilter={setAdvFilter}
      csvColumns={CARD_CSV_COLUMNS}
      csvRows={visiveis as unknown as Record<string, unknown>[]}
      csvFilename="analise-criativos.csv"
      hint={`${visiveis.length} de ${criativos.length} criativo${criativos.length !== 1 ? 's' : ''}`}
    />
  )

  return (
    <div className="space-y-4">
      {!hideTabs && <nav aria-label="Seções da Análise de Criativos" className="flex gap-1 overflow-x-auto border-b border-border">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${activeTab === tab.id ? 'border-purple-400 text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>}

      {/* Header do container */}
      {activeTab === 'cards' && <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Criativos em Cards</h2>
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md bg-purple-500/15 text-purple-200 border border-purple-500/30 hover:bg-purple-500/25 transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Analisar com Equipe
        </button>
      </div>}

      {/* ── DESKTOP (md+): toolbar ATUAL, byte a byte igual ──────────────────
          `isMobile` é false no SSR e em md+, então este ramo é o que o desktop
          sempre viu: abas de grupo, depois a toolbar (busca + Ordenar + Métricas
          + Tags), depois os filtros avançados — mesma ordem, mesmas classes. */}
      {(activeTab === 'cards' || activeTab === 'historico') && !isMobile && (
        <>
          {renderGruposTabs()}

          {/* Toolbar (sem filtro de data/funil — usa os globais do dashboard) */}
          <div className="flex items-center gap-3 flex-wrap">
            {searchBox('flex-1 min-w-[180px] max-w-xs')}
            {renderOrdenar()}
            {activeTab === 'cards' && renderMetricas()}
            {renderTags()}
          </div>

          {/* Filtros avançados (mesma engine da aba Criativos) — investimento, ROAS, CPA, hook rate... */}
          {renderFilterBar()}
        </>
      )}

      {/* ── MOBILE (< md): busca sempre visível + accordion "Filtrar e ordenar" ─
          B3: a "parede de controles" (abas de grupo + Ordenar + Métricas + Tags +
          FilterBar) colapsa atrás de um botão que resume o estado ativo. Accordion
          INLINE (sem sheet novo — o coordenador cuida do sheet global). */}
      {(activeTab === 'cards' || activeTab === 'historico') && isMobile && (
        <>
          {searchBox('w-full')}

          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className={`tap-target--body flex w-full items-center gap-2 px-3 rounded-md border bg-surface text-[13px] transition-colors ${
              temFiltroAtivo ? 'border-purple-400/60 text-text-primary' : 'border-border text-text-secondary'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className="font-medium shrink-0">Filtrar e ordenar</span>
            <span className="ml-1 truncate text-[12px] text-text-secondary">{resumoFiltros}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 ml-auto transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </button>

          {filtersOpen && (
            <div className="space-y-3 rounded-md border border-border/60 bg-bg-base/30 p-3">
              {renderGruposTabs()}
              <div className="flex items-center gap-3 flex-wrap">
                {renderOrdenar()}
                {activeTab === 'cards' && renderMetricas()}
                {renderTags()}
              </div>
              {renderFilterBar()}
            </div>
          )}
        </>
      )}

      {activeTab === 'cards' && <>
      {/* Padrões Campeões (maiores ROAS — p80) */}
      <PadroesCampeoes de={de} ate={ate} funil={funil} conta={conta} />

      {/* Estados */}
      {visiveis.length === 0 && (
        <p className="text-text-secondary text-sm py-12 text-center">
          {criativos.length === 0
            ? 'Nenhum criativo no período/funil selecionado.'
            : 'Nenhum criativo bate a busca/filtros avançados.'}
        </p>
      )}

      {/* Grid */}
      {visiveis.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {visiveis.slice(0, renderLimit).map((c, i) => (
              <CriativoCard
                key={c.ad_id}
                criativo={c}
                bars={metricas}
                selectable
                selected={selected.has(c.ad_id)}
                onToggleSelect={() => toggleSelect(c.ad_id)}
                // 3 primeiros = acima da dobra (1 col no mobile, 3 no xl): thumb
                // eager + prioridade alta. É o elemento LCP desta tela.
                priority={i < 3}
              />
            ))}
          </div>
          {renderLimit < visiveis.length && <div ref={sentinelRef} className="h-6" aria-hidden />}
          <FilterFooter
            rows={visiveis as unknown as Record<string, unknown>[]}
            specs={CARD_AGGREGATES}
            label={`Totais (${visiveis.length} criativo${visiveis.length !== 1 ? 's' : ''})`}
          />
        </>
      )}

      {/* Barra flutuante de seleção em lote (vários anúncios × várias tags de uma vez) */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-xl border border-border bg-surface shadow-2xl">
          <span className="text-[12px] text-text-primary font-medium">
            {selected.size} selecionado{selected.size !== 1 ? 's' : ''}
          </span>
          <TagAdder label="Aplicar tag" adRefs={selectedAdRefs} applied={[]} onApplied={() => router.refresh()} />
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[12px] text-text-secondary hover:text-text-primary"
          >
            Limpar
          </button>
        </div>
      )}

      {/* Drawer "Analisar com Equipe" */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setChatOpen(false)} />
          <div className="relative w-full max-w-2xl bg-bg-base border-l border-border h-full overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-bg-base z-10">
              <span className="flex items-center gap-2 text-sm font-semibold text-purple-200">
                <Sparkles className="h-4 w-4" /> Equipe — Analista de Criativos
              </span>
              <button onClick={() => setChatOpen(false)} className="text-text-secondary hover:text-text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <ChatsTab portfolioAdIds={portfolioAdRefs} />
            </div>
          </div>
        </div>
      )}
      </>}

      {activeTab === 'historico' && (
        <HistoryPerformanceTab de={de} ate={ate} funil={funil} conta={conta} adIds={visibleAdRefs} />
      )}

      {/* Modal criar/editar grupo de análise */}
      {(activeTab === 'cards' || activeTab === 'historico') && grupoModal && (
        <GrupoModal
          grupo={grupoModal === 'novo' ? null : grupoModal}
          onClose={() => setGrupoModal(null)}
          onSave={salvarGrupo}
          onDelete={excluirGrupo}
        />
      )}
    </div>
  )
}


// Linha do dropdown de ordenação: seleciona a métrica + estrela pra favoritar.
function OrdenarRow({ m, ativo, fav, onPick, onFav }: { m: Metrica; ativo: boolean; fav: boolean; onPick: () => void; onFav: () => void }) {
  return (
    <div className={`flex items-center gap-1 rounded ${ativo ? 'bg-purple-500/15' : 'hover:bg-bg-base/60'}`}>
      <button type="button" onClick={onPick} className={`flex-1 text-left px-2 py-1.5 text-[12px] ${ativo ? 'text-purple-200' : 'text-text-primary'}`}>
        {m.label}
      </button>
      <button type="button" onClick={onFav} title={fav ? 'Desfavoritar' : 'Favoritar'} className="px-1.5 py-1 text-text-secondary hover:text-yellow-300">
        <Star className="h-3.5 w-3.5" style={fav ? { fill: '#facc15', color: '#facc15' } : undefined} />
      </button>
    </div>
  )
}

// Modal de criação/edição de grupo (nome + métrica de ordenação).
function GrupoModal({ grupo, onClose, onSave, onDelete }: { grupo: Grupo | null; onClose: () => void; onSave: (g: Grupo) => void; onDelete: (id: string) => void }) {
  const [nome, setNome] = useState(grupo?.nome ?? '')
  const [metricId, setMetricId] = useState(grupo?.metricId ?? 'lucro')
  const editando = !!grupo
  function salvar() {
    const n = nome.trim()
    if (!n) { alert('Dê um nome ao grupo'); return }
    const id = grupo?.id ?? `g_${Date.now().toString(36)}`
    onSave({ id, nome: n, metricId })
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-text-primary">{editando ? 'Editar grupo' : 'Novo grupo de análise'}</h3>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-secondary">Nome do grupo</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Mais lucro"
            className="bg-bg-base border border-border rounded-md px-2.5 py-2 text-[13px] text-text-primary outline-none focus:border-purple-400/50" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-secondary">Analisar/ordenar por</span>
          <select value={metricId} onChange={(e) => setMetricId(e.target.value)}
            className="bg-bg-base border border-border rounded-md px-2.5 py-2 text-[13px] text-text-primary outline-none focus:border-purple-400/50">
            {METRICAS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <div className="flex items-center justify-between pt-1">
          {editando ? (
            <button type="button" onClick={() => { if (confirm('Excluir este grupo?')) onDelete(grupo!.id) }}
              className="inline-flex items-center gap-1 text-[12px] text-rose-400 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /> Excluir</button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary">Cancelar</button>
            <button type="button" onClick={salvar} className="px-3 py-1.5 text-[12px] rounded-md bg-purple-500 hover:bg-purple-400 text-white font-medium">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
