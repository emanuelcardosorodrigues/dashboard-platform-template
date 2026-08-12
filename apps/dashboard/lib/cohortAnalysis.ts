/**
 * Cruzamento criativo × qualificação: pra cada criativo, descreve o "tipo"
 * de dentista que ele costuma trazer (top dores, medos, objetivos, ticket
 * médio, n fichas). Liga por e-mail (transacao.email === qualificacao.email).
 */

import { createHash } from 'crypto'
import { topValoresMascaradosFromStrings } from './maskedValues'
import { tipoDaTransacao, type SbQualificacao, type SbTransacao } from './supabase'
import { liquidoHotmartTransacoes } from './hotmartFees'

export interface CreativeCohort {
  criativo: string
  ad_id: string | null
  n_compradores: number
  n_fichas: number
  ticket_medio: number
  top_dores: string[]
  top_medos: string[]
  top_objetivos: string[]
  top_faturamento: string[]
}

function emailKey(email: string | null | undefined): string {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return ''
  return createHash('sha256').update(e).digest('hex')
}

/**
 * Retorna um Map<key, cohort> onde key é ad_id (se houver) ou criativo.
 */
export function cohortByCreative(
  transacoes: SbTransacao[],
  qualificacao: SbQualificacao[],
): Map<string, CreativeCohort> {
  const fichaByEmail = new Map<string, SbQualificacao>()
  for (const q of qualificacao) {
    const key = emailKey(q.email)
    if (key) fichaByEmail.set(key, q)
  }

  const byKey = new Map<string, {
    criativo: string
    ad_id: string | null
    compradores: SbTransacao[]
    fichas: SbQualificacao[]
  }>()

  for (const t of transacoes) {
    const adId = t.ad_id || null
    const criativo = t.criativo || '(sem criativo)'
    const key = adId || criativo
    const slot = byKey.get(key)
    if (slot) {
      slot.compradores.push(t)
    } else {
      byKey.set(key, { criativo, ad_id: adId, compradores: [t], fichas: [] })
    }
    const key2 = emailKey(t.email)
    const ficha = key2 ? fichaByEmail.get(key2) : null
    if (ficha) byKey.get(key)!.fichas.push(ficha)
  }

  const out = new Map<string, CreativeCohort>()
  for (const [key, slot] of byKey) {
    // ticket médio considera apenas transações frontEnd (AOV real).
    // n_compradores mantém TOTAL (FE + OBs) — é volume de transações.
    const frontTx = slot.compradores.filter(
      (t) => tipoDaTransacao(t) === 'frontEnd'
    )
    // Ticket médio líquido DA OPERAÇÃO = líquido POR transação FE (canônico) / nº FE.
    const ticket = frontTx.length > 0
      ? liquidoHotmartTransacoes(frontTx.map((t) => Number(t.valor_bruto ?? 0))) / frontTx.length
      : 0
    out.set(key, {
      criativo: slot.criativo,
      ad_id: slot.ad_id,
      n_compradores: slot.compradores.length,
      n_fichas: slot.fichas.length,
      ticket_medio: ticket,
      top_dores: topValoresMascaradosFromStrings(slot.fichas.map((f) => f.maior_dificuldade ?? '')),
      top_medos: topValoresMascaradosFromStrings(slot.fichas.map((f) => f.medos ?? '')),
      top_objetivos: topValoresMascaradosFromStrings(slot.fichas.map((f) => f.objetivos ?? '')),
      top_faturamento: topValoresMascaradosFromStrings(slot.fichas.map((f) => f.faturamento_declarado ?? '')),
    })
  }
  return out
}
