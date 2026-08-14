import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { AlertTriangle } from 'lucide-react'
import Sidebar from '@/components/layout/Sidebar'
import MobileBottomNav from '@/components/layout/MobileBottomNav'
import AskAIDrawer from '@/components/ai/AskAIDrawer'
import InstallPrompt from '@/components/pwa/InstallPrompt'
import NotificationsPrompt from '@/components/pwa/NotificationsPrompt'
import PullToRefresh from '@/components/pwa/PullToRefresh'
import { UserPrefsProvider } from '@/components/layout/UserPrefsProvider'
import { SESSION_COOKIE, type Role } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { fetchDataFreshness, fetchDataStaleness } from '@/lib/supabase'
import { getSwitcherWorkspaces } from '@/lib/workspace-context'
import { todayBR } from '@/lib/formatters'

const fmtDM = (iso: string) => (iso?.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso)

/** Banner de saúde dos dados — avisa quando o sync do Meta parou (dado defasado).
 *  Pega a classe de bug "pipeline morto sem alarme" (igual o das fichas). */
async function DataHealthBanner() {
  const { metaAds } = await fetchDataStaleness().catch(() => ({ metaAds: null }))
  if (!metaAds) return null
  const dias = Math.round((Date.parse(todayBR()) - Date.parse(metaAds)) / 86400000)
  if (dias < 2) return null
  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2 text-xs text-amber-300 flex items-center gap-2 shrink-0">
      <AlertTriangle size={13} className="shrink-0" />
      Dados do Meta Ads parecem parados — último dia: <span className="font-medium tabular-nums">{fmtDM(metaAds)}</span> ({dias} dias atrás). Os números podem estar incompletos; verifique o sync.
    </div>
  )
}

async function getSidebarContext(): Promise<{ role: Role | null; allowedPaths: string[] }> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (!sessionId) return { role: null, allowedPaths: [] }
  const session = await lookupSession(sessionId)
  if (!session) return { role: null, allowedPaths: [] }
  return { role: session.role, allowedPaths: session.allowed_paths }
}

/** Toda a resolução de dados do Sidebar (role/allowed_paths via lookupSession +
 *  switcher de workspaces + freshness do Meta) vive AQUI, dentro do <Suspense>.
 *  Antes rodava no corpo do layout com `await`, bloqueando o 1º byte de TODA página.
 *  freshness compartilha o cache de meta_ads (sem fetch extra dentro da janela);
 *  .catch garante que um erro de dados nunca derrube o layout. */
async function SidebarSection() {
  const [{ role, allowedPaths }, dataFreshness, switcher] = await Promise.all([
    getSidebarContext(),
    fetchDataFreshness().catch(() => null),
    getSwitcherWorkspaces().catch(() => ({ active: null, list: [] })),
  ])
  return (
    <>
      <Sidebar role={role} allowedPaths={allowedPaths} dataFreshness={dataFreshness} activeWorkspace={switcher.active} workspaces={switcher.list} />
      <MobileBottomNav role={role} allowedPaths={allowedPaths} />
    </>
  )
}

/**
 * Preset de período padrão DO USUÁRIO (users.default_filters.periodo). Substitui
 * o localStorage 'demo-default-date-preset', que era por DISPOSITIVO — desktop e
 * PWA instalado tinham storages separados e mostravam períodos diferentes para o
 * mesmo login.
 *
 * A promessa é passada CRUA ao client (padrão de streaming do React 19): o layout
 * não faz `await`, então o shell continua saindo no 1º byte, e o Header resolve
 * o valor depois da hidratação. Nunca rejeita — falha vira `null` e o Header cai
 * no fallback de localStorage.
 */
async function fetchDefaultPeriodo(): Promise<string | null> {
  try {
    const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
    if (!sessionId) return null
    const session = await lookupSession(sessionId)
    return session?.default_filters.periodo ?? null
  } catch {
    return null
  }
}

/** Fallback do Sidebar enquanto o stream não chega: reproduz o trilho recolhido
 *  (mesma cor/borda/largura md:w-16) pra não haver flash escuro nem layout shift.
 *  No mobile a sidebar nasce fora da tela (translate), então o trilho fica oculto. */
function SidebarSkeleton() {
  return (
    <aside
      aria-hidden="true"
      className="hidden md:flex fixed top-0 left-0 h-full z-40 w-16 flex-col bg-[#111827] border-r border-[#1F2937]"
    />
  )
}

// O layout NÃO é mais async: o shell (<div flex>, <main>{children}</main>) sai no
// 1º byte SEM esperar nenhum fetch. Sidebar (role/switcher/freshness) e o banner de
// saúde entram por streaming via <Suspense> assim que resolvem. A auth já foi
// aplicada no edge (proxy.ts) antes do layout renderizar, então nada aqui é gate.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserPrefsProvider defaultPeriodoPromise={fetchDefaultPeriodo()}>
    <div className="flex h-full">
      <Suspense fallback={<SidebarSkeleton />}><SidebarSection /></Suspense>
      <div className="flex-1 flex flex-col ml-0 md:ml-16 min-w-0 overflow-hidden">
        <Suspense fallback={null}><DataHealthBanner /></Suspense>
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {/* E5: pull-to-refresh é um wrapper CLIENT em volta do {children}. children
              chega como prop já renderizada no servidor, então o streaming/<Suspense>
              das páginas segue intacto e o layout continua server component. No
              desktop o wrapper é display:contents (inerte). */}
          <PullToRefresh>{children}</PullToRefresh>
        </main>
      </div>
      <Suspense fallback={null}><AskAIDrawer /></Suspense>
      <InstallPrompt />
      <NotificationsPrompt />
    </div>
    </UserPrefsProvider>
  )
}
