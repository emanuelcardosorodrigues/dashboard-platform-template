export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { cookies } from 'next/headers'
import { FolderOpen } from 'lucide-react'
import Header from '@/components/layout/Header'
import { fetchMetaAds } from '@/lib/supabase'
import { listCriativos } from '@/lib/criativos'
import {
  CREATIVE_ANALYSIS_TABS,
  SESSION_COOKIE,
  isCreativeAnalysisTabAllowed,
  normalizeCreativeAnalysisTab,
  type CreativeAnalysisTab,
} from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import CriativosIaClient from './CriativosIaClient'
import CriativosTabContent from '../criativos/CriativosTabContent'
import InsightsTabContent from '../insights-ia/InsightsTabContent'

type PageParams = {
  de?: string
  ate?: string
  funil?: string
  conta?: string
  cmp?: string
  cmpDe?: string
  cmpAte?: string
  f?: string
  tab?: string
}

function tabHref(tab: CreativeAnalysisTab, params: PageParams) {
  const query = new URLSearchParams()
  for (const key of ['de', 'ate', 'funil', 'conta', 'cmp', 'cmpDe', 'cmpAte', 'f'] as const) {
    const value = params[key]
    if (value) query.set(key, value)
  }
  if (tab !== 'cards') query.set('tab', tab)
  const encoded = query.toString()
  return `/criativos-ia${encoded ? `?${encoded}` : ''}`
}

export default async function CriativosIaPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams
  const { de = '', ate = '', funil = 'all', conta = 'all' } = params
  const tab = normalizeCreativeAnalysisTab(params.tab)
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId).catch(() => null) : null
  const allowedTabs = session?.role === 'viewer'
    ? CREATIVE_ANALYSIS_TABS.filter((candidate) => isCreativeAnalysisTabAllowed(session.allowed_paths, candidate))
    : [...CREATIVE_ANALYSIS_TABS]

  // O proxy já barra a navegação não autorizada. Esta guarda server-side evita
  // carregar dados de outra sub-aba caso a página seja alcançada sem ele.
  const activeTab = allowedTabs.includes(tab) ? tab : allowedTabs[0] ?? 'cards'
  const needsCardData = activeTab === 'cards' || activeTab === 'historico'
  const allMeta = needsCardData || activeTab === 'criativos' ? await fetchMetaAds() : []
  const criativos = needsCardData ? await listCriativos(de, ate, funil, conta) : []
  const accountOptions = [...new Set(allMeta.map((r) => r.account_id).filter((id): id is string => Boolean(id)))]
  return (
    <div className="flex flex-col h-full">
      <Header
        title="Análise de Criativos"
        subtitle="Inteligência criativa · ROAS · Fadiga · Padrões · Equipe"
        accountOptions={accountOptions}
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <nav aria-label="Seções da Análise de Criativos" className="flex gap-1 overflow-x-auto border-b border-border">
          {allowedTabs.map((candidate) => (
            <Link
              key={candidate}
              href={tabHref(candidate, params)}
              aria-current={activeTab === candidate ? 'page' : undefined}
              className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${activeTab === candidate ? 'border-purple-400 text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
            >
              {{ cards: 'Criativos em Cards', historico: 'Histórico de Performance', criativos: 'Criativos', insights: 'Insights IA' }[candidate]}
            </Link>
          ))}
        </nav>
        {needsCardData && <div>
          <Link href="/criativos-ia/nao-rodaram"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition-colors">
            <FolderOpen size={14} /> Criativos que não rodaram
          </Link>
        </div>}
        {needsCardData && <CriativosIaClient initial={criativos} hideTabs />}
        {activeTab === 'criativos' && <CriativosTabContent de={de} ate={ate} funil={funil} conta={conta} cmp={params.cmp} cmpDe={params.cmpDe} cmpAte={params.cmpAte} />}
        {activeTab === 'insights' && <InsightsTabContent de={de} ate={ate} />}
      </div>
    </div>
  )
}
