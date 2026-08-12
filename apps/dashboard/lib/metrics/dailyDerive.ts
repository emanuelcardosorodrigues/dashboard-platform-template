/**
 * Componentes diários por entidade (criativo/campanha/conjunto) e derivação do
 * valor de cada métrica num dia, pros minigráficos hover.
 *
 * A página entrega, por linha, uma série contínua de `DailyComp` (1 por dia da
 * janela; zeros onde não houve atividade). O hover deriva o valor diário da
 * métrica a partir desses componentes — absolutos viram 0 em dia sem dado;
 * razões viram null (lacuna no gráfico), que é o honesto.
 */

export interface DailyComp {
  d: string // YYYY-MM-DD
  inv: number
  fat: number
  imp: number
  alc: number
  cliques: number
  lpv: number // landing page views
  checkouts: number
  v3: number
  v75: number
  v95: number
  vendasFront: number
}

export function emptyComp(d: string): DailyComp {
  return { d, inv: 0, fat: 0, imp: 0, alc: 0, cliques: 0, lpv: 0, checkouts: 0, v3: 0, v75: 0, v95: 0, vendasFront: 0 }
}

/** Valor da métrica `id` no dia `c`. null = lacuna (denominador 0 numa razão). */
export function deriveDailyValue(id: string, c: DailyComp): number | null {
  switch (id) {
    // absolutos
    case 'investimento': return c.inv
    case 'faturamento': return c.fat
    case 'lucro': return c.fat - c.inv
    case 'impressoes': return c.imp
    case 'alcance': return c.alc
    case 'cliques': return c.cliques
    case 'landingViews': return c.lpv
    case 'checkouts': return c.checkouts
    case 'views3s': return c.v3
    case 'views75': return c.v75
    case 'views95': return c.v95
    case 'vendasFront': return c.vendasFront
    // razões (null quando não faz sentido no dia)
    case 'roas': return c.inv > 0 ? c.fat / c.inv : null
    case 'roasSoFront': return c.inv > 0 ? c.fat / c.inv : null
    case 'cpa': return c.vendasFront > 0 ? c.inv / c.vendasFront : null
    case 'cpm': return c.imp > 0 ? (c.inv / c.imp) * 1000 : null
    case 'cpc': return c.cliques > 0 ? c.inv / c.cliques : null
    case 'ctr': return c.imp > 0 ? (c.cliques / c.imp) * 100 : null
    case 'frequencia': return c.alc > 0 ? c.imp / c.alc : null
    case 'cvrPagina': return c.cliques > 0 ? (c.lpv / c.cliques) * 100 : null
    case 'cvrCheckout': return c.lpv > 0 ? (c.checkouts / c.lpv) * 100 : null
    case 'hookRate': return c.imp > 0 ? (c.v3 / c.imp) * 100 : null
    case 'convClique': return c.cliques > 0 ? (c.vendasFront / c.cliques) * 100 : null
    case 'txConversaoPagina': return c.lpv > 0 ? (c.vendasFront / c.lpv) * 100 : null
    case 'custoPorCheckout': return c.checkouts > 0 ? c.inv / c.checkouts : null
    case 'rpc': return c.cliques > 0 ? c.fat / c.cliques : null
    case 'lpc': return c.cliques > 0 ? (c.fat - c.inv) / c.cliques : null
    default: return null // métrica sem série diária → sem hover
  }
}

/** Métricas que têm derivação diária (ganham o minigráfico hover). */
export const METRICAS_COM_SPARKLINE = new Set<string>([
  'investimento', 'faturamento', 'lucro', 'impressoes', 'alcance', 'cliques',
  'landingViews', 'checkouts', 'views3s', 'views75', 'views95', 'vendasFront',
  'roas', 'roasSoFront', 'cpa', 'cpm', 'cpc', 'ctr', 'frequencia', 'cvrPagina',
  'cvrCheckout', 'hookRate', 'convClique', 'txConversaoPagina', 'custoPorCheckout',
  'rpc', 'lpc',
])
