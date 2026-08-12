export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { fetchAcaoVenda, fetchCenarios, fetchNotas, fetchPlanejamentoConfig } from '@/lib/acoesVendas'
import { mergeImpostoConfig, computeCenarioReal, calcHorizonte } from '@/lib/planejamento'
import Planejador from './Planejador'
import PlanejadorLancamento from './PlanejadorLancamento'

export default async function PlanejamentoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ws = await getActiveWorkspaceId()
  const acao = await fetchAcaoVenda(id, ws)
  if (!acao || !acao.is_planejamento) notFound()

  const [cenarios, notas, wsCfg, real] = await Promise.all([
    fetchCenarios(id, ws),
    fetchNotas(id, ws),
    fetchPlanejamentoConfig(ws),
    computeCenarioReal(acao, ws),
  ])
  const impostos = mergeImpostoConfig(acao, wsCfg)
  const horizonte = calcHorizonte(acao)
  const props = { acao, cenariosIniciais: cenarios, notasIniciais: notas, impostos, real, horizonte }

  // Lançamento Pago usa o planejador v1 (estilo da referência LaunchSim); demais usam o motor de funil.
  return acao.tipo === 'lancamento_pago'
    ? <PlanejadorLancamento {...props} />
    : <Planejador {...props} />
}
