/**
 * Projeção de métricas pra os minigráficos (hover): histórico real + projeção
 * dos próximos N dias.
 *
 * Realidade dos dados (medida no banco): o nível GLOBAL tem ~127 dias contínuos,
 * mas por entidade (criativo/campanha/conjunto) a mediana é 2–3 dias. Projetar
 * 7 dias a partir de 2 pontos seria chute. Então usamos um modelo HIERÁRQUICO
 * COM ENCOLHIMENTO (shrinkage):
 *
 *  1. Sazonalidade por dia-da-semana vem do GLOBAL (confiável, muitos dias).
 *  2. A tendência (slope) da entidade é encolhida em direção a 0/pai conforme
 *     ela tem POUCO histórico — "a assertividade ajusta conforme acumula dado".
 *  3. A confiança (0–1) cresce com o nº de pontos e cai com a volatilidade.
 *
 * Tudo puro e testável; sem dependências.
 */

export interface SeriePonto {
  date: string // YYYY-MM-DD
  value: number | null // null = sem dado naquele dia (ex: anúncio não rodou)
}

export interface ProjecaoResultado {
  history: SeriePonto[] // dias reais (entrada), inclusive nulls
  projection: { date: string; value: number; lo: number; hi: number }[] // futuro
  confidence: number // 0–1
  slope: number // tendência diária usada (após shrinkage)
  basis: 'historico' | 'fallback' | 'sem-dados' // de onde veio a projeção
}

/**
 * Últimos `n` dias ATIVOS da série (pontos com valor), independente de quão
 * antigos sejam. Um ativo que não rodou nos últimos 7 dias de calendário ainda
 * tem janela: os últimos 7 dias em que ELE rodou (ou menos, se rodou menos).
 */
export function ultimosAtivos(history: SeriePonto[], n = 7): SeriePonto[] {
  const validos = history.filter((p) => p.value != null && Number.isFinite(p.value))
  return validos.slice(-n)
}

/** Regressão linear simples (mínimos quadrados) sobre pares (x,y). */
export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length
  if (n === 0) return { slope: 0, intercept: 0 }
  if (n === 1) return { slope: 0, intercept: ys[0] }
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  return { slope, intercept: my - slope * mx }
}

/**
 * Fatores multiplicativos por dia-da-semana (índice 0=domingo … 6=sábado),
 * a partir de uma série global. fator = média(dia da semana) / média(geral).
 * Retorna 1 onde não houver dado suficiente (neutro).
 */
export function diaSemanaFatores(global: SeriePonto[]): number[] {
  const soma = new Array(7).fill(0)
  const cont = new Array(7).fill(0)
  let total = 0
  let totalCont = 0
  for (const p of global) {
    if (p.value == null || !Number.isFinite(p.value)) continue
    const dow = new Date(p.date + 'T12:00:00').getDay()
    soma[dow] += p.value
    cont[dow] += 1
    total += p.value
    totalCont += 1
  }
  const mediaGeral = totalCont > 0 ? total / totalCont : 0
  return soma.map((s, i) => {
    if (cont[i] === 0 || mediaGeral === 0) return 1
    const f = s / cont[i] / mediaGeral
    // clampa pra não explodir com ruído (0.5x–1.8x)
    return Math.max(0.5, Math.min(1.8, f))
  })
}

function nextDateStr(date: string, plusDays: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + plusDays)
  return d.toISOString().slice(0, 10)
}

/**
 * Projeta `horizon` dias à frente a partir do último dia do histórico.
 *
 * @param history  série da entidade (dias reais; nulls permitidos)
 * @param horizon  nº de dias a projetar (default 7)
 * @param dowFatores fatores por dia-da-semana (do global). Default neutro.
 * @param hoje     data de "hoje" (YYYY-MM-DD); a projeção começa em `hoje`.
 *                 Passar de fora pq Date.now() é proibido em alguns contextos.
 */
export function projetarMetrica(
  history: SeriePonto[],
  opts: { horizon?: number; dowFatores?: number[]; hoje: string; fallback?: number | null },
): ProjecaoResultado {
  const horizon = opts.horizon ?? 7
  const dow = opts.dowFatores ?? new Array(7).fill(1)

  // Pontos válidos (com valor) → índices por dia desde o 1º ponto.
  const validos = history
    .map((p, i) => ({ i, date: p.date, v: p.value }))
    .filter((p): p is { i: number; date: string; v: number } => p.v != null && Number.isFinite(p.v))

  const n = validos.length

  // Sem nenhum ponto válido da própria métrica: projeta pelas MÉTRICAS QUE A
  // INFLUENCIAM via `fallback` (ex: agregado do período — CPA = invest÷compras
  // do total) — linha plana com banda larga e confiança mínima. Sem fallback,
  // sinaliza 'sem-dados' (projeção zerada que a UI não deve exibir como real).
  if (n === 0) {
    const fb = opts.fallback
    const temFb = fb != null && Number.isFinite(fb)
    const base = temFb ? Math.max(0, fb) : 0
    const proj: ProjecaoResultado['projection'] = []
    for (let h = 1; h <= horizon; h++) {
      const date = h === 1 ? opts.hoje : nextDateStr(opts.hoje, h - 1)
      const span = base * 0.5 // banda larga: pouca certeza
      proj.push({ date, value: base, lo: Math.max(0, base - span), hi: base + span })
    }
    return { history, projection: proj, confidence: temFb ? 0.15 : 0, slope: 0, basis: temFb ? 'fallback' : 'sem-dados' }
  }
  const ultimoVal = n > 0 ? validos[n - 1].v : 0
  const media = n > 0 ? validos.reduce((a, b) => a + b.v, 0) / n : 0

  // Tendência por mínimos quadrados sobre o índice do dia.
  const fit = linearFit(validos.map((p) => p.i), validos.map((p) => p.v))

  // Shrinkage da tendência: com poucos pontos, encolhe slope→0 (nível plano).
  // peso = n/7 saturando em 1 (≥7 dias → confia 100% na própria tendência).
  const peso = Math.max(0, Math.min(1, n / 7))
  const slope = fit.slope * peso

  // Volatilidade (coef. de variação) → confiança.
  let varianza = 0
  for (const p of validos) varianza += (p.v - media) ** 2
  const desvio = n > 1 ? Math.sqrt(varianza / (n - 1)) : 0
  const cv = media > 0 ? desvio / media : (desvio > 0 ? 1 : 0)
  // confiança: mais pontos ↑, mais volatilidade ↓.
  const confidence = Math.max(0, Math.min(1, peso * (1 - Math.min(1, cv))))

  // Base da projeção: parte do último nível observado (mais robusto que o
  // intercept quando há outliers), seguindo a tendência encolhida.
  const baseDate = history.length > 0 ? history[history.length - 1].date : opts.hoje
  const proj: ProjecaoResultado['projection'] = []
  for (let h = 1; h <= horizon; h++) {
    const date = h === 1 ? opts.hoje : nextDateStr(opts.hoje, h - 1)
    const dowIdx = new Date(date + 'T12:00:00').getDay()
    const baseline = ultimoVal + slope * h
    const valRaw = baseline * dow[dowIdx]
    const val = Math.max(0, valRaw) // métricas não-negativas
    // banda de incerteza cresce com a distância e a volatilidade/baixa confiança
    const span = (desvio || media * 0.25) * (1 + h / horizon) * (1.2 - confidence)
    proj.push({ date, value: val, lo: Math.max(0, val - span), hi: val + span })
  }
  void baseDate

  return { history, projection: proj, confidence, slope, basis: 'historico' }
}
