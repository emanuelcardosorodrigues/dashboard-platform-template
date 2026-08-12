/**
 * Bandit Mode v2 — Thompson Sampling com guardrails.
 * Fase 5 do plano whimsical-seeking-lemon.
 *
 * Estratégia:
 *   1. Cada variante modelada como Beta(conv+1, nonconv+1) — posterior bayesiano.
 *   2. Pra cada decisão, amostra de cada posterior e atribui peso ∝ frequência de win.
 *   3. Guardrails:
 *      - min(conv) < bandit_min_conv → retorna uniformWeights (sem ruído)
 *      - champion_variant definido → peso ≥ championMinWeight (default 60%)
 *
 * Função pura — testável sem DB/Worker.
 */

export interface VariantStats {
  slug: string
  conv: number
  imp: number
}

export interface ThompsonOpts {
  minConv?: number
  championSlug?: string
  championMinWeight?: number
  /** Número de simulações Monte Carlo (default 10k) */
  draws?: number
}

export interface BanditWeights {
  weights: Record<string, number>
  reason: string
}

/**
 * Retorna pesos por slug somando 1.0. Honra champion lock e min_conv guard.
 */
export function thompsonSample(
  variants: VariantStats[],
  opts: ThompsonOpts = {}
): BanditWeights {
  const minConv = opts.minConv ?? 30
  const championSlug = opts.championSlug
  const championMinWeight = opts.championMinWeight ?? 0.6
  const draws = opts.draws ?? 10000

  if (variants.length === 0) {
    return { weights: {}, reason: 'no_variants' }
  }

  // Guard 1: min conv. Se alguma variante ainda não atingiu, distribui uniforme.
  const minConvActual = Math.min(...variants.map(v => v.conv))
  if (minConvActual < minConv) {
    return { weights: uniformWeights(variants), reason: `min_conv_not_met:${minConvActual}<${minConv}` }
  }

  // Thompson Sampling: count wins de cada variante
  const wins: Record<string, number> = {}
  for (const v of variants) wins[v.slug] = 0

  for (let i = 0; i < draws; i++) {
    let bestSlug = ''
    let bestSample = -1
    for (const v of variants) {
      const alpha = v.conv + 1
      const beta = (v.imp - v.conv) + 1
      const sample = sampleBeta(alpha, beta)
      if (sample > bestSample) {
        bestSample = sample
        bestSlug = v.slug
      }
    }
    wins[bestSlug] = (wins[bestSlug] ?? 0) + 1
  }

  // Normaliza wins → weights
  const weights: Record<string, number> = {}
  for (const slug in wins) weights[slug] = wins[slug] / draws

  // Floor mínimo: cada variante recebe ≥ 5% pra continuar explorando
  const exploreFloor = 0.05
  const slugs = variants.map(v => v.slug)
  let totalFloor = 0
  for (const s of slugs) {
    if (weights[s] < exploreFloor) {
      const diff = exploreFloor - weights[s]
      weights[s] = exploreFloor
      totalFloor += diff
    }
  }
  // Subtrai o floor consumido proporcionalmente das variantes acima do floor
  if (totalFloor > 0) {
    const aboveFloor = slugs.filter(s => weights[s] > exploreFloor)
    const sumAbove = aboveFloor.reduce((a, s) => a + weights[s], 0)
    if (sumAbove > 0) {
      for (const s of aboveFloor) {
        weights[s] -= totalFloor * (weights[s] / sumAbove)
      }
    }
  }

  // Guard 2: champion lock
  if (championSlug && slugs.includes(championSlug)) {
    if (weights[championSlug] < championMinWeight) {
      const deficit = championMinWeight - weights[championSlug]
      weights[championSlug] = championMinWeight
      // Distribui o deficit proporcionalmente entre as outras
      const others = slugs.filter(s => s !== championSlug)
      const sumOthers = others.reduce((a, s) => a + weights[s], 0)
      if (sumOthers > 0) {
        for (const s of others) {
          weights[s] -= deficit * (weights[s] / sumOthers)
          weights[s] = Math.max(weights[s], exploreFloor)
        }
      }
    }
  }

  return { weights, reason: 'thompson_sampling_ok' }
}

function uniformWeights(variants: VariantStats[]): Record<string, number> {
  const w: Record<string, number> = {}
  const n = variants.length
  for (const v of variants) w[v.slug] = 1 / n
  return w
}

function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha)
  const y = sampleGamma(beta)
  return x / (x + y)
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    let x: number, v: number
    do {
      x = randn()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function randn(): number {
  const u1 = Math.max(Math.random(), Number.EPSILON)
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}
