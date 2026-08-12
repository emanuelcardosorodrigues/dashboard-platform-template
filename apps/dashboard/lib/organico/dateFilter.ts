/**
 * Resolve o período [de, ate] das abas do Orgânico no MESMO esquema dos demais
 * (componente FilterToggle prefix="org", showFunil=false):
 *  - checkbox "Usar filtro geral" ON (default) → segue o de/ate GLOBAL do dashboard;
 *  - OFF → usa o filtro exclusivo da aba (orgDe/orgAte), caindo no global se vazio.
 * Datas no formato YYYY-MM-DD (ou '' = sem limite). Espelha a lógica do FilterToggle.
 */
export interface OrgDateParams {
  de?: string; ate?: string
  orgDe?: string; orgAte?: string; orgUsarGeral?: string
}

export function resolveOrgRange(sp: OrgDateParams): { de: string; ate: string } {
  const usarGeral = (sp.orgUsarGeral ?? 'on') !== 'off'
  const de = usarGeral ? (sp.de || '') : (sp.orgDe || sp.de || '')
  const ate = usarGeral ? (sp.ate || '') : (sp.orgAte || sp.ate || '')
  return { de, ate }
}

/** true se a data (ISO/`YYYY-MM-DD...`) está dentro de [de, ate] (limites vazios = abertos). */
export function inRange(isoDate: string | null | undefined, de: string, ate: string): boolean {
  if (!isoDate) return true
  const d = isoDate.slice(0, 10)
  if (de && d < de) return false
  if (ate && d > ate) return false
  return true
}
