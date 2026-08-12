/**
 * Taxa Hotmart — modelo CANÔNICO (fonte da verdade). Determinístico
 * ([[feedback_hardcode_over_ai]]). Decisão final do dono do negócio (2026-07-02):
 *
 *   taxa(v) = 8,9% × v  +  R$ 1,00 fixo por venda  +  adicional de vídeo
 *   adicional de vídeo: produto ≤ R$ 97 → R$ 0,30 · produto > R$ 97 → R$ 2,49
 *
 * O limiar de R$ 97 é INCLUSIVO no piso barato (v = 97 usa R$ 0,30).
 * Hoje TODOS os produtos têm vídeo, então o adicional sempre incide.
 *
 * A taxa é POR TRANSAÇÃO. Para uma lista de vendas, some o líquido de cada uma
 * (`liquidoHotmartTransacoes`) — somar o modelo sobre o agregado erra quando há
 * mix de faixas de preço (o fixo e o adicional de vídeo dependem da contagem e
 * do valor de cada transação, não do total).
 *
 * `v` = valor_bruto da transação. O parcelamento da Hotmart já vem normalizado
 * para o valor total da venda no webhook — não é o valor da parcela.
 */

/** Percentual sobre o valor bruto da venda. */
export const HOTMART_PCT = 0.089
/** Taxa fixa (R$) por transação. */
export const HOTMART_FIXA = 1.0
/** Adicional de vídeo (R$) para produtos com valor ≤ HOTMART_LIMIAR_VIDEO. */
export const HOTMART_VIDEO_ATE_97 = 0.3
/** Adicional de vídeo (R$) para produtos com valor > HOTMART_LIMIAR_VIDEO. */
export const HOTMART_VIDEO_ACIMA_97 = 2.49
/** Limiar (R$) do adicional de vídeo. INCLUSIVO no piso barato (v = 97 → 0,30). */
export const HOTMART_LIMIAR_VIDEO = 97

/** Adicional de vídeo aplicável ao valor bruto da venda. */
function adicionalVideo(valorBruto: number): number {
  return valorBruto <= HOTMART_LIMIAR_VIDEO ? HOTMART_VIDEO_ATE_97 : HOTMART_VIDEO_ACIMA_97
}

/** Taxa total (R$) que a Hotmart cobra numa transação de `valorBruto`. */
export function taxaHotmartVenda(valorBruto: number): number {
  const v = Number(valorBruto) || 0
  return v * HOTMART_PCT + HOTMART_FIXA + adicionalVideo(v)
}

/** Valor líquido (R$) que sobra da transação após a taxa Hotmart. */
export function liquidoHotmartVenda(valorBruto: number): number {
  const v = Number(valorBruto) || 0
  return v - taxaHotmartVenda(v)
}

/**
 * Soma dos líquidos por transação (modelo EXATO). Use sempre que tiver a lista
 * de valores brutos — captura o fixo e o adicional de vídeo por transação.
 */
export function liquidoHotmartTransacoes(valores: number[]): number {
  let total = 0
  for (const v of valores) total += liquidoHotmartVenda(v)
  return total
}

/**
 * Taxa fixa POR VENDA para o modelo AGREGADO do planejamento (simulador),
 * onde só há totais (faturamento + nº de vendas): R$ 1,00 + R$ 2,49 de vídeo,
 * assumindo ticket > R$ 97 (caso típico do front no DEMO). Superestima em até
 * R$ 2,19/venda quando há OBs ≤ R$ 97 — direção CONSERVADORA pra planejar
 * (nunca infla o lucro previsto). O realizado usa o modelo exato por transação.
 */
export const HOTMART_FIXA_PLANEJAMENTO = HOTMART_FIXA + HOTMART_VIDEO_ACIMA_97
