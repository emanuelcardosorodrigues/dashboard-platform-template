/**
 * C10 — Semântica de DIREÇÃO por métrica (plano mobile v2, Onda 1).
 *
 * O problema que isto resolve: verde/vermelho MENTE em metade das métricas de
 * tráfego. Um CPA subindo é ruim, mas "subiu" pinta de verde se o mapa não
 * souber que ali "menor é melhor". Aqui declaramos, para cada métrica, se o bom
 * é subir ou descer — e derivamos daí um TOM (good/bad/neutral) que o gráfico
 * pareia com um ÍCONE, nunca com cor sozinha (WCAG 1.4.1: cor não pode ser o
 * único indicador de melhor/pior).
 *
 * Fonte da verdade das inversões: `INVERTED` de `lib/thresholds.ts` (cpa/cpc/cpm)
 * — reimportado aqui pra não duplicar a regra — mais os custos e o investimento,
 * que o app já trata como "menor é melhor" no `DeltaBadge invert` e no
 * `planejamento.ts` (maiorMelhor:false).
 */

export type MetricDirection = 'higher_is_better' | 'lower_is_better'
export type MetricTone = 'good' | 'bad' | 'neutral'

/**
 * Métricas onde MENOR é melhor. Custos, CPAs e o investimento entram aqui — o
 * resto do universo (ROAS, receita, taxas de conversão, retenção…) é
 * "higher_is_better" por default, então só precisamos catalogar as exceções.
 */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set([
  // Custos por evento (espelha THRESHOLDS.INVERTED)
  'cpa', 'cpa24h', 'cpc', 'cpm',
  'cpaUpsell', 'custoPorCheckout', 'custoPlay', 'custoPorPitch',
  'custoPor1Min', 'custoPorTag',
  // Investimento: mais gasto não é um "resultado melhor" — o app já inverte a
  // cor dele no DeltaBadge e no planejamento.
  'investimento',
  // Frequência alta = fadiga de público (mais é pior).
  'frequencia',
])

/**
 * Direção de uma métrica pela sua chave (id do METRIC_REGISTRY). Default seguro
 * = "maior é melhor", que cobre a grande maioria das métricas do funil.
 */
export function getMetricDirection(metricKey: string): MetricDirection {
  return LOWER_IS_BETTER.has(metricKey) ? 'lower_is_better' : 'higher_is_better'
}

/**
 * Traduz uma VARIAÇÃO (delta = atual − anterior, ou a inclinação de uma série)
 * no tom correto para aquela métrica. Um delta positivo em ROAS é `good`; o
 * mesmo delta positivo em CPA é `bad`. `0` (ou não-finito) é `neutral`.
 */
export function toneForDelta(metricKey: string, delta: number): MetricTone {
  if (!Number.isFinite(delta) || delta === 0) return 'neutral'
  const up = delta > 0
  const higherIsBetter = getMetricDirection(metricKey) === 'higher_is_better'
  return up === higherIsBetter ? 'good' : 'bad'
}

/**
 * Traduz um VALOR contra um alvo/meta no tom correto. Para ROAS, ficar acima da
 * meta é `good`; para CPA, ficar acima é `bad`.
 */
export function toneForValueVsTarget(
  metricKey: string,
  value: number,
  target: number,
): MetricTone {
  if (!Number.isFinite(value) || !Number.isFinite(target) || value === target) return 'neutral'
  const above = value > target
  const higherIsBetter = getMetricDirection(metricKey) === 'higher_is_better'
  return above === higherIsBetter ? 'good' : 'bad'
}

/**
 * Glifo textual (seta) que ACOMPANHA a cor. `good` sempre aponta pro lado
 * "certo" daquela métrica, então a seta sozinha (sem enxergar cor) já diz
 * melhor/pior — é o requisito do C10.
 *
 * Para ícones React (lucide) o componente decide `ArrowUp`/`ArrowDown` a partir
 * de `getMetricDirection` + `tone`; este helper serve pra SVG/aria/texto puro.
 */
export function toneGlyph(tone: MetricTone): string {
  return tone === 'good' ? '▲' : tone === 'bad' ? '▼' : '—'
}

/** Cor de tom, alinhada ao semáforo do app (emerald/rose/gray). */
export const TONE_COLOR: Record<MetricTone, string> = {
  good: '#10B981',
  bad: '#F43F5E',
  neutral: '#9CA3AF',
}

/** Rótulo humano do tom (para aria-label / legenda textual — C13 depois usa). */
export const TONE_LABEL: Record<MetricTone, string> = {
  good: 'bom',
  bad: 'ruim',
  neutral: 'neutro',
}
