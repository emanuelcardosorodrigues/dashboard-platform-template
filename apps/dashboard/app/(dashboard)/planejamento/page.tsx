export const dynamic = 'force-dynamic'

import Header from '@/components/layout/Header'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { fetchAcoesVendas, fetchCenarios, fetchPlanejamentoConfig } from '@/lib/acoesVendas'
import { mergeImpostoConfig, resumoCard, type ResumoCard } from '@/lib/planejamento'
import PlanejamentoGrid from './PlanejamentoGrid'

export type ResumoPlanoMap = Record<string, ResumoCard>

export default async function PlanejamentoPage() {
  const ws = await getActiveWorkspaceId()
  const [acoes, wsCfg] = await Promise.all([fetchAcoesVendas(ws), fetchPlanejamentoConfig(ws)])
  const planejamentos = acoes.filter((a) => a.is_planejamento)

  // Resumo por card = cenário simulado de maior ROAS (investimento/faturamento/lucro).
  const resumo: ResumoPlanoMap = {}
  await Promise.all(
    planejamentos.map(async (a) => {
      const cenarios = await fetchCenarios(a.id, ws)
      resumo[a.id] = resumoCard(cenarios, mergeImpostoConfig(a, wsCfg), a.tipo)
    }),
  )

  return (
    <div className="flex flex-col h-full">
      <Header title="Planejamento de Ação de Vendas" subtitle="Simule, compare cenários e acompanhe previsto × realizado de cada ação de venda" />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <PlanejamentoGrid planejamentos={planejamentos} resumo={resumo} />
      </div>
    </div>
  )
}
