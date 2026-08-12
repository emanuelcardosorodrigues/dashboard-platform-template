import type { SbExperiment, SbVariant } from './supabase'

function pathnameFromUrl(url?: string): string | null {
  if (!url) return null
  try {
    return new URL(url).pathname.replace(/^\/|\/$/g, '') || null
  } catch {
    return null
  }
}

// Para cada checkout/ob, calcula o conjunto de segments[0] (slug de página)
// considerados legítimos: variantes de page exps que roteiam pra essa
// entry_path (default: page.entry_path == this.entry_path; ou page.checkout_slug == this.entry_path).
// Quando o set vai vazio, matchSaleToVariant cai no comportamento legado (lenient)
// pra não quebrar atribuição de páginas ad-hoc fora do sistema de exps.
export function buildAllowedPageSegments(allExps: SbExperiment[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const pageExps = allExps.filter(e => e.type === 'page')
  for (const exp of allExps) {
    if (exp.type === 'page') continue
    const allowed = new Set<string>()
    for (const pe of pageExps) {
      const routesToHere = (pe.checkout_slug ?? pe.entry_path) === exp.entry_path
      if (!routesToHere) continue
      for (const v of pe.variants) {
        const seg = pathnameFromUrl(v.url) ?? v.slug
        allowed.add(seg)
      }
    }
    map.set(exp.id, allowed)
  }
  return map
}

export function matchSaleToVariant(
  sckSlug: string,
  exp: SbExperiment,
  variant: SbVariant,
  allowedPageSegments?: Set<string>,
): boolean {
  if (!sckSlug) return false
  const segments = sckSlug.split('_')
  if (exp.type === 'checkout' || exp.type === 'ob') {
    if (allowedPageSegments && allowedPageSegments.size > 0) {
      if (!allowedPageSegments.has(segments[0])) return false
    }
    const prefix = exp.type === 'checkout' ? 'ck' : 'ob'
    return segments.some(s => s === `${prefix}${variant.slug}`)
  }
  // page: match estrito por ID da variante via marcador pv injetado pelo Worker.
  // Buscar a partir de segments[1] pra evitar colisão se o page slug começar com 'pv'.
  // Sem fallback de URL pathname — vendas sem pv-marker ficam visíveis nas seções
  // "Slugs sem teste ativo" e "Slugs nunca testados", e não vazam pra cards de
  // experimentos cuja URL coincidentemente bate com o page slug histórico.
  const pvSegment = segments.slice(1).find(s => s.startsWith('pv'))
  return pvSegment === `pv${variant.slug}`
}

export function findOrphanSales(
  sales: Record<string, { count: number; receita: number }>,
  exps: SbExperiment[],
): { sck_slug: string; count: number; receita: number }[] {
  return Object.entries(sales)
    .filter(([sckSlug]) =>
      !exps.some(exp => exp.variants.some(v => matchSaleToVariant(sckSlug, exp, v)))
    )
    .map(([sck_slug, agg]) => ({ sck_slug, ...agg }))
}

export type OrphanBucket = {
  sckSlug: string
  count: number
  receita: number
  lastExperimentName?: string
  lastExperimentEndedAt?: string | null
}

export type OrphanClassification = {
  inactive: OrphanBucket[]
  neverTested: OrphanBucket[]
}

export function classifyOrphanSlugs(
  sales: Record<string, { count: number; receita: number }>,
  pageExps: SbExperiment[],
): OrphanClassification {
  const inactive: OrphanBucket[] = []
  const neverTested: OrphanBucket[] = []

  for (const [sckSlug, agg] of Object.entries(sales)) {
    const matchingExps = pageExps.filter(exp =>
      exp.variants.some(v => matchSaleToVariant(sckSlug, exp, v))
    )
    if (matchingExps.some(e => e.status === 'active')) continue

    const bucket: OrphanBucket = { sckSlug, count: agg.count, receita: agg.receita }

    if (matchingExps.length > 0) {
      const last = [...matchingExps].sort((a, b) => {
        const ta = a.ended_at ?? a.started_at ?? a.created_at
        const tb = b.ended_at ?? b.started_at ?? b.created_at
        return tb.localeCompare(ta)
      })[0]
      bucket.lastExperimentName = last.name
      bucket.lastExperimentEndedAt = last.ended_at
      inactive.push(bucket)
    } else {
      neverTested.push(bucket)
    }
  }

  inactive.sort((a, b) => b.receita - a.receita)
  neverTested.sort((a, b) => b.receita - a.receita)
  return { inactive, neverTested }
}
