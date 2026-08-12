/**
 * Comparativo semana atual vs anterior pra contextualizar a IA.
 * Aceita Supabase client injetado pra ser testável.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { calcDeltaPct } from './comparePeriods'
import { liquidoHotmartTransacoes } from './hotmartFees'

export interface WowMetrics {
  investimento: number
  receita: number
  vendas: number
  lpv: number
  cliques: number
  roas: number
  cpa: number | null
  conv_pagina: number          // vendas / lpv (0 se lpv=0)
  clarity_sessions: number
  clarity_rage_pct: number     // weighted average
  clarity_engagement_sec: number
}

export interface WowResult {
  atual: WowMetrics
  anterior: WowMetrics
  deltas: Record<keyof WowMetrics, number | null>
  rangeAtual: { from: string; to: string }
  rangeAnterior: { from: string; to: string }
}

function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDaysUTC(d: Date, n: number): Date {
  const x = new Date(d.getTime())
  x.setUTCDate(x.getUTCDate() + n)
  return x
}
function diffDaysInclusive(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1
}

/**
 * Dado o range atual [from, to], retorna o range imediatamente anterior
 * de mesmo tamanho.
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const f = parseISO(from)
  const t = parseISO(to)
  const dias = diffDaysInclusive(f, t)
  const prevTo = addDaysUTC(f, -1)
  const prevFrom = addDaysUTC(prevTo, -(dias - 1))
  return { from: toISO(prevFrom), to: toISO(prevTo) }
}

interface MetaRow { investimento?: number; cliques_link?: number; landing_views?: number; account_id?: string }
interface TransRow { valor_bruto?: number }
interface ClarityRow { recorte?: string; sessions?: number | null; rage_clicks?: number | null; engagement_time_sec?: number | null }

export function computeMetricsFromRows(
  meta: MetaRow[],
  trans: TransRow[],
  clarity: ClarityRow[],
): WowMetrics {
  const investimento = sum(meta, (r) => r.investimento)
  const lpv = sum(meta, (r) => r.landing_views)
  const cliques = sum(meta, (r) => r.cliques_link)
  const vendas = trans.length
  // Receita líquida DA OPERAÇÃO = soma do líquido POR transação (taxa Hotmart canônica).
  const receita = liquidoHotmartTransacoes(trans.map((r) => Number(r.valor_bruto ?? 0)))

  const clarityTotal = clarity.filter((r) => r.recorte === 'total')
  const clarityRows = clarityTotal.length ? clarityTotal : clarity
  const sessions = sum(clarityRows, (r) => r.sessions)

  let rageNum = 0
  let engNum = 0
  let den = 0
  for (const r of clarityRows) {
    const w = Number(r.sessions ?? 0)
    if (w > 0) {
      rageNum += Number(r.rage_clicks ?? 0)
      engNum += Number(r.engagement_time_sec ?? 0) * w
      den += w
    }
  }
  const clarity_rage_pct = sessions > 0 ? (rageNum / sessions) * 100 : 0
  const clarity_engagement_sec = den > 0 ? engNum / den : 0

  return {
    investimento,
    receita,
    vendas,
    lpv,
    cliques,
    roas: investimento > 0 ? receita / investimento : 0,
    cpa: vendas > 0 ? investimento / vendas : null,
    conv_pagina: lpv > 0 ? vendas / lpv : 0,
    clarity_sessions: sessions,
    clarity_rage_pct,
    clarity_engagement_sec,
  }
}

function sum<T>(rows: T[], pick: (r: T) => number | null | undefined): number {
  let s = 0
  for (const r of rows) s += Number(pick(r) ?? 0)
  return s
}

export function diffMetrics(atual: WowMetrics, anterior: WowMetrics): Record<keyof WowMetrics, number | null> {
  const out: Record<string, number | null> = {}
  for (const k of Object.keys(atual) as Array<keyof WowMetrics>) {
    const a = atual[k] ?? 0
    const b = anterior[k] ?? 0
    out[k] = calcDeltaPct(Number(a), Number(b))
  }
  return out as Record<keyof WowMetrics, number | null>
}

export async function computeWeekOverWeek(
  supabase: SupabaseClient,
  from: string,
  to: string,
  workspaceId: string,
): Promise<WowResult> {
  const prev = previousRange(from, to)

  const [metaA, transA, clarA, metaP, transP, clarP] = await Promise.all([
    supabase.from('meta_ads').select('investimento, cliques_link, landing_views, account_id').eq('workspace_id', workspaceId).gte('data', from).lte('data', to),
    supabase.from('transacoes').select('valor_bruto').eq('workspace_id', workspaceId).gte('data', from).lte('data', to),
    supabase.from('clarity_daily').select('recorte, sessions, rage_clicks, engagement_time_sec').eq('workspace_id', workspaceId).gte('data', from).lte('data', to),
    supabase.from('meta_ads').select('investimento, cliques_link, landing_views, account_id').eq('workspace_id', workspaceId).gte('data', prev.from).lte('data', prev.to),
    supabase.from('transacoes').select('valor_bruto').eq('workspace_id', workspaceId).gte('data', prev.from).lte('data', prev.to),
    supabase.from('clarity_daily').select('recorte, sessions, rage_clicks, engagement_time_sec').eq('workspace_id', workspaceId).gte('data', prev.from).lte('data', prev.to),
  ])

  const atual = computeMetricsFromRows(
    (metaA.data ?? []) as MetaRow[],
    (transA.data ?? []) as TransRow[],
    (clarA.data ?? []) as ClarityRow[],
  )
  const anterior = computeMetricsFromRows(
    (metaP.data ?? []) as MetaRow[],
    (transP.data ?? []) as TransRow[],
    (clarP.data ?? []) as ClarityRow[],
  )

  return {
    atual,
    anterior,
    deltas: diffMetrics(atual, anterior),
    rangeAtual: { from, to },
    rangeAnterior: prev,
  }
}
