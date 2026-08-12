/**
 * NÚCLEO ÚNICO da /visao-geral — desktop e mobile leem daqui.
 *
 * Antes as duas telas repetiam as MESMAS contas em blocos separados do page.tsx.
 * Repetição não é paridade: bastava um dos dois mudar para os números divergirem
 * sem nada quebrar. Aqui as fórmulas existem UMA vez e os rótulos também
 * (KPI_LABEL) — divergir vira erro de compilação/teste, não bug silencioso.
 *
 * As fórmulas são cópia literal do que o KpiSection já fazia; o desktop tem que
 * sair byte-a-byte igual ao que era (visaoGeralParidade.test.ts trava isso).
 */

import { tipoDaTransacao, type SbTransacao, type SbMetaAds } from './supabase'
import { liquidoHotmartTransacoes } from './hotmartFees'
import type { FunilConfig } from './funisConfig'

/**
 * Rótulo canônico de cada métrica. A regra do dono: onde as duas telas mostram a
 * MESMA métrica, o rótulo tem que ser o MESMO. Ex.: o card que o mobile chamava
 * de "Lucro" é receita líquida − investimento, ou seja, o "Lucro Líquido 01" do
 * desktop — que é 37% menor que o "Lucro Bruto". Nome diferente para o mesmo
 * número faz o dono concluir que o app está errado.
 */
export const KPI_LABEL = {
  faturamento: 'Faturamento Total',
  investimento: 'Investimento',
  lucroBruto: 'Lucro Bruto',
  lucroLiquido01: 'Lucro Líquido 01',
  roasBruto: 'ROAS Bruto',
  roasLiquido: 'ROAS Líq.',
  cpa: 'CPA',
  compradores: 'Compradores',
} as const

export interface VisaoGeralCore {
  /** Bruto Hotmart do recorte. */
  faturamento: number
  /** TODA transação (front + OBs + upsell/downsell) — base da taxa fixa. */
  numVendas: number
  /** Gasto Meta já com o imposto (×1,1382 aplicado no sync-meta). */
  investimento: number
  /** Compras de front-end (base do CPA). */
  frontEndVendas: number
  /** Soma do líquido POR transação (taxa Hotmart canônica). */
  receitaLiquida: number
  lucroBruto: number
  lucroLiquido01: number
  roasBruto: number
  roasLiquido: number
  cpa: number
  /** Ticket bruto por venda front — entra na régua de CPA por funil. */
  ticketFE: number
}

/**
 * Calcula o bloco de KPIs a partir de transações e linhas do meta_ads JÁ
 * filtradas (data + funil + conta). Função pura: nenhum fetch, nenhum `Date`.
 */
export function computeVisaoGeralCore(
  transacoes: SbTransacao[],
  metaAds: SbMetaAds[],
  funis?: FunilConfig[],
): VisaoGeralCore {
  const faturamento = transacoes.reduce((s, t) => s + (t.valor_bruto || 0), 0)
  const numVendas = transacoes.length
  const investimento = metaAds.reduce((s, r) => s + (r.investimento || 0), 0)
  // `tipoDaTransacao` (e NÃO `produtoToTipo(nome, criativo)`) porque ele carrega o
  // `produto_id` junto: é o que faz a classificação por ID funcionar. Chamar a
  // versão por nome numa linha que TEM id é o jeito de reintroduzir, calado, o bug
  // do rename na Hotmart — e foi o que este núcleo quase fez ao ser mergeado sobre
  // uma main que já havia migrado para a classificação por ID.
  const frontEndVendas = transacoes.filter((t) => tipoDaTransacao(t, funis) === 'frontEnd').length
  const receitaLiquida = liquidoHotmartTransacoes(transacoes.map((t) => t.valor_bruto || 0))

  return {
    faturamento,
    numVendas,
    investimento,
    frontEndVendas,
    receitaLiquida,
    lucroBruto: faturamento - investimento,
    lucroLiquido01: receitaLiquida - investimento,
    roasBruto: investimento > 0 ? faturamento / investimento : 0,
    roasLiquido: investimento > 0 ? receitaLiquida / investimento : 0,
    cpa: frontEndVendas > 0 ? investimento / frontEndVendas : 0,
    ticketFE: frontEndVendas > 0 ? faturamento / frontEndVendas : 0,
  }
}
