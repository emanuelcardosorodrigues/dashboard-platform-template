/**
 * Retorna a data atual em UTC-3 (Brasília) no formato YYYY-MM-DD.
 * offsetDays subtrai dias (1 = ontem).
 */
export function brazilDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() - offsetDays)
  return d.toISOString().slice(0, 10)
}
