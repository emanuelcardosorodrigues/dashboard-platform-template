import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Compatibilidade para links antigos de Insights IA.
 *
 * O proxy valida /insights-ia antes do redirect e volta a validar a URL
 * consolidada pelo tab. Logo este redirect não contorna allowed_paths.
 */
export default async function InsightsIAPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const target = new URLSearchParams([['tab', 'insights']])
  const data = typeof params.data === 'string' ? params.data : undefined

  // Preserva um intervalo explícito. Para o formato legado ?data=, converte em
  // de/ate (a URL final é autoexplicativa e o conteúdo mantém a mesma semântica).
  const de = typeof params.de === 'string' ? params.de : data
  const ate = typeof params.ate === 'string' ? params.ate : data
  if (de) target.set('de', de)
  if (ate) target.set('ate', ate)

  for (const key of ['funil', 'conta', 'cmp', 'cmpDe', 'cmpAte', 'f']) {
    const value = params[key]
    if (typeof value === 'string' && value) target.set(key, value)
  }

  redirect(`/criativos-ia?${target.toString()}`)
}
