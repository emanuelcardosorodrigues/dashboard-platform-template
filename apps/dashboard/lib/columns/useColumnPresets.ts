'use client'

/**
 * Estado das colunas customizáveis (Fase 3.3) — MVP em localStorage.
 *  • visibleIds: layout de trabalho (ordem + visibilidade) persistido por escopo.
 *  • presets built-in: Tudo (legado) + por categoria (Retornos/Conversões/Custos/Entrega).
 *  • presets do usuário: salvos em localStorage.
 * A sincronização no Supabase (compartilhar/marcar padrão entre dispositivos) entra
 * numa etapa seguinte — esta camada já deixa tudo usável sem tocar o banco.
 */

import { useState, useEffect, useCallback } from 'react'
import { defaultVisibleIds, metricsForScope, type MetricScope, type MetricGroup } from '@/lib/metrics/registry'
import { loadColumnPresets, saveColumnPresetAction, deleteColumnPresetAction } from '@/app/actions/columnPresets'

export interface ColumnPreset { name: string; ids: string[]; builtin?: boolean; shared?: boolean; isDefault?: boolean }

const LEGADO = 'Tudo (legado)'

// Presets por categoria: Identificação (Status+Nome) sempre + as métricas do grupo.
const CATEGORY_PRESETS: { name: string; groups: MetricGroup[] }[] = [
  { name: 'Retornos', groups: ['Retornos'] },
  { name: 'Conversões', groups: ['Conversões'] },
  { name: 'Custos', groups: ['Custos'] },
  { name: 'Entrega', groups: ['Entrega'] },
]

function idsForGroups(scope: MetricScope, groups: MetricGroup[]): string[] {
  const ms = metricsForScope(scope)
  const ident = ms.filter((m) => m.group === 'Identificação').map((m) => m.id)
  const sel = ms.filter((m) => groups.includes(m.group)).map((m) => m.id)
  return [...ident, ...sel]
}

// Presets CURADOS (ids explícitos na ordem que o gestor analisa). Filtrados pelo
// escopo — métricas de VSL/pitch só existem em criativos; em campanhas saem fora.
const CURATED_PRESETS: { name: string; ids: string[] }[] = [
  { name: '★ Retorno completo', ids: ['semaforo', 'criativo', 'investimento', 'faturamento', 'lucro', 'roas', 'roasGeral', 'roasComUpsell', 'roasSoFront', 'roas1oCheckout', 'rpv', 'lpv', 'rpc', 'lpc', 'ticketMedio', 'vendasFront'] },
  { name: '★ Funil VSL', ids: ['semaforo', 'criativo', 'investimento', 'vslViews', 'pctPlayRate', 'pctRetencao1Min', 'pctRetencaoPitch', 'pctEngajamento', 'pctConvPitch', 'pctPitchClique', 'pctConvPlay', 'convCorpo', 'vendasFront', 'roas'] },
  { name: '★ Custos', ids: ['semaforo', 'criativo', 'investimento', 'cpa', 'cpaUpsell', 'custoPorCheckout', 'custoPorPitch', 'custoPlay', 'cpm', 'cpc', 'frequencia', 'impressoes'] },
]

function idsInScope(scope: MetricScope, ids: string[]): string[] {
  const valid = new Set(metricsForScope(scope).map((m) => m.id))
  return ids.filter((id) => valid.has(id))
}

export function builtinPresets(scope: MetricScope): ColumnPreset[] {
  const curated = CURATED_PRESETS
    .map((p) => ({ name: p.name, ids: idsInScope(scope, p.ids), builtin: true }))
    .filter((p) => p.ids.length >= 4) // some no escopo onde quase nada se aplica
  return [
    { name: LEGADO, ids: defaultVisibleIds(scope), builtin: true },
    ...curated,
    ...CATEGORY_PRESETS.map((g) => ({ name: g.name, ids: idsForGroups(scope, g.groups), builtin: true })),
  ]
}

