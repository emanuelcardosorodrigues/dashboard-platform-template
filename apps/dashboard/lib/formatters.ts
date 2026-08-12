/**
 * Format a number as Brazilian currency: R$ 12.345,67
 */
export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Format a number as compact currency: R$ 12,3k or R$ 1,2M
 */
export function formatCurrencyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `R$ ${(value / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`
  }
  return formatCurrency(value)
}

/**
 * Format a percentage: 12,34%
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`
}

/**
 * Format a plain number with Brazilian locale: 1.234,56
 */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format ROAS: 2,5x
 */
export function formatRoas(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
}

/**
 * Format a delta (positive or negative percentage change)
 */
export function formatDelta(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

/**
 * Format date to Brazilian format: 01/01/2024
 */
export function formatDateBR(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`
  }
  return dateStr
}

/**
 * Parse a Brazilian currency string to number
 */
export function parseCurrencyBR(value: string): number {
  if (!value) return 0
  const cleaned = value
    .replace(/R\$\s?/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

/**
 * Parse a percentage string to number
 */
export function parsePercent(value: string): number {
  if (!value) return 0
  const cleaned = value.replace('%', '').replace(',', '.').trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

/**
 * Returns the human-readable label for the front-end product based on the active funil filter.
 * Use wherever "Front-end" is shown as a column header or legend label.
 */
export function getFrontEndLabel(funil?: string): string {
  const f = (funil || '').toLowerCase()
  if (f.includes('col')) return 'Produto Demonstrativo'
  if (f.includes('dpl')) return 'Protocolo Dentista Parceiro'
  if (f.includes('plo')) return 'Protocolo Lucro Oculto'
  if (f.includes('lps')) return 'Imersão Lucro Clínico'
  return 'Principal'
}

/**
 * Data de hoje em America/Sao_Paulo no formato YYYY-MM-DD.
 * `new Date().toISOString()` retorna UTC — depois das 21h BRT vira o dia seguinte
 * e infla contagens de "X dias com dados". Usar isto em qualquer cálculo de "hoje".
 */
export function todayBR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/**
 * Data N dias atrás em America/Sao_Paulo no formato YYYY-MM-DD.
 */
export function daysAgoBR(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

// Modelos LEGADOS de taxa Hotmart (9,99% e 8,4%+R$3,49) REMOVIDOS na F2 —
// ambos estavam errados. Fonte única: lib/hotmartFees.ts (8,9% + R$1 + vídeo).

/**
 * Parse any numeric string (handles comma as decimal)
 */
export function parseNumber(value: string | number | undefined | null): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return isNaN(value) ? 0 : value
  const cleaned = String(value)
    .replace(/R\$\s?/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}
