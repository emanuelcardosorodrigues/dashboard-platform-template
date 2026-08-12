/**
 * Presets de período — FONTE ÚNICA.
 *
 * Antes a lista vivia dentro do components/layout/Header.tsx (client-only). Isso
 * impedia o servidor de resolver o preset padrão do usuário: o proxy só tinha o
 * rótulo ('30d') e nenhuma forma de virar de/ate. Aqui a lista é isolada, sem
 * dependência de React, e serve os três consumidores: cluster desktop, sheet
 * mobile e proxy (Edge) — que aplica o preset PADRÃO POR USUÁRIO.
 *
 * Todas as datas saem em America/Sao_Paulo (todayBR/daysAgoBR), nunca UTC.
 */

import { todayBR, daysAgoBR } from './formatters'

export interface DatePreset {
  label: string
  de: () => string
  ate: () => string
}

/** Primeiro dia com dado no dash — âncora do preset "Tudo". */
export const INICIO_DA_OPERACAO = '2026-01-01'

export const DATE_PRESETS: readonly DatePreset[] = [
  { label: 'Hoje', de: () => todayBR(), ate: () => todayBR() },
  { label: 'Ontem', de: () => daysAgoBR(1), ate: () => daysAgoBR(1) },
  { label: '7d', de: () => daysAgoBR(7), ate: () => todayBR() },
  { label: '30d', de: () => daysAgoBR(30), ate: () => todayBR() },
  { label: '90d', de: () => daysAgoBR(90), ate: () => todayBR() },
  { label: 'Tudo', de: () => INICIO_DA_OPERACAO, ate: () => todayBR() },
]

/** Preset aplicado quando o usuário nunca escolheu um (e no fallback de erro). */
export const DEFAULT_PRESET_LABEL = '30d'

/** Chave do fallback de PRIMEIRA CARGA no navegador. A verdade é o servidor
 *  (users.default_filters.periodo); isto só evita o flash antes dela chegar. */
export const DEFAULT_PRESET_STORAGE_KEY = 'demo-default-date-preset'

export function findPreset(label: string | null | undefined): DatePreset | null {
  if (!label) return null
  return DATE_PRESETS.find((p) => p.label === label) ?? null
}

export function isValidPresetLabel(label: string | null | undefined): boolean {
  return findPreset(label) !== null
}

/**
 * Resolve um rótulo de preset em datas concretas. Rótulo desconhecido devolve
 * `null` (o chamador decide o fallback) — nunca chuta um período.
 */
export function resolvePreset(label: string | null | undefined): { de: string; ate: string } | null {
  const p = findPreset(label)
  return p ? { de: p.de(), ate: p.ate() } : null
}
