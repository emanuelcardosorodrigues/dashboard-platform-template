import type { SupabaseClient } from '@supabase/supabase-js'
import type { VariantEvent } from './variantEvents'
import type { SbVariant } from './supabase'
import { log } from './log'

/**
 * Persistência do histórico da variante. Fica em lib (e não na route) porque DOIS caminhos
 * mudam variante: a edição manual (PATCH /api/experimentos) e o Thompson Sampling
 * (cron bandit-update, que reescreve os pesos sozinho). Os dois têm que gravar, senão o
 * histórico mente por omissão — o peso muda "do nada" e ninguém sabe se foi você ou o bandit.
 */

/**
 * Best-effort: NUNCA derruba a operação. Se o log falhar, o experimento já foi salvo e o que
 * o usuário pediu tem que valer — histórico é observabilidade, não é a operação.
 */
export async function registrarEventos(
  db: SupabaseClient,
  experimentId: string,
  workspaceId: string,
  eventos: VariantEvent[],
  ator?: string | null,
): Promise<void> {
  if (eventos.length === 0) return
  try {
    const { error } = await db.from('experiment_variant_events').insert(
      eventos.map((e) => ({
        experiment_id: experimentId,
        workspace_id: workspaceId,
        variant: e.variant,
        kind: e.kind,
        de: e.de,
        para: e.para,
        origem: e.origem,
        ator: ator ?? null,
      })),
    )
    if (error) log.warn('[variant-events] insert falhou', { message: error.message })
  } catch (err) {
    log.warn('[variant-events] exceção', { message: err instanceof Error ? err.message : String(err) })
  }
}

/** Variantes atuais do experimento — o "antes" do diff. [] se não achar. */
export async function variantesAtuais(
  db: SupabaseClient,
  id: string,
  workspaceId: string,
): Promise<SbVariant[]> {
  const { data, error } = await db
    .from('experiments').select('variants')
    .eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
  if (error || !data) return []
  return (data.variants ?? []) as SbVariant[]
}
