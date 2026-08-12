/**
 * Ticket médio por funil, decomposto pela CONTRIBUIÇÃO de cada produto (front + OBs +
 * upsell/downsell) — "de quanto é o ticket, e quem paga cada pedaço dele".
 *
 * A identidade que sustenta o painel:
 *
 *   ticket = receitaLiquida / vendasFront
 *          = Σ liquidoTotal(produto) / vendasFront
 *          = Σ contribuicao(produto)
 *
 * Ou seja, a soma das contribuições por produto SEMPRE fecha com o ticket — não é
 * coincidência, é álgebra (mesma soma dividida pelo mesmo denominador, só reagrupada
 * por produto em vez de tomada de uma vez). `verificarInvariante` existe pra provar
 * isso em qualquer recorte, do jeito que `computePeriodSummary` soma absolutos e
 * divide UMA vez em vez de fazer média de razões (ver comentário ~148 de
 * lib/periodSummary.ts) — a mesma lei, aplicada por produto.
 *
 * `vendasFront === 0` é o único caso degenerado: sem venda front não há ticket (não
 * existe "por venda front" pra dividir), então `semDado` avisa a UI e todo campo
 * derivado vira 0 — nunca NaN/Infinity (mesmo espírito de lib/metrics/convBody.ts:
 * sem amostra devolve um sinal explícito, não um número fantasma).
 *
 * Sem I/O. Função pura sobre arrays já carregados (mesmo precedente de
 * computePeriodSummary).
 */

import { filterTransacoesByFunil, normalizeFunil, tipoDaTransacao, type SbTransacao, type SbMetaAds } from './supabase'
import { DEFAULT_FUNIS, classificarProduto, type FunilConfig, type ProdutoTipoFlat } from './funisConfig'
import { liquidoHotmartVenda, liquidoHotmartTransacoes } from './hotmartFees'

export interface ContribuicaoProduto {
  produto: string              // nome literal do produto
  tipo: ProdutoTipoFlat        // 'frontEnd' | 'ob1'..'ob4' | 'upsell' | 'downsell'
  vendas: number
  liquidoTotal: number         // soma de liquidoHotmartVenda(valor_bruto)
  contribuicao: number         // liquidoTotal / vendasFront  (R$ por venda front)
  pctTicket: number            // contribuicao / ticket * 100
}

export interface TicketFunil {
  funil: string | null         // slug normalizado; null = todos os funis
  vendasFront: number          // SÓ vendas do produto front DESTE funil
  receitaLiquida: number       // líquido dos produtos DESTE funil
  ticket: number               // receitaLiquida / vendasFront
  produtos: ContribuicaoProduto[]   // ordenado por contribuicao DESC
  semDado: boolean             // true quando vendasFront === 0
  /**
   * Produtos que caíram no recorte por ATRIBUIÇÃO (token do funil no sck/criativo/campanha)
   * mas pertencem a OUTRO funil. Não entram no ticket; ficam visíveis pra UI avisar.
   * Ver a nota "atribuição ≠ papel" no topo do arquivo.
   */
  foraDoFunil: ContribuicaoProduto[]
  /**
   * Quantas vendas a convenção ANTIGA do app contaria como front aqui (`produtoToTipo`
   * sozinho, que reclassifica do zero e cai no fallback `frontEnd`). Existe só pra UI
   * poder mostrar a diferença — NÃO use pra dividir nada.
   */
  vendasFrontConvencaoApp: number
}

/** True se `t.data` cai dentro de [de, ate] (inclusivo). Ausente = sem limite daquele lado. */
function emJanela(t: SbTransacao, de?: string, ate?: string): boolean {
  if (!t.data) return !de && !ate
  if (de && t.data < de) return false
  if (ate && t.data > ate) return false
  return true
}

