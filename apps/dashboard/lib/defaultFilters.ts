/**
 * Aplicação dos filtros padrão DO USUÁRIO numa URL (funil, conta, de/ate e o
 * preset de período). Vive fora do proxy.ts para poder ser testado sem arrastar
 * `next/server` pra dentro do vitest — a regra é de negócio, não de runtime.
 *
 * Nada aqui pisa em query param que o usuário já mandou: filtro explícito na URL
 * sempre vence a preferência.
 */

import { resolvePreset } from './datePresets'
import type { DefaultFilters } from './sessions'

export function applyDefaultFilters(url: URL, filtros: DefaultFilters): void {
  const f = filtros
  if (f.funil && !url.searchParams.has('funil')) url.searchParams.set('funil', f.funil)
  if (f.conta && !url.searchParams.has('conta')) url.searchParams.set('conta', f.conta)
  if (f.de && !url.searchParams.has('de')) url.searchParams.set('de', f.de)
  if (f.ate && !url.searchParams.has('ate')) url.searchParams.set('ate', f.ate)
  // `periodo` é o PRESET padrão do usuário ('30d', 'Tudo', …), gravado pela
  // estrela do Header. Datas fixas (de/ate, definidas pelo admin no perfil)
  // vencem — por isso este bloco vem depois e só age sem intervalo na URL.
  if (f.periodo && !url.searchParams.has('de') && !url.searchParams.has('ate')) {
    const r = resolvePreset(f.periodo)
    if (r) {
      url.searchParams.set('de', r.de)
      url.searchParams.set('ate', r.ate)
    }
  }
}
