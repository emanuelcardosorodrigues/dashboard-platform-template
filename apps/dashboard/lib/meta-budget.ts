/**
 * Parsing de orçamento em R$ (pt-BR) → centavos. Puro e testável.
 *
 * Caminho de DINHEIRO: um parser frouxo causou (em revisão) um bug de 100x —
 * tratar ponto como decimal vira milhares ("1500.50" → R$150.050). Aqui é
 * ESTRITO: só aceita a convenção pt-BR (milhares com ponto, decimal com vírgula)
 * e rejeita qualquer coisa ambígua devolvendo null. O servidor ainda reforça
 * (compare-and-set + teto absoluto), mas a UI não deve nem deixar submeter.
 */

/**
 * Aceita só: "1500", "1.500", "1500,50", "1.500,50", "12.345.678,90".
 * Rejeita (→ null): vazio, "1500.50", "1.50", "12.34.56", "abc", "-5", "0".
 */
export function parseReaisToCents(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  // (milhares-com-ponto OU inteiro puro) + decimal-com-vírgula opcional (1–2 casas)
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(s)) return null
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}
