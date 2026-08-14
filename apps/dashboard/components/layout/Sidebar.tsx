'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import WorkspaceSwitcher, { type WorkspaceLite } from './WorkspaceSwitcher'
import {
  LayoutDashboard,
  Calculator,
  Video,
  Megaphone,
  Users,
  Filter,
  DollarSign,
  UserSearch,
  MessageCircle,
  Brain,
  Sparkles,
  FlaskConical,
  HelpCircle,
  FileText,
  ShieldAlert,
  GitCompare,
  Activity,
  BarChart2,
  FileBarChart,
  Gauge,
  Rocket,
  Target,
  Crosshair,
  Pin,
  PinOff,
  RefreshCw,
  ExternalLink,
  LogOut,
  Settings,
  ChevronDown,
  TrendingUp,
  Wrench,
  Leaf,
  SquarePlay,
  Camera,
  Music2,
  LayoutGrid,
  Captions,
  Menu,
  MessagesSquare,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { logoutAction } from '@/app/login/actions'
import { syncAllAction } from '@/app/actions/syncMeta'
import { clsx } from 'clsx'
import {
  canAccessCreativeAnalysis,
  creativeAnalysisHrefForAllowedPaths,
  isPathAllowed,
  type Role,
} from '@/lib/auth'

interface NavItem { href: string; label: string; icon: LucideIcon }
interface NavGroup { id: string; label: string; icon: LucideIcon; items: NavItem[] }

// Visão Geral fica solta no topo (não entra em pasta).
const VISAO_GERAL: NavItem = { href: '/visao-geral', label: 'Visão Geral', icon: LayoutDashboard }

// Ordem e agrupamento definidos pelo usuário. Itens não citados originalmente
// (Financeiro, Raio-X → Métricas; Notas Fiscais → Ferramentas) posicionados por proposta.
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'metricas', label: 'Métricas', icon: TrendingUp, items: [
      { href: '/calculadora', label: 'Calculadora', icon: Calculator },
      { href: '/criativos-ia', label: 'Análise de Criativos', icon: Sparkles },
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
    id: 'publico', label: 'Público', icon: Users, items: [
      { href: '/perfil-comprador', label: 'Perfil do Comprador', icon: UserSearch },
      { href: '/voz-comprador', label: 'Voz do Comprador', icon: MessageCircle },
      { href: '/analise-estrategica', label: 'Análise Estratégica', icon: Brain },
      { href: '/qualificacao', label: 'Qualificação', icon: Users },
      { href: '/lead-scoring', label: 'Lead Scoring', icon: Gauge },
    ],
  },
  {
    id: 'organico', label: 'Orgânico', icon: Leaf, items: [
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
    id: 'ferramentas', label: 'Ferramentas', icon: Wrench, items: [
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

// Itens sem pasta natural — ficam soltos ABAIXO das pastas (decisão do usuário).
const STANDALONE_BELOW: NavItem[] = [
  { href: '/financeiro', label: 'Financeiro', icon: DollarSign },
  { href: '/raio-x', label: 'Raio-X da Escala', icon: Crosshair },
]

const ADMIN_NAV_ITEM: NavItem = { href: '/admin', label: 'Administração', icon: Settings }

export default function Sidebar({
  role,
  allowedPaths,
  dataFreshness,
  activeWorkspace = null,
  workspaces = [],
}: {
  role: Role | null
  allowedPaths: readonly string[]
  dataFreshness?: string | null
  activeWorkspace?: WorkspaceLite | null
  workspaces?: WorkspaceLite[]
}) {
  const isViewer = role === 'viewer'
  const isAdmin = role === 'admin'
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false) // drawer em telas < md (touch, sem hover)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  // Navegar fecha o drawer mobile (a rota muda → esconde o overlay).
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Estado das pastas persistido em localStorage. Lê no mount (evita mismatch de hidratação).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sidebar-groups')
      if (raw) setCollapsedGroups(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])

  function toggleGroup(id: string) {
    setCollapsedGroups(prev => {
      const next = { ...prev, [id]: !prev[id] }
      try { localStorage.setItem('sidebar-groups', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const result = await syncAllAction()
      const okJobs = result.jobs.filter(j => j.ok).length
      const total = result.jobs.length
      if (!result.ok) {
        const fail = result.jobs.find(j => !j.ok)
        const reason = result.error ?? fail?.error ?? 'erro'
        setSyncMsg(`${okJobs}/${total} ok — ${reason}`)
        return
      }
      setSyncMsg(`✓ ${okJobs}/${total} jobs · ${result.total} registros`)
      // refresh() re-busca os server components sem full reload (o toast permanece visível)
      router.refresh()
    } catch {
      setSyncMsg('Erro')
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(''), 5000)
    }
  }

  const de = searchParams.get('de') ?? ''
  const ate = searchParams.get('ate') ?? ''
  const funil = searchParams.get('funil') ?? 'all'
  const conta = searchParams.get('conta') ?? ''

  // No desktop, expande por hover/pin. No mobile (drawer aberto), sempre expandido.
  const expanded = pinned || hovered || mobileOpen
  const freshnessLabel = dataFreshness
    ? new Date(dataFreshness).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    : null

  const canSee = (href: string) =>
    isAdmin || (href === '/criativos-ia'
      ? canAccessCreativeAnalysis(allowedPaths)
      : isPathAllowed(allowedPaths, href))
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')
  const linkHref = (href: string) => {
    const target = href === '/criativos-ia' && !isAdmin
      ? creativeAnalysisHrefForAllowedPaths(allowedPaths)
      : href
    const url = new URL(target, 'https://dashboard.local')
    if (de) url.searchParams.set('de', de)
    if (ate) url.searchParams.set('ate', ate)
    url.searchParams.set('funil', funil)
    if (conta && conta !== 'all') url.searchParams.set('conta', conta)
    return `${url.pathname}?${url.searchParams.toString()}`
  }

  // Item de navegação (reaproveitado por Visão Geral, itens de pasta e Admin).
  const NavLinkItem = ({ item }: { item: NavItem }) => {
    const Icon = item.icon
    const active = isActive(item.href)
    return (
      <li>
        <Link
          href={linkHref(item.href)}
          title={!expanded ? item.label : undefined}
          className={clsx(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-200 cursor-pointer',
            active
              ? 'bg-cyan-500/15 text-cyan-400 font-medium'
              : 'text-gray-400 hover:text-white hover:bg-[#1F2937]',
            !expanded && 'justify-center px-2'
          )}
        >
          <Icon size={18} className="shrink-0" />
          <span className={clsx(
            'truncate transition-all duration-200 whitespace-nowrap',
            expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0 overflow-hidden'
          )}>
            {item.label}
          </span>
        </Link>
      </li>
    )
  }

  const visibleGroups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => canSee(i.href)) }))
    .filter(g => g.items.length > 0)

  const standaloneVisible = STANDALONE_BELOW.filter(i => canSee(i.href))

  return (
    <>
    {/* Botão hambúrguer — só em telas < md (no desktop a sidebar sempre aparece).
        top respeita o safe-area do iOS (status bar translúcido) pra não colar no relógio. */}
    <button
      onClick={() => setMobileOpen(true)}
      aria-label="Abrir menu"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.625rem)' }}
      className="md:hidden fixed left-2.5 z-50 p-2.5 rounded-lg bg-[#111827] border border-[#1F2937] text-gray-300 hover:text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
    >
      <Menu size={20} />
    </button>

    {/* Backdrop do drawer (mobile) */}
    {mobileOpen && (
      <div
        onClick={() => setMobileOpen(false)}
        className="md:hidden fixed inset-0 z-40 bg-black/60"
        aria-hidden="true"
      />
    )}

    <aside
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      className={clsx(
        'fixed top-0 left-0 h-full z-40 flex flex-col transition-all duration-200 ease-in-out',
        'bg-[#111827] border-r border-[#1F2937]',
        // Mobile: drawer largo que desliza; Desktop: sempre visível, largura por hover.
        'w-60 md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        expanded ? 'md:w-60' : 'md:w-16'
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Projeto ativo + switcher (substitui a marca fixa).
          SEM overflow-hidden: o dropdown do switcher abre abaixo do header e
          precisa escapar (overflow-hidden cortava o menu, travando a troca de
          projeto). A truncagem do nome é feita dentro do próprio switcher. */}
      <div className="relative z-50 flex items-center h-16 px-4 border-b border-[#1F2937] shrink-0 gap-2">
        <WorkspaceSwitcher active={activeWorkspace} workspaces={workspaces} expanded={expanded} />
        {expanded && (
          <button
            onClick={() => setPinned(!pinned)}
            title={pinned ? 'Desafixar sidebar' : 'Fixar sidebar'}
            aria-label={pinned ? 'Desafixar sidebar' : 'Fixar sidebar'}
            className="shrink-0 p-1 rounded-md text-gray-500 hover:text-white hover:bg-[#1F2937] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-colors duration-200 cursor-pointer"
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
        {/* Visão Geral (topo, solto) */}
        {canSee(VISAO_GERAL.href) && (
          <ul className="space-y-1 px-2">
            <NavLinkItem item={VISAO_GERAL} />
          </ul>
        )}

        {/* Pastas */}
        {visibleGroups.map((group) => {
          const GroupIcon = group.icon
          const groupHasActive = group.items.some(i => isActive(i.href))
          // A pasta da rota ativa fica sempre aberta, mesmo se o usuário tiver colapsado.
          const open = groupHasActive || !collapsedGroups[group.id]
          return (
            <div key={group.id} className={clsx(expanded ? 'mt-3' : 'mt-2 border-t border-[#1F2937]/60 pt-2')}>
              {expanded ? (
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
                  aria-expanded={open}
                >
                  <GroupIcon size={13} className="shrink-0" />
                  <span className="flex-1 text-left truncate">{group.label}</span>
                  <ChevronDown size={13} className={clsx('shrink-0 transition-transform duration-200', open ? '' : '-rotate-90')} />
                </button>
              ) : (
                // Recolhido: sem cabeçalho de texto; só o ícone da pasta como rótulo discreto.
                <div className="flex justify-center py-1" title={group.label}>
                  <GroupIcon size={13} className="text-gray-400 shrink-0" />
                </div>
              )}
              {open && (
                <ul className="space-y-1 px-2 mt-1">
                  {group.items.map(item => <NavLinkItem key={item.href} item={item} />)}
                </ul>
              )}
            </div>
          )
        })}

        {/* Itens soltos (sem pasta), abaixo das pastas */}
        {standaloneVisible.length > 0 && (
          <ul className={clsx('space-y-1 px-2', expanded ? 'mt-3 pt-3 border-t border-[#1F2937]/60' : 'mt-2 pt-2 border-t border-[#1F2937]/60')}>
            {standaloneVisible.map(item => <NavLinkItem key={item.href} item={item} />)}
          </ul>
        )}
      </nav>

      {/* Admin — logo acima do botão Atualizar, só admin */}
      {isAdmin && (
        <div className="px-2 pt-2 border-t border-[#1F2937] shrink-0">
          <ul><NavLinkItem item={ADMIN_NAV_ITEM} /></ul>
        </div>
      )}

      {/* Sync button */}
      {!isViewer && (
      <div className={clsx('px-2 shrink-0', !isAdmin && 'pt-2 border-t border-[#1F2937]')}>
        <button
          onClick={handleSync}
          disabled={syncing}
          title="Atualizar dados (sincroniza Meta + busca dados frescos)"
          aria-label="Atualizar dados"
          className={clsx(
            'flex items-center gap-2 w-full rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 cursor-pointer',
            'text-gray-400 hover:text-white hover:bg-[#1F2937] focus:outline-none focus:ring-2 focus:ring-cyan-500/50',
            !expanded && 'justify-center px-2'
          )}
        >
          <RefreshCw size={18} className={clsx('shrink-0', syncing && 'animate-spin')} />
          {expanded && (
            <span className="truncate whitespace-nowrap text-xs">
              {syncing ? 'Atualizando...' : syncMsg || 'Atualizar'}
            </span>
          )}
        </button>
        {expanded && freshnessLabel && !syncing && !syncMsg && (
          <p
            className="px-3 pt-0.5 pb-1 text-[10px] text-gray-400 truncate"
            title={`Dados do dashboard atualizados às ${freshnessLabel}`}
          >
            atualizado às {freshnessLabel}
          </p>
        )}
      </div>
      )}

      {/* Logout */}
      <div className="px-2 shrink-0">
        <form action={logoutAction}>
          <button
            type="submit"
            title="Sair"
            aria-label="Sair"
            className={clsx(
              'flex items-center gap-2 w-full rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 cursor-pointer',
              'text-gray-500 hover:text-[#F43F5E] hover:bg-[#F43F5E]/10 focus:outline-none focus:ring-2 focus:ring-[#F43F5E]/30',
              !expanded && 'justify-center px-2'
            )}
          >
            <LogOut size={18} className="shrink-0" />
            {expanded && <span className="truncate whitespace-nowrap text-xs">Sair</span>}
          </button>
        </form>
      </div>

      {/* Analytics Hub branding */}
      <div className="px-2 pb-3 shrink-0">
        <a
          href="#"
          target="_blank"
          rel="noopener noreferrer"
          title="Analytics Hub — WhatsApp"
          aria-label="Analytics Hub — WhatsApp"
          className={clsx(
            'flex items-center gap-2 w-full rounded-lg px-3 py-2.5 transition-colors duration-200',
            'text-gray-500 hover:text-cyan-400 focus:outline-none focus:text-cyan-400',
            !expanded && 'justify-center px-2'
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="Analytics Hub" className="shrink-0 w-[18px] h-[18px] rounded-sm object-contain opacity-50" />
          {expanded && (
            <>
              <span className="truncate whitespace-nowrap text-[10px] font-medium tracking-wide flex-1">
                Analytics Hub
              </span>
              <ExternalLink size={10} className="shrink-0" aria-hidden="true" />
            </>
          )}
        </a>
      </div>

    </aside>
    </>
  )
}
