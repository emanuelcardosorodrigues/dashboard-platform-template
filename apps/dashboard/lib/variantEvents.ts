import type { SbVariant } from './supabase'

/**
 * Diff entre o estado ANTERIOR e o NOVO das variantes de um experimento, virando eventos
 * pro histórico (tabela `experiment_variant_events`).
 *
 * Existe porque nada disso era gravado: o JSON de `variants` guarda só o estado ATUAL, então
 * "o peso da B caiu de 0,5 pra 0" era invisível depois de salvo. Sem isso, olhar um resultado
 * antigo e entender POR QUE a variante parou de receber tráfego era impossível.
 *
 * Função pura: o caller busca o antes, aplica o depois e persiste o que sai daqui.
 */

export type VariantEventKind = 'criada' | 'peso' | 'ativada' | 'desativada' | 'url' | 'slug' | 'removida'
export type VariantEventOrigem = 'manual' | 'bandit'

export interface VariantEvent {
  variant: string
  kind: VariantEventKind
  de: string | null
  para: string | null
  origem: VariantEventOrigem
}

/** Peso em texto curto e estável, pro histórico não virar "0.30000000000000004". */
function pesoTxt(w: number | undefined | null): string {
  const n = typeof w === 'number' && Number.isFinite(w) ? w : 0
  return String(Math.round(n * 10000) / 10000)
}

/** `enabled` ausente = ativa (o JSON antigo não tinha o campo). */
function ativa(v: SbVariant): boolean {
  return v.enabled !== false
}

export function diffVariants(
  antes: SbVariant[],
  depois: SbVariant[],
  origem: VariantEventOrigem = 'manual',
): VariantEvent[] {
  const ev: VariantEvent[] = []
  const byName = (list: SbVariant[]) => new Map(list.map((v) => [v.name, v]))
  const a = byName(antes ?? [])
  const d = byName(depois ?? [])

  for (const [name, nova] of d) {
    const velha = a.get(name)

    if (!velha) {
      // Nasce com o peso já registrado — senão o histórico começa sem saber quanto ela pegou.
      ev.push({ variant: name, kind: 'criada', de: null, para: pesoTxt(nova.weight), origem })
      continue
    }

    if (pesoTxt(velha.weight) !== pesoTxt(nova.weight)) {
      ev.push({ variant: name, kind: 'peso', de: pesoTxt(velha.weight), para: pesoTxt(nova.weight), origem })
    }
    if (ativa(velha) !== ativa(nova)) {
      ev.push({
        variant: name,
        kind: ativa(nova) ? 'ativada' : 'desativada',
        de: null, para: null, origem,
      })
    }
    if ((velha.url || '') !== (nova.url || '')) {
      ev.push({ variant: name, kind: 'url', de: velha.url || null, para: nova.url || null, origem })
    }
    if ((velha.slug || '') !== (nova.slug || '')) {
      ev.push({ variant: name, kind: 'slug', de: velha.slug || null, para: nova.slug || null, origem })
    }
  }

  // Removida: some do JSON, mas as impressões e vendas dela continuam no banco — o histórico
  // precisa explicar por que a variante sumiu do card em vez de deixar o buraco sem motivo.
  for (const [name] of a) {
    if (!d.has(name)) {
      ev.push({ variant: name, kind: 'removida', de: null, para: null, origem })
    }
  }

  return ev
}

/** Texto humano do evento — uma fonte só, usada pela UI e por qualquer log. */
export function descreverEvento(e: Pick<VariantEvent, 'kind' | 'de' | 'para'>): string {
  switch (e.kind) {
    case 'criada':     return `Variante criada${e.para != null ? ` (peso ${e.para})` : ''}`
    case 'peso':       return `Peso ${e.de} → ${e.para}`
    case 'ativada':    return 'Variante ativada'
    case 'desativada': return 'Variante desativada'
    case 'url':        return `URL alterada${e.para ? ` → ${e.para}` : ''}`
    case 'slug':       return `Slug ${e.de ?? '—'} → ${e.para ?? '—'}`
    case 'removida':   return 'Variante removida do teste'
  }
}
