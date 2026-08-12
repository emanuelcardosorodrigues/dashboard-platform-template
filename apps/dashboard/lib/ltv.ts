/**
 * LTV backfill — computa LTV por (workspace, ad_id, email).
 *
 * First-touch: ad_id_primeiro do webhook quando presente; fallback = ad_id da
 * compra mais antiga daquele email (em ordem de data + hora_compra).
 *
 * total_compras / ltv_bruto / ltv_liquido somam TODAS as compras subsequentes
 * do mesmo email (independente do criativo) atribuídas ao first-touch ad_id.
 * dias_ate_recompra = dias entre primeira_compra e segunda compra (NULL se não houver).
 *
 * NPS fica vazio aqui — PR 12 dispara survey + atualiza colunas nps_*.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { liquidoHotmartTransacoes } from './hotmartFees'

export interface LtvRow {
  workspace_id: string
  ad_id: string
  email: string
  primeira_compra: string
  total_compras: number
  ltv_bruto: number
  ltv_liquido: number
  dias_ate_recompra: number | null
}

interface TransacaoRow {
  email: string | null
  ad_id: string | null
  ad_id_primeiro: string | null
  data: string | null
  hora_compra: string | null
  valor_bruto: number | null
}

/**
 * Computa LTV em memória pra todas as transações com email+ad_id válidos.
 * Idempotente: o caller faz upsert com primary key composta.
 */
export function computeLtvRows(
  workspaceId: string,
  transacoes: TransacaoRow[]
): LtvRow[] {
  // Agrupa por email
  const byEmail = new Map<string, TransacaoRow[]>()
  for (const t of transacoes) {
    if (!t.email || !t.data) continue
    const k = t.email.toLowerCase().trim()
    if (!k) continue
    const arr = byEmail.get(k) ?? []
    arr.push(t)
    byEmail.set(k, arr)
  }

  const out: LtvRow[] = []
  for (const [email, rows] of byEmail.entries()) {
    // Ordena por data + hora_compra ascending
    rows.sort((a, b) => {
      const da = `${a.data}T${a.hora_compra ?? '00:00:00'}`
      const db = `${b.data}T${b.hora_compra ?? '00:00:00'}`
      return da.localeCompare(db)
    })

    // First-touch: prioriza ad_id_primeiro da PRIMEIRA compra; fallback = ad_id dela
    const primeira = rows[0]
    const firstAdId = primeira.ad_id_primeiro || primeira.ad_id
    if (!firstAdId) continue // sem atribuição → sem LTV

    const ltv_bruto = rows.reduce((s, r) => s + (r.valor_bruto ?? 0), 0)
    // LTV líquido DA OPERAÇÃO = soma do líquido POR transação (taxa Hotmart canônica).
    const ltv_liquido = liquidoHotmartTransacoes(rows.map((r) => r.valor_bruto ?? 0))

    let dias_ate_recompra: number | null = null
    if (rows.length > 1) {
      const d1 = new Date(`${primeira.data}T00:00:00Z`).getTime()
      const d2 = new Date(`${rows[1].data}T00:00:00Z`).getTime()
      if (!Number.isNaN(d1) && !Number.isNaN(d2)) {
        dias_ate_recompra = Math.max(0, Math.round((d2 - d1) / 86400000))
      }
    }

    out.push({
      workspace_id: workspaceId,
      ad_id: firstAdId,
      email,
      primeira_compra: primeira.data!,
      total_compras: rows.length,
      ltv_bruto,
      ltv_liquido,
      dias_ate_recompra,
    })
  }

  return out
}

/**
 * Backfill completo: paginate `transacoes` (1k/page), computa, upsert em
 * batches de 500. Retorna stats.
 */
export async function backfillLtv(
  supa: SupabaseClient,
  workspaceId: string,
  opts: { sinceDate?: string } = {}
): Promise<{ transacoes_lidas: number; rows_upserted: number; emails_sem_atribuicao: number }> {
  const PAGE_SIZE = 1000
  const transacoes: TransacaoRow[] = []
  let offset = 0
  while (true) {
    let q = supa
      .from('transacoes')
      .select('email, ad_id, ad_id_primeiro, data, hora_compra, valor_bruto')
      .eq('workspace_id', workspaceId) // isola o tenant na origem — senão o LTV de lrm/thm seria gravado sob o workspace passado
      .order('data', { ascending: true })
      .order('hora_compra', { ascending: true, nullsFirst: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (opts.sinceDate) q = q.gte('data', opts.sinceDate)

    const { data, error } = await q
    if (error) throw new Error(`transacoes fetch: ${error.message}`)
    if (!data || data.length === 0) break
    transacoes.push(...(data as TransacaoRow[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const rows = computeLtvRows(workspaceId, transacoes)

  // Conta emails que não viraram row (sem atribuição)
  const emailsTotal = new Set(transacoes.map((t) => (t.email ?? '').toLowerCase().trim()).filter(Boolean)).size
  const emailsAtribuidos = rows.length
  const sem_atribuicao = Math.max(0, emailsTotal - emailsAtribuidos)

  // Upsert em batches
  const BATCH = 500
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH).map((r) => ({
      ...r,
      ultima_atualizacao: new Date().toISOString(),
    }))
    const { error } = await supa
      .from('criativo_ltv')
      .upsert(slice, { onConflict: 'workspace_id,ad_id,email' })
    if (error) throw new Error(`ltv upsert: ${error.message}`)
  }

  return {
    transacoes_lidas: transacoes.length,
    rows_upserted: rows.length,
    emails_sem_atribuicao: sem_atribuicao,
  }
}