export function useColumnPresets(scope: MetricScope) {
  const visKey = `cols-${scope}`
  const customKey = `colpresets-${scope}`
  const activeKey = `cols-${scope}-active`

  const [visibleIds, setVisibleState] = useState<string[]>(() => defaultVisibleIds(scope))
  const [custom, setCustom] = useState<ColumnPreset[]>([])
  const [activeName, setActiveName] = useState<string>(LEGADO)
  const [hydrated, setHydrated] = useState(false)
  const [serverPresets, setServerPresets] = useState<ColumnPreset[]>([])

  useEffect(() => {
    try {
      const v = localStorage.getItem(visKey)
      if (v) setVisibleState(JSON.parse(v))
      const c = localStorage.getItem(customKey)
      if (c) setCustom(JSON.parse(c))
      const a = localStorage.getItem(activeKey)
      if (a) setActiveName(a)
    } catch { /* ignore */ }
    setHydrated(true)
  }, [visKey, customKey, activeKey])

  // Sync com Supabase: presets do usuário + compartilhados + padrão. Degrada
  // gracioso se a migration 0017 não foi aplicada (action retorna []).
  useEffect(() => {
    let alive = true
    loadColumnPresets(scope)
      .then((rows) => { if (alive) setServerPresets(rows.map((r) => ({ name: r.name, ids: r.ids, shared: r.shared, isDefault: r.isDefault }))) })
      .catch(() => { /* mantém localStorage-only */ })
    return () => { alive = false }
  }, [scope])

  const setVisibleIds = useCallback((ids: string[]) => {
    setVisibleState(ids)
    try { localStorage.setItem(visKey, JSON.stringify(ids)) } catch { /* ignore */ }
  }, [visKey])

  const persistCustom = useCallback((list: ColumnPreset[]) => {
    setCustom(list)
    try { localStorage.setItem(customKey, JSON.stringify(list)) } catch { /* ignore */ }
  }, [customKey])

  const setActive = useCallback((name: string) => {
    setActiveName(name)
    try { localStorage.setItem(activeKey, name) } catch { /* ignore */ }
  }, [activeKey])

  // Merge custom (localStorage) + servidor por nome; o do servidor (com flags
  // shared/default) tem precedência sobre o local de mesmo nome.
  const mergedByName = new Map<string, ColumnPreset>()
  for (const p of custom) mergedByName.set(p.name, p)
  for (const p of serverPresets) mergedByName.set(p.name, p)
  const presets: ColumnPreset[] = [...builtinPresets(scope), ...mergedByName.values()]

  const applyPreset = useCallback((name: string) => {
    const p = [...builtinPresets(scope), ...custom, ...serverPresets].find((x) => x.name === name)
    if (!p) return
    setVisibleIds([...p.ids])
    setActive(name)
  }, [scope, custom, serverPresets, setVisibleIds, setActive])

  const savePreset = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === LEGADO) return
    const next = [...custom.filter((p) => p.name !== trimmed), { name: trimmed, ids: [...visibleIds] }]
    persistCustom(next)
    setActive(trimmed)
    void saveColumnPresetAction(scope, trimmed, [...visibleIds]).catch(() => { /* offline/sem migration → fica só no localStorage */ })
  }, [custom, visibleIds, persistCustom, setActive, scope])

  const deletePreset = useCallback((name: string) => {
    persistCustom(custom.filter((p) => p.name !== name))
    setServerPresets((prev) => prev.filter((p) => p.name !== name))
    if (activeName === name) setActive(LEGADO)
    void deleteColumnPresetAction(scope, name).catch(() => { /* no-op */ })
  }, [custom, persistCustom, activeName, setActive, scope])

  // "modificado": layout atual difere do preset ativo.
  const activePreset = presets.find((p) => p.name === activeName)
  const isDirty = !activePreset || JSON.stringify(activePreset.ids) !== JSON.stringify(visibleIds)

  return { visibleIds, setVisibleIds, presets, activeName, isDirty, applyPreset, savePreset, deletePreset, hydrated }
}
