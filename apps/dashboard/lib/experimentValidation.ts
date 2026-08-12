type VariantInput = { name: string; slug: string; url: string; weight: number }
type ValidationResult = { ok: true } | { ok: false; error: string }

export function validatePageVariant(v: VariantInput): ValidationResult {
  if (!v.url) return { ok: true }
  try {
    new URL(v.url)
  } catch {
    return { ok: false, error: `URL da variante ${v.name} inválida.` }
  }
  return { ok: true }
}

export function findDuplicateSlug(variants: { slug: string }[]): string | null {
  const seen = new Set<string>()
  for (const v of variants) {
    const s = v.slug?.trim()
    if (!s) continue
    if (seen.has(s)) return s
    seen.add(s)
  }
  return null
}
