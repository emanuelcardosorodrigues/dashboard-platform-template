/**
 * POST /api/criativos/sugestoes/generate
 *
 * Gera sugestões usando Gemini sobre o snapshot dos últimos 7 dias.
 * Insere em criativo_sugestoes com status='pending' (cowork queue).
 *
 * Snapshot por ad agrega: spend, compras, views_3seg, views_75pct (→ Body
 * Rate), CPA, one_belief_score, hook_tipo, angulo_copy, resumo da análise.
 * Sem análise (criativo_analise.status='ok')? skip o ad — sugestão precisa
 * do contexto da análise pra ser útil.
 *
 * Body opcional: { cpa_alvo?: number }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceFromRequest } from '@/lib/criativo-pipeline'
import { generateSugestoes } from '@/lib/gemini'
import type { AdSummaryForSugestao } from '@/lib/prompts/sugestoes-v1'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LOOKBACK_DAYS = 7

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface MetaAdRow {
  ad_id: string
  ad_name: string
  investimento: number
  compras: number
  views_3seg: number
  views_75pct: number | null
}

interface AnaliseRow {
  ad_id: string
  one_belief_score: number | null
  hook_tipo: string[] | null
  angulo_copy: string[] | null
  resumo: string | null
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  let cpa_alvo: number | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.cpa_alvo === 'number') cpa_alvo = body.cpa_alvo
  } catch {
    // body opcional
  }

  try {
    const client = supa()
    const ws = await resolveWorkspaceFromRequest(client, req)

    // 1. Snapshot agregado por ad nos últimos 7d
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const { data: ads, error: adsErr } = await client
      .from('meta_ads')
      .select('ad_id, ad_name, investimento, compras, views_3seg, views_75pct')
      .eq('workspace_id', ws.id)
      .gte('data', cutoff)
      .not('ad_id', 'is', null)
    if (adsErr) return NextResponse.json({ error: adsErr.message }, { status: 500 })

    const agg = new Map<string, MetaAdRow>()
    for (const r of (ads ?? []) as MetaAdRow[]) {
      if (!r.ad_id) continue
      const prev = agg.get(r.ad_id)
      if (!prev) {
        agg.set(r.ad_id, { ...r })
      } else {
        prev.investimento += r.investimento || 0
        prev.compras += r.compras || 0
        prev.views_3seg += r.views_3seg || 0
        prev.views_75pct = (prev.views_75pct ?? 0) + (r.views_75pct ?? 0)
      }
    }

    const adIds = [...agg.keys()]
    if (adIds.length === 0) {
      return NextResponse.json({ workspaceId: ws.id, generated: 0, message: 'sem ads no período' })
    }

    // 2. Análises por ad (só os com status='ok')
    const { data: anal, error: anErr } = await client
      .from('criativo_analise')
      .select('ad_id, one_belief_score, hook_tipo, angulo_copy, resumo')
      .eq('workspace_id', ws.id)
      .eq('status', 'ok')
      .in('ad_id', adIds)
    if (anErr) return NextResponse.json({ error: anErr.message }, { status: 500 })

    const analMap = new Map<string, AnaliseRow>()
    for (const a of (anal ?? []) as AnaliseRow[]) analMap.set(a.ad_id, a)

    const snapshot: AdSummaryForSugestao[] = []
    for (const [adId, m] of agg.entries()) {
      const a = analMap.get(adId)
      if (!a) continue // sem análise pula
      snapshot.push({
        ad_id: adId,
        ad_name: m.ad_name,
        views_3seg: m.views_3seg,
        body_rate: m.views_3seg > 0 && m.views_75pct != null ? m.views_75pct / m.views_3seg : null,
        cpa: m.compras > 0 ? m.investimento / m.compras : null,
        spend: m.investimento,
        purchases: m.compras,
        one_belief_score: a.one_belief_score,
        hook_tipo: a.hook_tipo,
        angulo_copy: a.angulo_copy,
        resumo: a.resumo,
      })
    }

    if (snapshot.length === 0) {
      return NextResponse.json({
        workspaceId: ws.id,
        generated: 0,
        message: 'nenhum ad tem análise OK ainda — rode /api/criativos/analise/[adId] primeiro',
      })
    }

    // 3. Gemini gera sugestões
    const out = await generateSugestoes({
      workspace: { nome: ws.ctx.nome, one_belief: ws.ctx.one_belief, avatar_brief: ws.ctx.avatar_brief },
      cpa_alvo,
      ads: snapshot.sort((a, b) => b.spend - a.spend).slice(0, 30), // top spenders
    })

    // 4. Insere todas como pending
    if (out.sugestoes.length === 0) {
      return NextResponse.json({
        workspaceId: ws.id,
        generated: 0,
        modelo: out.modelo,
        tokens_input: out.tokens_input,
        tokens_output: out.tokens_output,
        duration_ms: Date.now() - startedAt,
        message: 'portfólio saudável — nenhuma sugestão',
      })
    }

    const rows = out.sugestoes.map((s) => ({
      workspace_id: ws.id,
      tipo: s.tipo,
      ad_id: s.ad_id ?? null,
      payload: { titulo: s.titulo, motivo: s.motivo, ...(s.payload ?? {}) },
      status: 'pending' as const,
      modelo: out.modelo,
    }))
    const { error: insErr } = await client.from('criativo_sugestoes').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

    return NextResponse.json({
      workspaceId: ws.id,
      generated: rows.length,
      modelo: out.modelo,
      prompt_version: out.prompt_version,
      tokens_input: out.tokens_input,
      tokens_output: out.tokens_output,
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('sugestoes/generate failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
