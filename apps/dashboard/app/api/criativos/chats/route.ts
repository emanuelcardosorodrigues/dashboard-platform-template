/**
 * GET  /api/criativos/chats?scope=creative|portfolio&ad_id=&limit=
 *   → lista chats do workspace ordenado por updated_at desc
 *
 * POST /api/criativos/chats
 *   body: { scope: 'creative'|'portfolio', ad_id?: string, user_email?: string, mensagem: string }
 *   → cria chat novo + monta contexto + chama Gemini + persiste primeiro turn (user+model)
 *
 * Para scope='creative', ad_id é obrigatório e precisa ter criativo_analise.status='ok'.
 * Para scope='portfolio', ad_id é ignorado.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAiUsage, incrementAndGetAiUsage } from '@/lib/aiUsage'
import { requireAuth } from '@/lib/apiAuth'
import { type ChatMessage } from '@/lib/gemini'
import { runChat, isValidEffort, claudeAvailable, type Provider } from '@/lib/aiProviders'
import { recordLedger, withinMonthlyCap } from '@/lib/aiLedger'
import { TAG_TOOL, makeTagExecutor } from '@/lib/aiTools'
import { canAccessDomain } from '@/lib/access'
import {
  buildCreativeSystemPrompt,
  buildPortfolioSystemPrompt,
  CHATS_PROMPT_VERSION,
  type CreativeContext,
  type PortfolioContext,
} from '@/lib/prompts/chats-v1'
import { log } from '@/lib/log'
import { fetchTransacoes, fetchQualificacao } from '@/lib/supabase'
import { computeTempoCompra, type QualComData } from '@/lib/tempoCompra'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LOOKBACK_DAYS = 7
const PORTFOLIO_TOP_N = 15

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface PersistedTurn {
  role: 'user' | 'model'
  content: string
  at: string
  tokens_input?: number | null
  tokens_output?: number | null
  modelo?: string
  prompt_version?: string
}

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope')
  const adId = req.nextUrl.searchParams.get('ad_id')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '30'), 200)

  if (scope && !['creative', 'portfolio'].includes(scope)) {
    return NextResponse.json({ error: 'scope inválido' }, { status: 400 })
  }

  try {
    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error
    const workspaceId = auth.ws.id

    let q = client
      .from('criativo_chats')
      .select('id, scope, ad_id, user_email, mensagens, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (scope) q = q.eq('scope', scope)
    if (adId) q = q.eq('ad_id', adId)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Compactar lista: retornar só o título (primeira msg do user) + count.
    const chats = (data ?? []).map((r) => {
      const msgs = (r.mensagens ?? []) as PersistedTurn[]
      const firstUser = msgs.find((m) => m.role === 'user')
      return {
        id: r.id,
        scope: r.scope,
        ad_id: r.ad_id,
        user_email: r.user_email,
        titulo: firstUser?.content?.slice(0, 120) ?? '(vazio)',
        total_mensagens: msgs.length,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }
    })

    const usage = await getAiUsage(auth.session.user_id)
    return NextResponse.json({
      workspaceId,
      total: chats.length,
      chats,
      claude_available: claudeAvailable(),
      ai_usage: { used: usage.count, quota: auth.session.ai_config.quota_daily },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('chats GET failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface CreateBody {
  scope: 'creative' | 'portfolio'
  ad_id?: string
  user_email?: string
  mensagem: string
  /** conjunto filtrado na tela (scope=portfolio) — escopa o contexto do modelo */
  ad_ids?: string[]
  /** A-F5: motor de IA. Ausente/gemini = grátis; claude = BYO (precisa key) */
  provider?: Provider
  model?: string
  effort?: string
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 })
  }
  if (!body.scope || !['creative', 'portfolio'].includes(body.scope)) {
    return NextResponse.json({ error: 'scope inválido' }, { status: 400 })
  }
  if (body.scope === 'creative' && !body.ad_id) {
    return NextResponse.json({ error: 'ad_id obrigatório para scope=creative' }, { status: 400 })
  }
  if (!body.mensagem || typeof body.mensagem !== 'string' || body.mensagem.trim().length === 0) {
    return NextResponse.json({ error: 'mensagem requerida' }, { status: 400 })
  }

  try {
    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error
    const { session, ws } = auth
    if (session.ai_config.disabled) {
      return NextResponse.json({ error: 'IA desativada para este usuário.' }, { status: 403 })
    }
    // Odin lê dados de criativos — gate por domínio (admin bypassa em canAccessDomain).
    if (!canAccessDomain(session, 'criativos')) {
      return NextResponse.json({ error: 'Sem acesso ao domínio de criativos.' }, { status: 403 })
    }
    const usage = await getAiUsage(session.user_id)
    if (usage.count >= session.ai_config.quota_daily) {
      return NextResponse.json({ error: `Limite diário atingido (${session.ai_config.quota_daily}).` }, { status: 429 })
    }

    const provider: Provider = body.provider === 'claude' ? 'claude' : 'gemini'
    if (provider === 'claude' && claudeAvailable()) {
      const cap = await withinMonthlyCap(client, ws.id)
      if (!cap.ok) {
        return NextResponse.json(
          { error: `Teto de custo do mês atingido (US$ ${cap.cap}). Gasto: US$ ${cap.spent.toFixed(2)}.` },
          { status: 402 }
        )
      }
    }

    const systemPrompt =
      body.scope === 'creative'
        ? buildCreativeSystemPrompt(ws.ctx, await loadCreativeContext(client, ws.id, body.ad_id!))
        : buildPortfolioSystemPrompt(ws.ctx, await loadPortfolioContext(client, ws.id, body.ad_ids))

    const history: ChatMessage[] = [{ role: 'user', content: body.mensagem.trim() }]
    const out = await runChat({
      provider,
      model: body.model,
      effort: isValidEffort(body.effort) ? body.effort : undefined,
      systemPrompt,
      history,
      promptVersion: CHATS_PROMPT_VERSION,
      tools: [TAG_TOOL],
      executeTool: makeTagExecutor(ws.id, session.email),
    })
    // cobra a quota só após a resposta do modelo (sucesso)
    await incrementAndGetAiUsage(session.user_id)
    await recordLedger(client, {
      workspaceId: ws.id,
      userEmail: session.email,
      scope: body.scope,
      provider: out.provider,
      model: out.modelo,
      tokensInput: out.tokens_input,
      tokensOutput: out.tokens_output,
      subscription: out.provider === 'claude',
    })

    const now = new Date().toISOString()
    const mensagens: PersistedTurn[] = [
      { role: 'user', content: body.mensagem.trim(), at: now },
      {
        role: 'model',
        content: out.reply,
        at: new Date().toISOString(),
        tokens_input: out.tokens_input,
        tokens_output: out.tokens_output,
        modelo: out.modelo,
        prompt_version: out.prompt_version,
      },
    ]

    const { data, error } = await client
      .from('criativo_chats')
      .insert({
        workspace_id: ws.id,
        scope: body.scope,
        ad_id: body.scope === 'creative' ? body.ad_id : null,
        user_email: session.email,
        mensagens,
      })
      .select('id, created_at')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      id: data.id,
      workspaceId: ws.id,
      scope: body.scope,
      ad_id: body.ad_id ?? null,
      created_at: data.created_at,
      reply: out.reply,
      modelo: out.modelo,
      provider: out.provider,
      prompt_version: out.prompt_version,
      tokens_input: out.tokens_input,
      tokens_output: out.tokens_output,
      tags_applied: (out.toolCalls?.length ?? 0) > 0,
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('chats POST failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── helpers de contexto (exportados pra reuso em [id]/route.ts) ─────────────

interface MetaAdAgg {
  ad_id: string
  ad_name: string | null
  spend: number
  purchases: number
  views_3seg: number
  views_75pct: number | null
}

export async function loadCreativeContext(
  client: SupabaseClient,
  workspaceId: string,
  adId: string
): Promise<CreativeContext> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const [{ data: adRows }, { data: anal }] = await Promise.all([
    client
      .from('meta_ads')
      .select('ad_id, ad_name, investimento, compras, views_3seg, views_75pct')
      .eq('workspace_id', workspaceId)
      .eq('ad_id', adId)
      .gte('data', cutoff),
    client
      .from('criativo_analise')
      .select('hook_descricao, hook_tipo, angulo_copy, formato_visual, cta, resumo, one_belief_score, transcricao, status')
      .eq('workspace_id', workspaceId)
      .eq('ad_id', adId)
      .maybeSingle(),
  ])

  if (!anal || anal.status !== 'ok') {
    throw new Error(`criativo_analise não-ok pra ad_id=${adId} — rode /api/criativos/analise/${adId} antes`)
  }

  const agg = (adRows ?? []).reduce<MetaAdAgg>(
    (acc, r) => {
      acc.ad_id = r.ad_id ?? acc.ad_id
      acc.ad_name = r.ad_name ?? acc.ad_name
      acc.spend += r.investimento || 0
      acc.purchases += r.compras || 0
      acc.views_3seg += r.views_3seg || 0
      acc.views_75pct = (acc.views_75pct ?? 0) + (r.views_75pct ?? 0)
      return acc
    },
    { ad_id: adId, ad_name: null, spend: 0, purchases: 0, views_3seg: 0, views_75pct: null }
  )

  const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : null
  const body_rate = agg.views_3seg > 0 && agg.views_75pct != null ? agg.views_75pct / agg.views_3seg : null

  return {
    ad_id: adId,
    ad_name: agg.ad_name,
    spend: agg.spend,
    purchases: agg.purchases,
    cpa,
    body_rate,
    views_3seg: agg.views_3seg,
    views_75pct: agg.views_75pct,
    one_belief_score: anal.one_belief_score,
    hook_descricao: anal.hook_descricao,
    hook_tipo: anal.hook_tipo,
    angulo_copy: anal.angulo_copy,
    resumo: anal.resumo,
    cta: anal.cta,
    formato_visual: anal.formato_visual,
    transcricao: anal.transcricao,
  }
}

export async function loadPortfolioContext(
  client: SupabaseClient,
  workspaceId: string,
  filterAdIds?: string[]
): Promise<PortfolioContext> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  // Filtro em JS (não `.in()`) — o conjunto visível pode ter centenas de ad_ids
  // e estouraria o limite de URL do PostgREST.
  const filterSet = filterAdIds && filterAdIds.length > 0 ? new Set(filterAdIds) : null

  const { data: ads, error } = await client
    .from('meta_ads')
    .select('ad_id, ad_name, investimento, compras, views_3seg, views_75pct')
    .eq('workspace_id', workspaceId)
    .gte('data', cutoff)
    .not('ad_id', 'is', null)
  if (error) throw new Error(error.message)

  const aggMap = new Map<string, MetaAdAgg>()
  for (const r of ads ?? []) {
    if (!r.ad_id) continue
    if (filterSet && !filterSet.has(r.ad_id)) continue
    const prev = aggMap.get(r.ad_id)
    if (!prev) {
      aggMap.set(r.ad_id, {
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? null,
        spend: r.investimento || 0,
        purchases: r.compras || 0,
        views_3seg: r.views_3seg || 0,
        views_75pct: r.views_75pct ?? null,
      })
    } else {
      prev.spend += r.investimento || 0
      prev.purchases += r.compras || 0
      prev.views_3seg += r.views_3seg || 0
      prev.views_75pct = (prev.views_75pct ?? 0) + (r.views_75pct ?? 0)
    }
  }

  const allAds = [...aggMap.values()]
  const spend_total = allAds.reduce((s, a) => s + a.spend, 0)
  const compras_total = allAds.reduce((s, a) => s + a.purchases, 0)
  const cpa_medio = compras_total > 0 ? spend_total / compras_total : null
  const views_3seg_total = allAds.reduce((s, a) => s + a.views_3seg, 0)
  const views_75_total = allAds.reduce((s, a) => s + (a.views_75pct ?? 0), 0)
  const body_rate_medio = views_3seg_total > 0 ? views_75_total / views_3seg_total : null

  const topAds = allAds.sort((a, b) => b.spend - a.spend).slice(0, PORTFOLIO_TOP_N)
  const adIds = topAds.map((a) => a.ad_id)

  let anaMap = new Map<string, { resumo: string | null; one_belief_score: number | null }>()
  if (adIds.length > 0) {
    const { data: anas } = await client
      .from('criativo_analise')
      .select('ad_id, resumo, one_belief_score, status')
      .eq('workspace_id', workspaceId)
      .in('ad_id', adIds)
    anaMap = new Map(
      (anas ?? [])
        .filter((a) => a.status === 'ok')
        .map((a) => [a.ad_id, { resumo: a.resumo, one_belief_score: a.one_belief_score }])
    )
  }

  // Tempo médio lead→compra (portfólio inteiro — independe do filtro de anúncio na tela).
  // Métrica acessória: um erro aqui nunca pode derrubar o contexto do chat.
  let tempo_compra_mediana: number | null = null
  let tempo_compra_n = 0
  try {
    const [transacoes, qualRows] = await Promise.all([
      fetchTransacoes(workspaceId),
      fetchQualificacao(workspaceId),
    ])
    const qualMap = new Map(qualRows.map((q) => [q.email.toLowerCase(), q as QualComData]))
    const tc = computeTempoCompra(transacoes, qualMap)
    tempo_compra_mediana = tc.medianaDias
    tempo_compra_n = tc.n
  } catch (e) {
    log.warn('tempo_compra falhou', { msg: e instanceof Error ? e.message : String(e) })
  }

  return {
    totals: {
      ads_ativos: allAds.length,
      spend_total,
      compras_total,
      cpa_medio,
      body_rate_medio,
      tempo_compra_mediana,
      tempo_compra_n,
      filtrado: !!filterSet,
    },
    top_ads: topAds.map((a) => {
      const ana = anaMap.get(a.ad_id)
      return {
        ad_id: a.ad_id,
        ad_name: a.ad_name,
        spend: a.spend,
        cpa: a.purchases > 0 ? a.spend / a.purchases : null,
        body_rate: a.views_3seg > 0 && a.views_75pct != null ? a.views_75pct / a.views_3seg : null,
        one_belief_score: ana?.one_belief_score ?? null,
        resumo: ana?.resumo ?? null,
      }
    }),
  }
}
