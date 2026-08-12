export const dynamic = 'force-dynamic'

import Header from '@/components/layout/Header'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { fetchAcoesVendas, fetchCenarios, fetchPlanejamentoConfig } from '@/lib/acoesVendas'
import { mergeImpostoConfig, consolidar, type PlanoConsolidado } from '@/lib/planejamento'
import { computeFunil, calcFinanceiroFunil, normalizeFunilState } from '@/lib/funilEngine'
import CentroClient from './CentroClient'

export default async function CentroPage() {
  const ws = await getActiveWorkspaceId()
  const [acoes, wsCfg] = await Promise.all([fetchAcoesVendas(ws), fetchPlanejamentoConfig(ws)])
  const planos = acoes.filter((a) => a.is_planejamento && !a.arquivada_em && a.incluir_consolidacao !== false)

  const consolidados: PlanoConsolidado[] = []
  await Promise.all(planos.map(async (a) => {
    const cenarios = await fetchCenarios(a.id, ws)
    const impostos = mergeImpostoConfig(a, wsCfg)
    // melhor cenário simulado (maior ROAS)
    let best: { fat: number; inv: number; tax: number; imp: number; mc: number } | null = null
    for (const c of cenarios) {
      if (c.kind !== 'simulado') continue
      const s = normalizeFunilState(c.estado as never)
      const d = computeFunil(s, a.tipo)
      const fin = calcFinanceiroFunil(d, impostos)
      if (!best || d.roas > (best.fat / Math.max(1, best.inv))) {
        best = { fat: d.faturamentoTotal, inv: s.investimento, tax: fin.taxasHotmart, imp: fin.imposto, mc: fin.margemContribuicao }
      }
    }
    if (best) consolidados.push({ id: a.id, nome: a.nome, tipo: a.tipo, faturamento: best.fat, investimento: best.inv, taxas: best.tax, imposto: best.imp, margemContribuicao: best.mc })
  }))
  // ordena por margem desc (estável)
  consolidados.sort((x, y) => y.margemContribuicao - x.margemContribuicao)

  const consolidacao = consolidar(consolidados, wsCfg.despesas_fixas, wsCfg.pct_variavel)

  return (
    <div className="flex flex-col h-full">
      <Header title="Centro de Planejamento" subtitle="Consolidação financeira: margem dos funis − despesas = lucro líquido da operação" />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <CentroClient consolidacao={consolidacao} despesasFixas={wsCfg.despesas_fixas} pctVariavel={wsCfg.pct_variavel} />
      </div>
    </div>
  )
}