export function computeTicketFunil(
  transacoes: SbTransacao[],
  metaAds: SbMetaAds[],
  opts: { de?: string; ate?: string; funil?: string; funis?: FunilConfig[] } = {},
): TicketFunil {
  const funis = opts.funis ?? DEFAULT_FUNIS
  const funilRaw = opts.funil ?? ''

  // 1. Recorte de data ANTES do filtro de funil.
  const dateFiltered = transacoes.filter((t) => emJanela(t, opts.de, opts.ate))

  // 2. Filtro de funil (vazio/'all' = todos, via normalizeFunil dentro da própria função).
  const funilTransacoes = filterTransacoesByFunil(dateFiltered, funilRaw, metaAds, funis)

  const slug = normalizeFunil(funilRaw, funis)
  const cfg = slug ? funis.find((f) => f.ativo !== false && f.slug === slug) : undefined

  // 3. ATRIBUIÇÃO ≠ PAPEL. `filterTransacoesByFunil` traz tudo que o token do funil
  //    atrai (sck/criativo/campanha). Isso é certo pra creditar RECEITA, e errado pra
  //    contar VENDA FRONT: a página `lps-pv06-alunos-calculadora-col-1real` tem o token
  //    `col` no sck, então 39 vendas de "Imersão Lucro Clínico!" (front do LPS, a R$1)
  //    caem no recorte COL — e `produtoToTipo`, que reclassifica do zero e cai no
  //    fallback `frontEnd`, as contava como front do COL. Aqui o papel vem do produto
  //    DENTRO deste funil; quem não pertence ao funil vai pra `foraDoFunil`.
  const regraDoProduto = (produto: string) => {
    if (!cfg) return null
    const alvo = (produto || '').toLowerCase()
    return (
      cfg.produtos.find((r) => {
        if (r.por === 'id') return false // sem id de produto no SbTransacao
        const toks = r.match.toLowerCase().split(/\s+/).filter(Boolean)
        return toks.length > 0 && toks.every((tok) => alvo.includes(tok))
      }) ?? null
    )
  }
  const pertence = (t: SbTransacao) => (cfg ? regraDoProduto(t.produto || '') !== null : true)
  const tipoOf = (t: SbTransacao) =>
    (cfg
      ? classificarProduto(t.produto || '', slug, funis)
      : tipoDaTransacao(t, funis)) as ProdutoTipoFlat

  const dentro = funilTransacoes.filter(pertence)
  const fora = cfg ? funilTransacoes.filter((t) => !pertence(t)) : []

  // 4. vendasFront = só quem casa a regra de papel `front` DESTE funil.
  const vendasFront = cfg
    ? dentro.filter((t) => regraDoProduto(t.produto || '')?.papel === 'front').length
    : dentro.filter((t) => tipoOf(t) === 'frontEnd').length

  // Convenção antiga (produtoToTipo sozinho) — só pra UI mostrar a diferença.
  const vendasFrontConvencaoApp = funilTransacoes.filter(
    (t) => tipoDaTransacao(t, funis) === 'frontEnd',
  ).length

  // receitaLiquida = líquido dos produtos DESTE funil (front + OBs + upsell/downsell).
  const receitaLiquida = liquidoHotmartTransacoes(dentro.map((t) => t.valor_bruto || 0))

  // 5. vendasFront === 0 → semDado, ticket 0, nunca NaN/Infinity.
  const semDado = vendasFront === 0
  const ticket = vendasFront > 0 ? receitaLiquida / vendasFront : 0

  interface Acc { tipo: ProdutoTipoFlat; vendas: number; liquidoTotal: number }
  const agrupar = (rows: SbTransacao[]): ContribuicaoProduto[] => {
    const groups = new Map<string, Acc>()
    for (const t of rows) {
      const nome = t.produto || ''
      const liquido = liquidoHotmartVenda(t.valor_bruto || 0)
      const existente = groups.get(nome)
      if (existente) {
        existente.vendas += 1
        existente.liquidoTotal += liquido
      } else {
        groups.set(nome, { tipo: tipoOf(t), vendas: 1, liquidoTotal: liquido })
      }
    }
    // 6. Precisão total — nada arredondado aqui (responsabilidade de quem exibe).
    return Array.from(groups.entries())
      .map(([produto, g]) => {
        const contribuicao = vendasFront > 0 ? g.liquidoTotal / vendasFront : 0
        const pctTicket = vendasFront > 0 && ticket > 0 ? (contribuicao / ticket) * 100 : 0
        return { produto, tipo: g.tipo, vendas: g.vendas, liquidoTotal: g.liquidoTotal, contribuicao, pctTicket }
      })
      .sort((a, b) => b.contribuicao - a.contribuicao)
  }

  return {
    funil: slug,
    vendasFront,
    receitaLiquida,
    ticket,
    produtos: agrupar(dentro),
    semDado,
    foraDoFunil: agrupar(fora),
    vendasFrontConvencaoApp,
  }
}

/**
 * Prova a identidade algébrica do módulo: Σ contribuicao(produto) === ticket.
 * `toleranciaReais` absorve só erro de ponto flutuante (default R$0,01) — uma
 * divergência maior indica bug na decomposição, não arredondamento de exibição.
 */
export function verificarInvariante(
  t: TicketFunil,
  toleranciaReais = 0.01,
): { ok: boolean; soma: number; ticket: number; delta: number } {
  const soma = t.produtos.reduce((s, p) => s + p.contribuicao, 0)
  const delta = soma - t.ticket
  return { ok: Math.abs(delta) <= toleranciaReais, soma, ticket: t.ticket, delta }
}
