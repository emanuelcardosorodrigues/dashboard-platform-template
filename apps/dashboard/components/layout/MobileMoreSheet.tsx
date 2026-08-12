'use client'

/**
 * A1 — Sheet "Mais" do bottom-nav (plano UX mobile v2, Onda 2).
 *
 * O 5º slot do MobileBottomNav abre ESTE sheet: um hub deliberado (não um
 * "More tab" de overflow acidental) com busca + as pastas de navegação. Reusa o
 * BottomSheet reutilizável (detent 50→85svh, grabber, handoff de gesto, Esc,
 * scroll-lock), então aqui só vive o CONTEÚDO.
 *
 * Fonte da verdade da navegação = components/layout/Sidebar.tsx (NAV_GROUPS).
 * Aqui ela é DUPLICADA em forma mínima (label + href + ícone) de propósito:
 * evita tocar no Sidebar (que outro agente pode estar editando) e não cria uma
 * dependência de import cruzado no meio de uma refatoração paralela.
 * TODO(coordenador): quando a poeira baixar, extrair esta lista + a do Sidebar
 * para um módulo compartilhado (ex.: lib/nav.ts) e importar nos dois — hoje são
 * DOIS lugares pra manter em sincronia.
 *
 * allowed_paths: o filtro é aplicado SÓ quando a lista chega por prop. Quando
 * `undefined` (caso atual — o layout monta <MobileBottomNav/> sem props), mostra
 * tudo: o gate real é server-side (proxy.ts + /api/ai/ask), então revelar um
 * link que o usuário não pode ver não concede acesso — só evita esconder à toa.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  LayoutDashboard,
  PlayCircle,
  Sparkles,
  Megaphone,
  Workflow,
  Video,
  Filter,
  FileBarChart,
  Rocket,
  GitCompare,
  UserSearch,
  MessageCircle,
  Brain,
  Users,
  Gauge,
  LayoutGrid,
  SquarePlay,
  Camera,
  Music2,
  TrendingUp,
  Target,
  FlaskConical,
  HelpCircle,
  Captions,
  MessagesSquare,
  ShieldAlert,
  Activity,
  BarChart2,
  FileText,
  DollarSign,
  Crosshair,
  Calculator,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { clsx } from 'clsx'
import BottomSheet from '@/components/ui/BottomSheet'
import { isPathAllowed, type Role } from '@/lib/auth'

interface MoreItem { href: string; label: string; icon: LucideIcon }
interface MoreGroup { id: string; label: string; items: MoreItem[] }

// ── Cópia mínima de Sidebar.NAV_GROUPS (ver nota no topo). ──────────────────
const VISAO_GERAL: MoreItem = { href: '/visao-geral', label: 'Visão Geral', icon: LayoutDashboard }

const GROUPS: MoreGroup[] = [
  {
    id: 'metricas', label: 'Métricas', items: [
      { href: '/calculadora', label: 'Calculadora', icon: Calculator },
      { href: '/criativos', label: 'Criativos', icon: PlayCircle },
      { href: '/criativos-ia', label: 'Análise de Criativos', icon: Sparkles },
      { href: '/insights-ia', label: 'Insights IA', icon: Sparkles },
      { href: '/campanhas', label: 'Campanhas', icon: Megaphone },
      { href: '/perpetuo', label: 'Perpétuo', icon: Workflow },
      { href: '/vsl', label: 'VSLs', icon: Video },
      { href: '/funil', label: 'Funil', icon: Filter },
      { href: '/analise-paginas', label: 'Análise de Páginas', icon: FileBarChart },
      { href: '/acoes-vendas', label: 'Ações de Vendas', icon: Rocket },
      { href: '/comparacao', label: 'Comparação', icon: GitCompare },
    ],
  },
  {
    id: 'publico', label: 'Público', items: [
      { href: '/perfil-comprador', label: 'Perfil do Comprador', icon: UserSearch },
      { href: '/voz-comprador', label: 'Voz do Comprador', icon: MessageCircle },
      { href: '/analise-estrategica', label: 'Análise Estratégica', icon: Brain },
      { href: '/qualificacao', label: 'Qualificação', icon: Users },
      { href: '/lead-scoring', label: 'Lead Scoring', icon: Gauge },
    ],
  },
  {
    id: 'organico', label: 'Orgânico', items: [
      { href: '/organico/visao-geral', label: 'Visão Geral', icon: Gauge },
      { href: '/organico/conteudo', label: 'Análise de Conteúdo', icon: LayoutGrid },
      { href: '/organico/youtube', label: 'YouTube', icon: SquarePlay },
      { href: '/organico/instagram', label: 'Instagram', icon: Camera },
      { href: '/organico/tiktok', label: 'TikTok', icon: Music2 },
      { href: '/organico/comentarios', label: 'Análises de Comentários', icon: MessageCircle },
      { href: '/organico/inteligencia-de-conteudo', label: 'Inteligência de Conteúdo', icon: TrendingUp },
      { href: '/organico/insights', label: 'Insights IA', icon: Sparkles },
    ],
  },
  {
    id: 'ferramentas', label: 'Ferramentas', items: [
      { href: '/planejamento', label: 'Planejamento de Ação de Vendas', icon: Target },
      { href: '/experimentos', label: 'Experimentos', icon: FlaskConical },
      { href: '/quizzes', label: 'Quizzes', icon: HelpCircle },
      { href: '/organico/transcricoes', label: 'Transcrições de Links', icon: Captions },
      { href: '/organico/extrair-comentarios', label: 'Extrair Comentários', icon: MessagesSquare },
      { href: '/saude-trafego', label: 'Saúde do Tráfego', icon: ShieldAlert },
      { href: '/clarity', label: 'Clarity', icon: Activity },
      { href: '/ga4', label: 'GA4', icon: BarChart2 },
      { href: '/notas-fiscais', label: 'Notas Fiscais', icon: FileText },
    ],
  },
]

// Itens soltos (sem pasta), abaixo das pastas — espelha STANDALONE_BELOW.
const STANDALONE: MoreItem[] = [
  { href: '/financeiro', label: 'Financeiro', icon: DollarSign },
  { href: '/raio-x', label: 'Raio-X da Escala', icon: Crosshair },
]

// Normaliza pra busca sem acento/caixa: "análise" casa com "analise".
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

interface MobileMoreSheetProps {
  open: boolean
  onClose: () => void
  /** allowed_paths do usuário. `undefined` = mostra tudo (gate real é server-side). */
  allowedPaths?: readonly string[]
  role?: Role | null
}

