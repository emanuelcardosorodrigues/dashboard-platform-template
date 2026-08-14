import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Compatibilidade para favoritos e links antigos.
 *
 * O proxy autoriza /criativos antes deste redirect. A segunda requisição para
 * /criativos-ia é autorizada por sub-aba, portanto uma permissão legada nunca
 * libera Cards, Histórico ou Insights por efeito colateral.
 */
export default async function CriativosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const target = new URLSearchParams([['tab', 'criativos']])

  for (const key of ['de', 'ate', 'funil', 'conta', 'cmp', 'cmpDe', 'cmpAte', 'f']) {
    const value = params[key]
    if (typeof value === 'string' && value) target.set(key, value)
  }

  redirect(`/criativos-ia?${target.toString()}`)
}
