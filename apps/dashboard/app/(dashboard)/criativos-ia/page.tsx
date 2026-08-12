export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { FolderOpen } from 'lucide-react'
import Header from '@/components/layout/Header'
import { fetchMetaAds } from '@/lib/supabase'
import { listCriativos } from '@/lib/criativos'
import CriativosIaClient from './CriativosIaClient'

export default async function CriativosIaPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string }> }) {
  const { de = '', ate = '', funil = 'all', conta = 'all' } = await searchParams
  // Fetch no SERVIDOR (elimina o waterfall: page → client useEffect → /api/lista).
  // fetchMetaAds é cache()-dedup com o que listCriativos usa internamente.
  const [allMeta, criativos] = await Promise.all([fetchMetaAds(), listCriativos(de, ate, funil, conta)])
  const accountOptions = [...new Set(allMeta.map((r) => r.account_id).filter((id): id is string => Boolean(id)))]
  return (
    <div className="flex flex-col h-full">
      <Header
        title="Análise de Criativos"
        subtitle="Inteligência criativa · ROAS · Fadiga · Padrões · Equipe"
        accountOptions={accountOptions}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4">
          <Link href="/criativos-ia/nao-rodaram"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition-colors">
            <FolderOpen size={14} /> Criativos que não rodaram
          </Link>
        </div>
        <CriativosIaClient initial={criativos} />
      </div>
    </div>
  )
}
