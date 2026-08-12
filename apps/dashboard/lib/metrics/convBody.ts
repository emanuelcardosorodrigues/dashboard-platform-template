/**
 * Conversão do BODY = vendas front ÷ visualizações de 75% do vídeo.
 *
 * De quem assistiu até o fim, quantos compraram. Isola a força do MIOLO do criativo — o
 * gancho já é medido pelo Hook Rate; aqui o que pesa é se a promessa/oferta do corpo
 * converteu quem ficou.
 *
 * A trava do denominador existe porque a métrica SÓ FAZ SENTIDO PRA VÍDEO. Anúncio de
 * imagem tem `views_75pct` residual (1, 2…) e a razão explode: o `demo-lps-img-02` tinha
 * 7 compras ÷ 1 view75 = **700%**. Isso é a mesma família de erro do connect rate e da
 * passagem — razão cujo denominador não sustenta a taxa. Abaixo do piso o certo é dizer
 * "não dá pra medir" (—), nunca cuspir uma porcentagem fantasma.
 */

/**
 * Mínimo de views 75% pro % valer como número. Abaixo disso o denominador é pequeno demais
 * (e, na prática, significa "não é vídeo"): a métrica vira `undefined` e a UI mostra "—".
 */
export const MIN_VIEWS_75_CONV_BODY = 30

/** `undefined` quando o denominador não sustenta a taxa — nunca 0% nem % fantasma. */
export function convBodyPct(vendasFront: number, views75: number): number | undefined {
  if (!Number.isFinite(views75) || views75 < MIN_VIEWS_75_CONV_BODY) return undefined
  return (vendasFront / views75) * 100
}

/** Versão em fração (0–1), pro card da Análise de Criativos. `null` = imensurável. */
export function convBodyFrac(vendasFront: number, views75: number): number | null {
  const pct = convBodyPct(vendasFront, views75)
  return pct === undefined ? null : pct / 100
}
