/**
 * Nomes das contas de anúncio Meta — FONTE ÚNICA (Header desktop + Home mobile).
 *
 * Antes havia DOIS mapas divergentes: ACCOUNT_NAMES (Header.tsx) e
 * MOBILE_ACCOUNT_NAMES (visao-geral/page.tsx), os dois cobrindo só 2 das 4 contas
 * com gasto. As que faltavam apareciam como "Conta ••••1661" / "Conta ••••3927".
 *
 * Os nomes abaixo vieram da própria API do Meta (ads_get_ad_accounts, 08/08/2026),
 * não de inferência: conta 04 = 333333333333333, conta 05 = 444444444444444.
 * Todas sob a BM "Cliente Exemplo" (CONTA_META_ID_DEMO).
 */

export const CONTAS_META: Record<string, string> = {
  '111111111111111': 'APS | DEMO - Conta 02',
  '222222222222222': 'APS | DEMO - Conta 03',
  '333333333333333': 'APS | DEMO - Conta 04',
  '444444444444444': 'APS | DEMO - Conta 05',
}

/** Prefixo do nome no Meta; o rótulo curto (mobile/breakdown) o remove. */
const PREFIXO = 'APS | DEMO - '

/**
 * Chave usada quando a linha do meta_ads chega SEM account_id (existem 6 dias
 * assim no histórico, R$ 67,33). É gasto real de uma conta real — só não sabemos
 * qual. Some seria pior: o total de investimento deixaria de fechar.
 */
export const CONTA_SEM_ID = '__sem_id__'

/** Nome completo, como no gerenciador do Meta. Fallback: "Conta ••••1661". */
export function contaNomeCompleto(id: string | null | undefined): string {
  const s = (id || '').trim()
  if (!s || s === CONTA_SEM_ID) return 'Conta não identificada'
  return CONTAS_META[s] ?? `Conta ••••${s.length > 4 ? s.slice(-4) : s}`
}

/** Rótulo curto ("Conta 03"), usado nos breakdowns estreitos do celular. */
export function contaNomeCurto(id: string | null | undefined): string {
  return contaNomeCompleto(id).replace(PREFIXO, '')
}
