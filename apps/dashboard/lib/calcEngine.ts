/**
 * Motor de cálculo PURO da Calculadora — núcleo econômico compartilhado entre a
 * página /calculadora e o simulador de lançamento (lib/simulador.ts é da mesma
 * família: funções puras, zero I/O, zero import de React/Supabase —
 * [[feedback_hardcode_over_ai]]).
 *
 * Cadeia: CPM → CTR de link → connect rate (carregamento da página) → conversão
 * página→compra → ticket líquido por venda. Opcionalmente a conversão pode ser
 * DERIVADA de um funil de VSL (play rate × conversão do vídeo) em vez de
 * informada direto — `computeCalc` trata os dois casos como equivalentes por
 * construção (ver teste "VSL é neutro por construção" em calcEngine.test.ts).
 *
 * Denominador zero ou negativo nunca produz Infinity/NaN — o campo afetado volta
 * `null`, o mesmo padrão de "sem amostra sustentável" do lib/metrics/convBody.ts
 * (nunca 0 nem número fantasma). Nada aqui arredonda; arredondamento é
 * responsabilidade de quem exibe.
 */

export interface CalcDrivers {
  /** R$ por mil impressões. */
  cpm: number
  /** CTR de link, em % (1.72 = 1,72%). */
  ctrPct: number
  /** Connect rate / carregamento, em %. */
  connectPct: number
  /** Conversão página→compra, em %. Ignorado quando `vslOn`. */
  convPagPct: number
  /** Ticket líquido por venda front, em R$. */
  ticket: number
  /** Quando true, a conversão página→compra é DERIVADA de play rate × conversão do VSL. */
  vslOn?: boolean
  /** % de quem viu a página que deu play no VSL. Só usado quando `vslOn`. */
  playRatePct?: number
  /** Conversão de quem assistiu o VSL, em %. Só usado quando `vslOn`. */
  vslConvPct?: number
  /** % das vendas front que viram venda de backend. */
  backendPct?: number
  /** R$ líquidos por venda de backend. */
  backendLiquido?: number
}

export interface CalcResult {
  /** Em % — igual a `convPagPct`, OU playRate×vslConv quando `vslOn`. */
  convPagEfetiva: number
  cpa: number | null
  roas: number | null
  /** Receita por visualização de página. */
  prv: number | null
  /** Custo por visualização de página. */
  custoPorPv: number | null
  /** Lucro por visualização de página (prv − custoPorPv). */
  lucroPorPv: number | null
  /** `null` quando backend não está configurado (sem backendPct/backendLiquido > 0). */
  roasBackend: number | null
}

/** Divisão que nunca produz Infinity/NaN: denominador <= 0 (ou resultado não-finito) vira `null`. */
function safeDiv(n: number, d: number): number | null {
  if (!Number.isFinite(d) || d <= 0) return null
  const r = n / d
  return Number.isFinite(r) ? r : null
}

export function computeCalc(d: CalcDrivers): CalcResult {
  const ctr = d.ctrPct / 100
  const connect = d.connectPct / 100

  const convPagEfetiva = d.vslOn
    ? ((d.playRatePct ?? 0) / 100) * ((d.vslConvPct ?? 0) / 100) * 100
    : d.convPagPct

  const conv = convPagEfetiva / 100
  const ctrConnect = 1000 * ctr * connect
  const denom = ctrConnect * conv

  const cpa = safeDiv(d.cpm, denom)
  const custoPorPv = safeDiv(d.cpm, ctrConnect)
  const roas = cpa === null ? null : safeDiv(d.ticket, cpa)

  const prvRaw = conv * d.ticket
  const prv = Number.isFinite(prvRaw) ? prvRaw : null

  const lucroPorPv = prv === null || custoPorPv === null ? null : prv - custoPorPv

  const backendConfigurado =
    typeof d.backendPct === 'number' &&
    typeof d.backendLiquido === 'number' &&
    d.backendPct > 0 &&
    d.backendLiquido > 0

  let roasBackend: number | null = null
  if (backendConfigurado && cpa !== null) {
    const aporte = (d.backendPct! / 100) * d.backendLiquido!
    roasBackend = safeDiv(d.ticket + aporte, cpa)
  }

  return { convPagEfetiva, cpa, roas, prv, custoPorPv, lucroPorPv, roasBackend }
}

/**
 * Confere as 3 identidades que têm que fechar por construção, com tolerância
 * relativa 1e-9:
 *
 *   roas = prv / custoPorPv
 *   cpa  = custoPorPv / conv
 *   prv  = conv × ticket
 *
 * Só compara quando os operandos envolvidos existem (não-null e divisor ≠ 0) —
 * é um sanity check do caminho feliz, não um validador de fluxo de `null`.
 */
export function verificarIdentidades(d: CalcDrivers, r: CalcResult): { ok: boolean; falhas: string[] } {
  const TOL = 1e-9
  const falhas: string[] = []

  const relOk = (a: number, b: number): boolean => {
    const diff = Math.abs(a - b)
    const scale = Math.max(Math.abs(a), Math.abs(b))
    return scale === 0 ? diff === 0 : diff / scale <= TOL
  }

  if (r.roas !== null && r.prv !== null && r.custoPorPv !== null && r.custoPorPv !== 0) {
    if (!relOk(r.roas, r.prv / r.custoPorPv)) falhas.push('roas = prv / custoPorPv')
  }

  const conv = r.convPagEfetiva / 100
  if (r.cpa !== null && r.custoPorPv !== null && conv !== 0) {
    if (!relOk(r.cpa, r.custoPorPv / conv)) falhas.push('cpa = custoPorPv / conv')
  }

  if (r.prv !== null) {
    if (!relOk(r.prv, conv * d.ticket)) falhas.push('prv = conv × ticket')
  }

  return { ok: falhas.length === 0, falhas }
}
