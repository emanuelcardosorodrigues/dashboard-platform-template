export const dynamic = 'force-dynamic'

import Header from '@/components/layout/Header'
import { fetchTransacoes } from '@/lib/supabase'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { fetchAcoesVendas, analyzeAcao } from '@/lib/acoesVendas'
import AcoesVendasClient, { type ResumoMap } from './AcoesVendasClient'

export default async function AcoesVendasPage() {
  const ws = await getActiveWorkspaceId()
  const [acoes, transacoes] = await Promise.all([fetchAcoesVendas(ws), fetchTransacoes()])
  const produtos = Array.from(new Set(transacoes.map((t) => (t.produto || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))

  const resumo: ResumoMap = {}
  for (const a of acoes) {
    const r = analyzeAcao(a, transacoes)
    resumo[a.id] = { vendas: r.vendasFront, faturamento: r.faturamentoFront, receita: r.receitaLiquida, metaPct: r.metas[0]?.pct ?? null, metaLabel: r.metas[0]?.label ?? null }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Ações de Vendas" subtitle="Painel por ação — lançamentos, low ticket, perpétuo" />
      <div className="flex-1 overflow-y-auto p-6">
        <AcoesVendasClient acoes={acoes} produtos={produtos} resumo={resumo} />
      </div>
    </div>
  )
}
