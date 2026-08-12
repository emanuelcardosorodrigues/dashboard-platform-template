/**
 * Lê dados consolidados do período (Clarity + Meta + Vendas + Qualificação),
 * monta contexto enriquecido (matriz 2x2 de criativos, score saúde, cohort,
 * comparativo semanal) e chama Gemini para gerar análise estratégica.
 * Persiste resultado em ai_insights.
 *
 * Usado pelo cron diário (from===to=ontem) e pelo endpoint manual.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { generateInsight, generateInsightV2 } from './gemini'
import {
  aggregateCreatives,
  buildQuadrantMatrix,
  QUADRANT_LABEL,
  type Quadrant,
} from './creativeAnalysis'
import { cohortByCreative } from './cohortAnalysis'
import { computeWeekOverWeek } from './weekOverWeek'
import { topValoresMascarados } from './maskedValues'
import { liquidoHotmartTransacoes } from './hotmartFees'
import { tipoDaTransacao, diaSeguinteYmd, type SbMetaAds, type SbTransacao, type SbQualificacao } from './supabase'

type GeradoPor = 'cron' | 'manual'

export interface RunResult {
  ok: boolean
  insightId?: string
  tokens_input: number | null
  tokens_output: number | null
  error?: string
}

function topN<T>(rows: T[], n: number, sortBy: (r: T) => number): T[] {
  return [...rows].sort((a, b) => sortBy(b) - sortBy(a)).slice(0, n)
}

function resumirVendas(rows: SbTransacao[]) {
  if (!rows?.length) return { vazio: true }
  const total = rows.length
  const frontTx = rows.filter((r) => tipoDaTransacao(r) === 'frontEnd')
  const totalFront = frontTx.length
  // Receita líquida DA OPERAÇÃO = soma do líquido POR transação (taxa canônica).
  const receita = liquidoHotmartTransacoes(rows.map((r) => Number(r.valor_bruto ?? 0)))
  const receitaFront = liquidoHotmartTransacoes(frontTx.map((r) => Number(r.valor_bruto ?? 0)))
  const porProduto: Record<string, number> = {}
  for (const r of rows) {
    const p = String(r.produto ?? 'desconhecido')
    porProduto[p] = (porProduto[p] ?? 0) + 1
  }
  return {
    // Campos com semântica explícita pro contexto do Gemini.
    // total_transacoes = TODAS as transações (FE + OBs combinados).
    // total_vendas_front = apenas vendas do produto frontEnd (única base válida pra CPA).
    total_transacoes: total,
    total_vendas_front: totalFront,
    receita_liquida_total: receita,
    receita_liquida_front: receitaFront,
    // AOV definido como receita FE / vendas FE — não misturar OBs aqui.
    ticket_medio_front: totalFront > 0 ? receitaFront / totalFront : 0,
    por_produto: porProduto,
  }
}

function resumirFichas(rows: SbQualificacao[]) {
  if (!rows?.length) return { vazio: true }
  return {
    total_fichas: rows.length,
    top_dores: topValoresMascarados(rows, (r) => r.maior_dificuldade),
    top_medos: topValoresMascarados(rows, (r) => r.medos),
    top_objetivos: topValoresMascarados(rows, (r) => r.objetivos),
    top_faturamento: topValoresMascarados(rows, (r) => r.faturamento_declarado),
  }
}

async function fetchRangeData(
  supabase: SupabaseClient,
  from: string,
  to: string,
  workspaceId: string,
): Promise<{ clarity: Record<string, unknown>[]; meta: SbMetaAds[]; vendas: SbTransacao[]; fichas: SbQualificacao[] }> {
  const [clarity, meta, vendas, fichas] = await Promise.all([
    supabase.from('clarity_daily').select('*').eq('workspace_id', workspaceId).gte('data', from).lte('data', to),
    supabase.from('meta_ads').select('*').eq('workspace_id', workspaceId).gte('data', from).lte('data', to),
    supabase.from('transacoes').select('*').eq('workspace_id', workspaceId).gte('data', from).lte('data', to),
    supabase
      .from('qualificacao')
      .select('*')
      .eq('workspace_id', workspaceId)
      .gte('created_at', `${from}T00:00:00`)
      .lt('created_at', `${diaSeguinteYmd(to)}T00:00:00`) // #14 fim de dia exclusivo,
  ])
  return {
    clarity: (clarity.data ?? []) as Record<string, unknown>[],
    meta: (meta.data ?? []) as SbMetaAds[],
    vendas: (vendas.data ?? []) as SbTransacao[],
    fichas: (fichas.data ?? []) as SbQualificacao[],
  }
}

function buildCriativosMatriz(meta: SbMetaAds[], vendas: SbTransacao[]) {
  const creatives = aggregateCreatives(meta, vendas)
  const matrix = buildQuadrantMatrix(creatives, 'conv_pagina')
  const trimmed: Record<Quadrant, Array<Record<string, unknown>>> = {
    champion: [],
    hidden_gem: [],
    magnet: [],
    dead: [],
  }
  for (const q of Object.keys(matrix.cells) as Quadrant[]) {
    trimmed[q] = topN(matrix.cells[q], 5, (c) => c.investimento).map((c) => ({
      criativo: c.criativo,
      ad_id: c.ad_id,
      investimento: round(c.investimento, 2),
      compras: c.compras,
      receita: round(c.receita, 2),
      lpv: c.landing_views,
      roas: round(c.roas, 2),
      cpa: c.cpa != null ? round(c.cpa, 2) : null,
      conv_pagina: round(c.conv_pagina * 100, 3),
      score: c.score,
    }))
  }
  const ranking = [...creatives].sort((a, b) => b.score - a.score)
  const top3 = ranking.slice(0, 3).map((c) => ({ criativo: c.criativo, score: c.score, roas: round(c.roas, 2), cpa: c.cpa != null ? round(c.cpa, 2) : null }))
  const bottom3 = ranking.slice(-3).reverse().map((c) => ({ criativo: c.criativo, score: c.score, roas: round(c.roas, 2), cpa: c.cpa != null ? round(c.cpa, 2) : null }))
  return {
    medianas: { lpv: matrix.medianLpv, metrica: matrix.medianMetric, metrica_usada: 'conv_pagina' },
    quadrantes_label: QUADRANT_LABEL,
    quadrantes: trimmed,
    score_top_3: top3,
    score_bottom_3: bottom3,
  }
}

function buildCohortContexto(vendas: SbTransacao[], fichas: SbQualificacao[]) {
  const cohorts = cohortByCreative(vendas, fichas)
  const sorted = [...cohorts.values()]
    .sort((a, b) => b.n_compradores - a.n_compradores)
    .slice(0, 5)
  return sorted.map((c) => ({
    criativo: c.criativo,
    n_compradores: c.n_compradores,
    n_fichas: c.n_fichas,
    ticket_medio: round(c.ticket_medio, 2),
    top_dores: c.top_dores,
    top_medos: c.top_medos,
    top_objetivos: c.top_objetivos,
    top_faturamento: c.top_faturamento,
  }))
}

function round(n: number, d = 2): number {
  const k = Math.pow(10, d)
  return Math.round(n * k) / k
}

export async function runInsightGeneration(
  from: string,
  to: string,
  geradoPor: GeradoPor,
  workspaceId: string,
): Promise<RunResult> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const day = await fetchRangeData(supabase, from, to, workspaceId)

  const wow = await computeWeekOverWeek(supabase, from, to, workspaceId).catch((err) => {
    console.error('[insightsRunner] weekOverWeek error:', err instanceof Error ? err.message : err)
    return null
  })

  const contexto = {
    periodo: { from, to, dias: dayDiff(from, to) },
    clarity: day.clarity,
    meta: resumirMetaTotais(day.meta),
    vendas: resumirVendas(day.vendas),
    qualificacao: resumirFichas(day.fichas),
    criativos: buildCriativosMatriz(day.meta, day.vendas),
    cohort_por_criativo: buildCohortContexto(day.vendas, day.fichas),
    semana_atual_vs_anterior: wow ? {
      atual: wow.atual,
      anterior: wow.anterior,
      deltas: wow.deltas,
      range_atual: wow.rangeAtual,
      range_anterior: wow.rangeAnterior,
    } : null,
  }

  let insight
  try {
    if (from === to) {
      // Backwards-compat: cron diário usa v1 + estrutura antiga (still robust).
      insight = await generateInsight({ data: from, contexto })
    } else {
      insight = await generateInsightV2({ from, to, contexto })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[insightsRunner] gemini error:', msg)
    return { ok: false, tokens_input: null, tokens_output: null, error: msg }
  }

  const periodo = from === to ? 'daily' : 'custom'
  const insertRow: Record<string, unknown> = {
    workspace_id: workspaceId,
    data: to, // dia "âncora" — último dia do range
    periodo,
    periodo_from: from,
    periodo_to: to,
    gerado_por: geradoPor,
    metricas_contexto: contexto,
    modelo: insight.modelo,
    prompt_version: insight.prompt_version,
    tldr: insight.tldr,
    alertas: insight.alertas,
    oportunidades: insight.oportunidades,
    recomendacoes: insight.recomendacoes,
    tokens_input: insight.tokens_input,
    tokens_output: insight.tokens_output,
  }

  const { error } = await supabase.from('ai_insights').insert(insertRow)

  // Fallback: se as colunas periodo_from/periodo_to ainda não existem na DB,
  // re-tenta sem elas. Permite deploy do código antes da migration aplicada.
  if (error && error.code === '42703') {
    delete insertRow.periodo_from
    delete insertRow.periodo_to
    const retry = await supabase.from('ai_insights').insert(insertRow)
    if (retry.error) {
      console.error('[insightsRunner] insert error:', retry.error.message)
      return {
        ok: false,
        tokens_input: insight.tokens_input,
        tokens_output: insight.tokens_output,
        error: retry.error.message,
      }
    }
  } else if (error) {
    console.error('[insightsRunner] insert error:', error.message)
    return {
      ok: false,
      tokens_input: insight.tokens_input,
      tokens_output: insight.tokens_output,
      error: error.message,
    }
  }

  return {
    ok: true,
    tokens_input: insight.tokens_input,
    tokens_output: insight.tokens_output,
  }
}

function resumirMetaTotais(rows: SbMetaAds[]) {
  if (!rows?.length) return { vazio: true }
  const totalGasto = rows.reduce((s, r) => s + Number(r.investimento ?? 0), 0)
  const totalCompras = rows.reduce((s, r) => s + Number(r.compras ?? 0), 0)
  const totalValor = rows.reduce((s, r) => s + Number(r.valor_compras ?? 0), 0)
  const totalLpv = rows.reduce((s, r) => s + Number(r.landing_views ?? 0), 0)
  return {
    investimento_total: round(totalGasto, 2),
    compras_total_meta_tracking: totalCompras,
    valor_compras_meta_tracking: round(totalValor, 2),
    lpv_total: totalLpv,
    cpa_medio: totalCompras > 0 ? round(totalGasto / totalCompras, 2) : null,
    roas_meta_tracking: totalGasto > 0 ? round(totalValor / totalGasto, 2) : null,
  }
}

function dayDiff(from: string, to: string): number {
  const [yf, mf, df] = from.split('-').map(Number)
  const [yt, mt, dt] = to.split('-').map(Number)
  const a = Date.UTC(yf, mf - 1, df)
  const b = Date.UTC(yt, mt - 1, dt)
  return Math.round((b - a) / 86400000) + 1
}
