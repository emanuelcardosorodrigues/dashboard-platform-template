/**
 * /organico/inteligencia-de-conteudo — Hashtag Search público do Instagram.
 *
 * Demonstra/usa a permissão "Instagram Public Content Access" da Meta. Mostra o
 * ranking de conteúdo PÚBLICO por hashtag do nicho (top/recent media) + pauta
 * recomendada (determinística). Busca é SOB DEMANDA (botão), respeitando o
 * orçamento de 30 hashtags/7 dias por conta IG. O agregado é persistido em
 * hashtag_media → recarregar a página NÃO gasta orçamento.
 */
import { createClient } from '@supabase/supabase-js'
import Header from '@/components/layout/Header'
import FilterToggle from '@/components/filters/FilterToggle'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { getInstagramOrganicConfig } from '@/lib/integrations/factory'
import { getHashtagBudget, HASHTAG_BUDGET_LIMIT, type SbHashtagMedia, type BudgetUsage } from '@/lib/organico/hashtag'
import InteligenciaClient from './InteligenciaClient'

export const dynamic = 'force-dynamic'

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export default async function InteligenciaConteudoPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; icDe?: string; icAte?: string; icUsarGeral?: string }>
}) {
  const sp = await searchParams
  const ws = await getActiveWorkspaceId()
  const client = db()

  // Conta IG conectada (1ª) + saldo do orçamento. Graceful se IG/tabela ausentes.
  const cfg = await getInstagramOrganicConfig(ws).catch(() => null)
  const accounts = cfg ? Object.keys(cfg.tokens).filter((k) => k !== '__user') : []
  const igUserId = accounts[0] ?? null

  let budget: BudgetUsage | null = null
  if (igUserId) {
    try { budget = await getHashtagBudget(client, ws, igUserId) } catch { budget = null }
  }

  // Agregado público persistido (sem gastar orçamento). Graceful se tabela ausente.
  let media: SbHashtagMedia[] = []
  try {
    const { data } = await client.from('hashtag_media')
      .select('*')
      .eq('workspace_id', ws)
      .order('like_count', { ascending: false, nullsFirst: false })
      .limit(600)
    media = (data ?? []) as SbHashtagMedia[]
  } catch { media = [] }

  // Período do FilterToggle (prefix="ic", showFunil=false): ON usa geral; OFF usa o próprio.
  const usarGeral = (sp.icUsarGeral ?? 'on') !== 'off'
  const de = usarGeral ? (sp.de || '') : (sp.icDe || sp.de || '')
  const ate = usarGeral ? (sp.ate || '') : (sp.icAte || sp.ate || '')
  const filtered = media.filter((m) => {
    if (!m.taken_at) return true
    const d = m.taken_at.slice(0, 10)
    if (de && d < de) return false
    if (ate && d > ate) return false
    return true
  })

  return (
    <div className="flex flex-col h-full">
      <Header title="Inteligência de Conteúdo" subtitle="Hashtags públicas do nicho · o que mais performa no Instagram" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <FilterToggle prefix="ic" showFunil={false} />
        <InteligenciaClient
          igConnected={!!igUserId}
          igUserId={igUserId}
          budget={budget}
          media={filtered}
          limit={HASHTAG_BUDGET_LIMIT}
        />
      </div>
    </div>
  )
}
