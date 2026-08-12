/**
 * Tempo lead→compra (dias) entre o preenchimento da ficha e a 1ª compra.
 *
 * Cruza transações × qualificação por email (mesma convenção do buildPerpetuoDetalhes:
 * lowercase). Anti-ruído — a coluna `created_at` da ficha NÃO é um "quando preencheu"
 * limpo: (a) o webhook da Hotmart cria um "stub" `{email,nome}` no ato da compra, então
 * `created_at ≈ compra` → 0 dia; (b) houve um import em massa (todas as fichas com o
 * mesmo created_at). Por isso: só fichas REAIS (`tem_ficha === true`, o stub não seta
 * essa flag) e janela [1, 365] dias (corta o stub de 0 dia e âncoras absurdas do import).
 * A MEDIANA é o número-título (robusta a outliers); `n` vai junto pra transparência.
 */
import type { SbTransacao, SbQualificacao } from '@/lib/supabase'

/** `created_at` existe na linha em runtime (select('*')) mas não está no tipo. */
export type QualComData = SbQualificacao & { created_at?: string | null }

export interface TempoCompra {
  medianaDias: number | null
  mediaDias: number | null
  n: number
}

const DIA_MS = 86400000
const noon = (ymd: string) => Date.parse(ymd.slice(0, 10) + 'T12:00:00Z') // âncora meio-dia evita off-by-one de fuso

export function computeTempoCompra(
  transacoes: SbTransacao[],
  qualMap: Map<string, QualComData>,
): TempoCompra {
  // 1ª compra por email no conjunto já filtrado (funil+período)
  const primeiraCompra = new Map<string, string>()
  for (const t of transacoes) {
    const email = (t.email || '').toLowerCase()
    const data = t.data || ''
    if (!email || !data) continue
    const cur = primeiraCompra.get(email)
    if (!cur || data < cur) primeiraCompra.set(email, data)
  }

  const dias: number[] = []
  for (const [email, dataCompra] of primeiraCompra) {
    const q = qualMap.get(email)
    if (!q || q.tem_ficha !== true || !q.created_at) continue
    const d = Math.round((noon(dataCompra) - noon(q.created_at)) / DIA_MS)
    if (Number.isFinite(d) && d >= 1 && d <= 365) dias.push(d)
  }

  const n = dias.length
  if (!n) return { medianaDias: null, mediaDias: null, n: 0 }
  dias.sort((a, b) => a - b)
  const mid = Math.floor(n / 2)
  const medianaDias = n % 2 ? dias[mid] : Math.round((dias[mid - 1] + dias[mid]) / 2)
  const mediaDias = Math.round(dias.reduce((s, x) => s + x, 0) / n)
  return { medianaDias, mediaDias, n }
}