export default function MobileMoreSheet({ open, onClose, allowedPaths, role }: MobileMoreSheetProps) {
  const pathname = usePathname() ?? ''
  const [query, setQuery] = useState('')

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  // Filtro por permissão: aplica só quando allowed_paths existe e o user não é
  // admin. Sem a lista, `canSee` é sempre true (undefined = ALL compat).
  const canSee = (href: string) =>
    role === 'admin' || !allowedPaths || isPathAllowed(allowedPaths, href)

  // Pastas visíveis + Visão Geral no topo + soltos no fim, já filtrados por permissão.
  const permittedGroups = useMemo<MoreGroup[]>(() => {
    const head: MoreGroup = { id: 'inicio', label: 'Início', items: [VISAO_GERAL].filter(i => canSee(i.href)) }
    const mids = GROUPS
      .map(g => ({ ...g, items: g.items.filter(i => canSee(i.href)) }))
      .filter(g => g.items.length > 0)
    const tail: MoreGroup = { id: 'outros', label: 'Outros', items: STANDALONE.filter(i => canSee(i.href)) }
    return [head, ...mids, tail].filter(g => g.items.length > 0)
    // canSee depende de allowedPaths/role; recalcula quando eles mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedPaths, role])

  // Busca: filtra os itens de cada pasta pelo label normalizado. Pasta vazia some.
  const groups = useMemo<MoreGroup[]>(() => {
    const q = norm(query)
    if (!q) return permittedGroups
    return permittedGroups
      .map(g => ({ ...g, items: g.items.filter(i => norm(i.label).includes(q)) }))
      .filter(g => g.items.length > 0)
  }, [permittedGroups, query])

  const Row = ({ item }: { item: MoreItem }) => {
    const Icon = item.icon
    const active = isActive(item.href)
    return (
      <li>
        <Link
          href={item.href}
          onClick={onClose}
          // Alvo min-h-14 (≥ .tap-target--edge de 48px); gap-1 entre linhas evita rage tap.
          className={clsx(
            'tap-target--edge flex min-h-14 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
            active
              ? 'bg-purple-500/15 font-medium text-purple-300'
              : 'text-gray-300 hover:bg-[#1F2937] hover:text-white',
          )}
        >
          <Icon size={18} className="shrink-0" />
          <span className="truncate">{item.label}</span>
        </Link>
      </li>
    )
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Mais">
      {/* Busca — SEM autofocus (E7b): o teclado abriria por cima do sheet no
          instante da abertura. text-base (16px) evita o zoom automático do iOS. */}
      <div className="relative mb-3">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar seção..."
          aria-label="Buscar seção"
          className="w-full rounded-lg border border-[#1F2937] bg-[#111827] py-3 pl-9 pr-9 text-base text-white placeholder:text-gray-500 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Limpar busca"
            className="tap-target--body absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center px-2 text-gray-500 hover:text-white"
          >
            Limpar
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-gray-500">
          Nenhuma seção encontrada para “{query}”.
        </p>
      ) : (
        <nav aria-label="Navegação completa" className="space-y-4">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map(item => <Row key={item.href} item={item} />)}
              </ul>
            </div>
          ))}
        </nav>
      )}
    </BottomSheet>
  )
}
