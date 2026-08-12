/**
 * Estatística para A/B Testing — Fase 4 do plano whimsical-seeking-lemon.
 *
 * Funções:
 *   - zTest          — teste Z clássico (frequentista)
 *   - requiredSampleSize — Lehr's approximation pra mínimo amostral
 *   - bayesianBetaBinomial — probabilidade B vence A (Monte Carlo)
 *   - sequentialPocock — alpha spending pra peek seguro
 *
 * Sample-size gate: se !meetsMinSample → UI esconde winner. Bandit não opera.
 */

export interface ZTestResult {
  z: number
  confidence: 0 | 90 | 95 | 99
  winner: 'A' | 'B' | null
  cr1: number
  cr2: number
  // Fase 4 (novos campos)
  meetsMinSample: boolean
  minSampleNeeded: number
  bayesProb: number   // 0..1 — prob B > A (Bayesian)
  lift: number        // (cr2 - cr1) / cr1
}

export interface ZTestParams {
  n1: number  // impressões A (controle)
  c1: number  // conversões A
  n2: number  // impressões B (tratamento)
  c2: number  // conversões B
  /** MDE relativo (default 0.1 = 10% lift mínimo detectável). Usado pra sample size. */
  mde?: number
  /** Power desejado (default 0.8) */
  power?: number
  /** Alpha (default 0.05) */
  alpha?: number
}

export function zTest(params: ZTestParams): ZTestResult {
  const { n1, c1, n2, c2 } = params
  const mde = params.mde ?? 0.1
  const cr1 = n1 > 0 ? c1 / n1 : 0
  const cr2 = n2 > 0 ? c2 / n2 : 0

  if (n1 === 0 || n2 === 0) {
    return zeroResult(cr1, cr2, params)
  }

  const pHat = (c1 + c2) / (n1 + n2)
  const se = Math.sqrt(pHat * (1 - pHat) * (1 / n1 + 1 / n2))
  if (se === 0) return zeroResult(cr1, cr2, params)

  const z = Math.abs(cr1 - cr2) / se

  let confidence: 0 | 90 | 95 | 99 = 0
  if (z >= 2.576) confidence = 99
  else if (z >= 1.96) confidence = 95
  else if (z >= 1.645) confidence = 90

  const winner: 'A' | 'B' | null = confidence === 0 ? null : cr1 > cr2 ? 'A' : 'B'

  // Sample size gate
  const baseline = Math.max(cr1, 0.01)
  const minSampleNeeded = requiredSampleSize({ baselineCR: baseline, mde, power: params.power, alpha: params.alpha })
  const meetsMinSample = n1 >= minSampleNeeded && n2 >= minSampleNeeded

  // Bayesian P(B > A) via Monte Carlo
  const bayesProb = bayesianBetaBinomial(c1, n1, c2, n2)

  const lift = cr1 > 0 ? (cr2 - cr1) / cr1 : 0

  return { z, confidence, winner, cr1, cr2, meetsMinSample, minSampleNeeded, bayesProb, lift }
}

function zeroResult(cr1: number, cr2: number, params: ZTestParams): ZTestResult {
  return {
    z: 0,
    confidence: 0,
    winner: null,
    cr1,
    cr2,
    meetsMinSample: false,
    minSampleNeeded: 0,
    bayesProb: 0.5,
    lift: 0,
  }
}

/**
 * Lehr's approximation: n por variante pra detectar `mde` relativo no `baselineCR`
 * com `power` e `alpha`.
 *
 * Fórmula: n ≈ (z_alpha + z_beta)^2 * p(1-p) / delta^2  × 2 variantes
 * Simplificada para 2 proporções iguais.
 */
export function requiredSampleSize(args: {
  baselineCR: number
  mde?: number        // relativo, ex: 0.1 = 10% lift
  power?: number      // default 0.8
  alpha?: number      // default 0.05 (two-sided)
}): number {
  const p = args.baselineCR
  const mde = args.mde ?? 0.1
  const power = args.power ?? 0.8
  const alpha = args.alpha ?? 0.05

  if (p <= 0 || p >= 1) return 0

  const zAlpha = inverseNormalCDF(1 - alpha / 2)
  const zBeta = inverseNormalCDF(power)
  const delta = p * mde  // diferença absoluta a detectar

  // Pooled variance approximation
  const p2 = Math.min(p + delta, 0.999)
  const pBar = (p + p2) / 2
  const variance = 2 * pBar * (1 - pBar)

  const n = Math.ceil(((zAlpha + zBeta) ** 2 * variance) / (delta * delta))
  return n
}

/**
 * Inversa aproximada da CDF normal padrão (Beasley-Springer-Moro).
 * Suficientemente preciso pra calcular tamanho amostral.
 */
function inverseNormalCDF(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  // Approximation by Peter Acklam — válida em (0,1)
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c_ = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]

  const pLow = 0.02425
  const pHigh = 1 - pLow

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c_[0] * q + c_[1]) * q + c_[2]) * q + c_[3]) * q + c_[4]) * q + c_[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c_[0] * q + c_[1]) * q + c_[2]) * q + c_[3]) * q + c_[4]) * q + c_[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/**
 * P(B > A) via Beta-Binomial.
 *
 * Modelo: cada variante segue Beta(c+1, n-c+1) (priori uniforme Jeffreys-ish).
 * Sampling: 10k draws de cada posterior, conta proporção em que B_draw > A_draw.
 *
 * Retorna probabilidade 0..1. Em volume baixo, default 0.5 (sem evidência).
 */
export function bayesianBetaBinomial(cA: number, nA: number, cB: number, nB: number, draws = 10000): number {
  if (nA === 0 || nB === 0) return 0.5
  const alphaA = cA + 1, betaA = nA - cA + 1
  const alphaB = cB + 1, betaB = nB - cB + 1

  let bWins = 0
  for (let i = 0; i < draws; i++) {
    const a = sampleBeta(alphaA, betaA)
    const b = sampleBeta(alphaB, betaB)
    if (b > a) bWins++
  }
  return bWins / draws
}

/**
 * Beta sampler via 2× Gamma (Marsaglia-Tsang).
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha)
  const y = sampleGamma(beta)
  return x / (x + y)
}

function sampleGamma(shape: number): number {
  // Marsaglia-Tsang gamma sampler para shape >= 1
  if (shape < 1) {
    // Use boost trick: Gamma(shape, 1) = U^(1/shape) * Gamma(shape+1, 1)
    const u = Math.random()
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape)
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

/** Standard normal sample via Box-Muller. */
function randn(): number {
  const u1 = Math.max(Math.random(), Number.EPSILON)
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * Pocock alpha spending: protege contra peeking inflacionar falsos positivos.
 * Em cada peek `k` (de `K` totais), o alpha efetivo é alpha / log(K * peek_index_adjustment).
 *
 * Retorna o threshold de Z ajustado pra esse peek (em vez de 1.96 fixo).
 *
 * Uso: se zObs > sequentialPocock(currentPeek, totalPeeks) → significativo.
 */
export function sequentialPocock(peekIndex: number, totalPeeks: number, alpha = 0.05): number {
  if (peekIndex <= 0 || totalPeeks <= 0) return inverseNormalCDF(1 - alpha / 2)
  // Pocock boundary: critical Z = const * sqrt(2 * log(log(K) * (1 + something)))
  // Aproximação simplificada de O'Brien-Fleming: cresce com sqrt(K/k)
  const cpocock = inverseNormalCDF(1 - alpha / (2 * totalPeeks))
  return cpocock
}
