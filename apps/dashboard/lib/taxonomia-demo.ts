/**
 * Taxonomia DEMO hard-coded (fonte da verdade: mind-vault).
 *
 * Princípio: o vocabulário é CÓDIGO (determinístico). A IA da análise apenas
 * ESCOLHE dentro deste catálogo — nunca inventa códigos. O código valida e
 * exibe (sempre pela SIGLA/nome, nunca o número Fxx cru).
 */

/** 9 mecanismos de gancho (nota mind-vault 3puq988ytetn). Sigla → nome. */
export const MECANISMOS_GANCHO: Record<string, string> = {
  PAR: 'Paradoxo',
  ESP: 'Espelho de dor',
  CUR: 'Curiosidade',
  POL: 'Polêmica',
  PER: 'Pergunta direta',
  AUT: 'Autoridade',
  URG: 'Urgência',
  DEMO: 'Demonstração',
  ID: 'Identificação',
}

/**
 * Banco de ganchos: faixa FIXA g01–g46 (nota g20laubwc4aq).
 * Nunca g47+, nunca sufixos (g77b). Sem match exato → usar o g mais próximo.
 */
export const GANCHO_CODE_RE = /^g(0[1-9]|[1-3]\d|4[0-6])$/
export function isGanchoValido(code: string): boolean {
  return GANCHO_CODE_RE.test(code.trim().toLowerCase())
}

/** Biblioteca de formatos F01–F60 (nota keewtfity60k). Código → SIGLA/label. */
export const FORMATOS_LST: Record<string, string> = {
  F02: 'POV',
  F12: 'Esquete',
  F13: 'FAFZ',
  F26: 'Conversa no Carro',
  F30: 'CPAP',
  F31: 'Cinema',
  F41: 'Rotina',
  F51: 'TH-CAM',
  F52: 'TH-CLI',
  F53: 'TH-DESK',
}
// F24 e F54 (podcast) NÃO existem — setup indisponível.

/** Exibe formato pela SIGLA. Aceita "F51", "F51 — TH-CAM" ou texto livre (legado). */
export function formatoLabel(v: string): string {
  const s = (v ?? '').trim()
  const m = s.match(/F\d{2}/i)
  if (m) {
    const code = m[0].toUpperCase()
    if (FORMATOS_LST[code]) return FORMATOS_LST[code]
  }
  return s
}

/** Exibe mecanismo de gancho pela sigla (ex "PAR" → "Paradoxo"); senão retorna o texto. */
export function mecanismoLabel(v: string): string {
  const s = (v ?? '').trim()
  return MECANISMOS_GANCHO[s.toUpperCase()] ?? s
}

/** Vocabulário compacto pra injetar no prompt da IA de classificação. */
export const TAXONOMIA_PROMPT = [
  'GANCHO: use um código fixo g01–g46 (nunca invente; sem match use o mais próximo) + um mecanismo:',
  Object.entries(MECANISMOS_GANCHO).map(([sig, nome]) => `${sig}=${nome}`).join(', ') + '.',
  'FORMATO: use um código da biblioteca e responda com a SIGLA:',
  Object.entries(FORMATOS_LST).map(([cod, sig]) => `${cod}=${sig}`).join(', ') + '.',
  'F24 e F54 (podcast) não existem.',
].join('\n')
