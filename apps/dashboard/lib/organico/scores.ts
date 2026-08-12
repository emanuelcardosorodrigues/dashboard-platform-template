/**
 * Scores determinísticos do conteúdo orgânico (regra do dono: zero IA aqui).
 *
 * Normalização de idade: comparar post de 2 dias com post de 2 anos mente —
 * a base de comparação é VIEWS/DIA desde a publicação (quando o cron de
 * insights popular first7_views com série diária real, ele passa a ser a base
 * persistida; este cálculo live é o fallback determinístico).
 *
 * - outlier  = views/dia ÷ MEDIANA do cohort (mediana, não média — resiste a
 *              virais que distorceriam o baseline). "2.4×" = 2.4x a mediana.
 * - composite = média de min(pilar ÷ mediana do cohort, 3.0) × 100 sobre os
 *              pilares DISPONÍVEIS (engajamento, retenção, descoberta).
 *              100 = mediana do cohort; ≥150 = campeão.
 * - cohort   = plataforma+formato quando n≥5; senão plataforma inteira.
 */

export interface ScorablePost {
  id: string
  platform: string
  format: string | null
  published_at: string
  duration_seconds: number | null
  views: number | null
  likes: number | null
  comments_count: number | null
  shares: number | null
  saves: number | null
  apv: number | null
  completion_rate: number | null
  avg_watch_time_s: number | null
}

export interface PostScores {
  outlier: number | null
  composite: number | null
  viewsPerDay: number | null
}

/**
 * Pontuação composta mínima para classificar um post como "campeão".
 *
 * Semântica: composite = 100 equivale exatamente à mediana do cohort
 * (plataforma+formato, ou só plataforma quando n<MIN_COHORT). Um post com
 * composite ≥ 150 está 50% acima da mediana em todos os pilares disponíveis
 * (engajamento, retenção, views/dia) — raridade que justifica o destaque.
 *
 * Por que 150 e não outro valor:
 *  - < 120: noise (variação natural do algoritmo soa como campeão)
 *  - 120–149: "acima da média" — útil como badge, mas não excepcional
 *  - 150: calibrado para identificar o top ~15% do cohort em distribuição
 *    típica de conteúdo DEMO (referência interna; ajustar se o mix mudar)
 *  - > 180: muito restritivo — deixa campeões reais de fora
 *
 * Para ajustar: altere APENAS este valor. Não crie config de banco ainda;
 * quando a análise de distribuição real justificar, extraia para workspace_config.
 */
export const CHAMPION_THRESHOLD = 150
const MIN_COHORT = 5

export function median(ns: number[]): number | null {
  if (ns.length === 0) return null
  const s = [...ns].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function viewsPerDay(post: ScorablePost, nowMs: number): number | null {
  if (post.views == null) return null
  const ageDays = Math.max(1, (nowMs - new Date(post.published_at).getTime()) / 86400_000)
  return post.views / ageDays
}

/** Engajamento por view (likes+comments+shares+saves ÷ views). null sem views. */
export function engagementRate(post: ScorablePost): number | null {
  if (post.views == null || post.views <= 0) return null
  const eng = (post.likes ?? 0) + (post.comments_count ?? 0) + (post.shares ?? 0) + (post.saves ?? 0)
  return eng / post.views
}

/** Pilar de retenção disponível: APV (YT) > completion (TikTok) > watch/duração. */
export function retentionPillar(post: ScorablePost): number | null {
  if (post.apv != null) return post.apv
  if (post.completion_rate != null) return post.completion_rate
  if (post.avg_watch_time_s != null && post.duration_seconds != null && post.duration_seconds > 0) {
    return Math.min(100, (post.avg_watch_time_s / post.duration_seconds) * 100)
  }
  return null
}

function cohortKey(p: ScorablePost, counts: Map<string, number>): string {
  const full = `${p.platform}|${p.format ?? '?'}`
  return (counts.get(full) ?? 0) >= MIN_COHORT ? full : p.platform
}

export function computeScores(posts: ScorablePost[], nowMs: number): Map<string, PostScores> {
  const out = new Map<string, PostScores>()
  const fullCounts = new Map<string, number>()
  for (const p of posts) {
    const k = `${p.platform}|${p.format ?? '?'}`
    fullCounts.set(k, (fullCounts.get(k) ?? 0) + 1)
  }

  // medianas por cohort, por pilar
  const byCohort = new Map<string, { vpd: number[]; eng: number[]; ret: number[] }>()
  const perPost = new Map<string, { key: string; vpd: number | null; eng: number | null; ret: number | null }>()
  for (const p of posts) {
    const key = cohortKey(p, fullCounts)
    const vpd = viewsPerDay(p, nowMs)
    const eng = engagementRate(p)
    const ret = retentionPillar(p)
    perPost.set(p.id, { key, vpd, eng, ret })
    const c = byCohort.get(key) ?? { vpd: [], eng: [], ret: [] }
    if (vpd != null) c.vpd.push(vpd)
    if (eng != null) c.eng.push(eng)
    if (ret != null) c.ret.push(ret)
    byCohort.set(key, c)
  }
  const medians = new Map<string, { vpd: number | null; eng: number | null; ret: number | null }>()
  for (const [key, c] of byCohort) {
    medians.set(key, { vpd: median(c.vpd), eng: median(c.eng), ret: median(c.ret) })
  }

  for (const p of posts) {
    const pp = perPost.get(p.id)!
    const med = medians.get(pp.key)!
    const outlier = pp.vpd != null && med.vpd != null && med.vpd > 0
      ? Math.round((pp.vpd / med.vpd) * 10) / 10
      : null

    const ratios: number[] = []
    if (pp.eng != null && med.eng != null && med.eng > 0) ratios.push(Math.min(pp.eng / med.eng, 3))
    if (pp.ret != null && med.ret != null && med.ret > 0) ratios.push(Math.min(pp.ret / med.ret, 3))
    if (pp.vpd != null && med.vpd != null && med.vpd > 0) ratios.push(Math.min(pp.vpd / med.vpd, 3))
    const composite = ratios.length > 0
      ? Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 1000) / 10
      : null

    out.set(p.id, { outlier, composite, viewsPerDay: pp.vpd })
  }
  return out
}
