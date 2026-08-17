/**
 * URL pública de entrada do Worker A/B de um projeto.
 *
 * Guardamos sem protocolo (ex.: `cliente.com.br/r`) porque a interface mostra
 * esse formato e acrescenta `https://` apenas quando o link é copiado/aberto.
 */
export const DEFAULT_AB_ENTRY_BASE = 'seudominio.com.br/r'

export function normalizeAbEntryBase(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const path = url.pathname.replace(/\/+$/, '')
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || path !== '/r') return null
    return `${url.host.toLowerCase()}/r`
  } catch {
    return null
  }
}

export function entryBaseForWorkspace(value: string | null | undefined, legacyBase?: string | null): string {
  return normalizeAbEntryBase(value) ?? normalizeAbEntryBase(legacyBase) ?? DEFAULT_AB_ENTRY_BASE
}

export function experimentEntryLink(entryBase: string, type: string | null | undefined, entryPath: string): string {
  const path = entryPath.startsWith('/') ? entryPath : `/${entryPath}`
  return type === 'checkout' ? `${entryBase}/check${path}` : `${entryBase}${path}`
}

export function experimentEntryUrl(entryBase: string, type: string | null | undefined, entryPath: string): string {
  return `https://${experimentEntryLink(entryBase, type, entryPath)}`
}
