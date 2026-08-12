/**
 * Rótulos da IA (gancho / formato) por `ad_id`, pra alimentar as sugestões de criativo
 * da Calculadora sem quebrar a pureza de `lib/calcSugestoes.ts`.
 *
 * O I/O mora aqui; o motor de sugestão continua sendo função pura que só recebe o mapa.
 *
 * ⚠️ SEMPRE filtrado por `workspace_id`: `ad_id` vem do Meta e pode colidir entre tenants.
 * Sem esse filtro, a análise (e a transcrição) de um projeto vaza no outro — mesma regra
 * que `lib/criativos.ts` já aplica e que `lib/tenant-isolation.test.ts` trava.
 *
 * Degrada em silêncio de propósito: se a query falhar ou a tabela não existir, devolve
 * mapa vazio e a UI mostra "SEM DADO" no gancho/formato. Rótulo ausente é honesto;
 * sugestão sem rótulo continua útil porque o número que a sustenta vem de outro lugar.
 */

import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from './workspace-context'
import { MECANISMOS_GANCHO, FORMATOS_LST } from './taxonomia-demo'

// Mesmo padrão local de lib/criativos.ts e app/actions/calcPresets.ts (o repo não
// exporta um client compartilhado; cada módulo server-side cria o seu).
function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export interface RotuloCriativo {
  gancho?: string
  formato?: string
}

/** Primeiro item não-vazio de um `text[]` do Postgres. */
function primeiro(v: unknown): string | undefined {
  if (!Array.isArray(v)) return undefined
  const s = v.find((x) => typeof x === 'string' && x.trim().length > 0)
  return typeof s === 'string' ? s.trim() : undefined
}

/**
 * Traduz pro par "CÓDIGO · Nome" quando o catálogo conhece.
 *
 * O banco grava os dois lados da moeda: às vezes o código (`F31`, `F02`, `ESP`), às
 * vezes o nome (`TH-CAM`, `CPAP`) — o schema do Gemini aceita ambos e o `text[]` não
 * tem CHECK. Por isso a busca é nos DOIS sentidos: chave→valor e valor→chave.
 *
 * Valor desconhecido volta como veio. Só 10 dos 60 formatos e 9 mecanismos estão no
 * repo (a fonte da verdade é o mind-vault), e mostrar a sigla crua é melhor do que
 * esconder o rótulo que a IA de fato atribuiu.
 */
function comNome(valor: string | undefined, catalogo: Record<string, string>): string | undefined {
  if (!valor) return undefined
  const v = valor.trim()
  const porCodigo = catalogo[v.toUpperCase()]
  if (porCodigo) return `${v.toUpperCase()} · ${porCodigo}`
  const entrada = Object.entries(catalogo).find(([, nome]) => nome.toUpperCase() === v.toUpperCase())
  return entrada ? `${entrada[0]} · ${entrada[1]}` : v
}

export const fetchRotulosCriativo = cache(async (): Promise<Map<string, RotuloCriativo>> => {
  const out = new Map<string, RotuloCriativo>()
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return out
    const { data, error } = await getClient()
      .from('criativo_analise')
      .select('ad_id, hook_tipo, formato_visual')
      .eq('workspace_id', workspaceId)
      .not('ad_id', 'is', null)
    if (error || !data) return out
    for (const r of data as Array<{ ad_id: string | null; hook_tipo: unknown; formato_visual: unknown }>) {
      if (!r.ad_id) continue
      const gancho = comNome(primeiro(r.hook_tipo), MECANISMOS_GANCHO)
      const formato = comNome(primeiro(r.formato_visual), FORMATOS_LST)
      if (gancho || formato) out.set(r.ad_id, { gancho, formato })
    }
  } catch {
    return out // tabela ausente / erro de rede → sem rótulo, nunca quebra a aba
  }
  return out
})
