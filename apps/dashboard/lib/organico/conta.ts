/**
 * Conta orgânica selecionada = contexto GLOBAL do usuário. O seletor (AccountFilter)
 * grava num cookie e leva pra Visão Geral; cada aba do Orgânico resolve a conta por
 * `?conta=` (explícito na URL) OU, na ausência dele, pelo cookie persistido —
 * assim a escolha "segue" o usuário entre as abas.
 */
import { cookies } from 'next/headers'

export const ORGANICO_CONTA_COOKIE = 'organico_conta'

export async function resolveConta(
  spConta: string | undefined | null,
  validExternalIds: string[],
): Promise<string | undefined> {
  if (spConta && validExternalIds.includes(spConta)) return spConta
  const fromCookie = (await cookies()).get(ORGANICO_CONTA_COOKIE)?.value
  if (fromCookie && validExternalIds.includes(fromCookie)) return fromCookie
  return undefined
}
