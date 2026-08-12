/**
 * "Perguntar à IA" — drawer global. Monta um snapshot leve do contexto da
 * rota atual (pathname + searchParams) e chama Gemini sem schema (texto livre).
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
import { buildAskPrompt, ASK_PROMPT_VERSION, type AskRole } from './prompts/ask-v1'
import { aggregateCreatives } from './creativeAnalysis'
import { topValoresMascarados } from './maskedValues'
import { sanitizeUserInput, generateNonce, hasCanaryLeak } from './aiSanitize'
import { getActiveWorkspaceId } from './workspace-context'
import { computeCenario, normalizeEstado } from './simulador'
import { diaSeguinteYmd, type SbMetaAds, type SbTransacao } from './supabase'
import type { SimuladorState } from './acoesVendas'
import { runChat, claudeAvailable } from './aiProviders'

export interface AskInput {
  question: string
  pathname: string
  searchParams: Record<string, string>
  history?: Array<{ role: 'user' | 'assistant'; text: string }>
  role?: AskRole
  /** A-F5: motor. Ausente/gemini = grátis; claude = assinatura (bridge). */
  provider?: 'gemini' | 'claude'
  model?: string
}

export interface AskOutput {
  answer: string
  tokens_input: number | null
  tokens_output: number | null
  prompt_version: string
  modelo: string
}

export class CanaryLeakError extends Error {
  constructor() {
    super('canary-leak')
    this.name = 'CanaryLeakError'
  }
}

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function topN<T>(rows: T[], n: number, sortBy: (r: T) => number): T[] {
  return [...rows].sort((a, b) => sortBy(b) - sortBy(a)).slice(0, n)
}

function getRange(sp: Record<string, string>): { from: string; to: string } {
  const today = new Date()
  today.setUTCHours(today.getUTCHours() - 3) // BRT
  const todayStr = today.toISOString().slice(0, 10)
  const past = new Date(today.getTime() - 30 * 86400000)
  const pastStr = past.toISOString().slice(0, 10)
  return {
    from: sp.de || pastStr,
    to: sp.ate || todayStr,
  }
}

/**
 * Snapshot leve por rota: tenta caber em ~3k tokens. Sem joins pesados.
 */
export async function buildAskContext(
  pathname: string,
  searchParams: Record<string, string>,
): Promise<unknown> {
  const supabase = getSupabase()
  const wsId = await getActiveWorkspaceId()
  const { from, to } = getRange(searchParams)
  const funil = searchParams.funil ?? 'all'
  const conta = searchParams.conta ?? ''

  if (pathname.startsWith('/clarity')) {
    const { data } = await supabase
      .from('clarity_daily')
      .select('data, recorte, dimensao_valor, sessions, scroll_depth_pct, engagement_time_sec, rage_clicks, dead_clicks, quick_backs')
      .eq('workspace_id', wsId)
      .gte('data', from)
      .lte('data', to)
      .eq('recorte', 'url')
    const rows = (data ?? []) as Array<Record<string, unknown>>
    const top = topN(rows, 10, (r) => Number(r.sessions ?? 0))
    return { rota: '/clarity', periodo: { from, to }, top_urls: top }
  }

  if (pathname.startsWith('/insights-ia')) {
    const { data } = await supabase
      .from('ai_insights')
      .select('data, periodo_from, periodo_to, tldr, alertas, oportunidades, recomendacoes, modelo, prompt_version')
      .eq('workspace_id', wsId)
      .order('gerado_at', { ascending: false })
      .limit(5)
    return { rota: '/insights-ia', periodo: { from, to }, ultimos_insights: data ?? [] }
  }

  if (pathname.startsWith('/qualificacao') || pathname.startsWith('/perfil-comprador') || pathname.startsWith('/voz-comprador')) {
    const { data } = await supabase
      .from('qualificacao')
      .select('faturamento_declarado, maior_dificuldade, medos, objetivos, faixa_etaria, tipo_clinica')
      .eq('workspace_id', wsId)
      .gte('created_at', `${from}T00:00:00`)
      .lt('created_at', `${diaSeguinteYmd(to)}T00:00:00`) // #14 fim de dia exclusivo
      .limit(500)
    const rows = (data ?? []) as Array<Record<string, string>>
    return {
      rota: pathname,
      periodo: { from, to },
      n_fichas: rows.length,
      top_dores: topValoresMascarados(rows, r => r.maior_dificuldade),
      top_medos: topValoresMascarados(rows, r => r.medos),
      top_objetivos: topValoresMascarados(rows, r => r.objetivos),
      top_faturamento: topValoresMascarados(rows, r => r.faturamento_declarado),
    }
  }

  if (pathname.startsWith('/planejamento')) {
    const id = pathname.split('/')[2]
    if (id) {
      const { data: acao } = await supabase.from('acoes_vendas')
        .select('nome,tipo,status,sigla,data_inicio,data_fim,is_planejamento')
        .eq('workspace_id', wsId).eq('id', id).maybeSingle()
      if (acao?.is_planejamento) {
        const { data: cens } = await supabase.from('acao_cenarios').select('nome,kind,estado,is_melhor').eq('workspace_id', wsId).eq('acao_id', id).order('ordem')
        const { data: notas } = await supabase.from('acao_notas').select('corpo,created_at').eq('workspace_id', wsId).eq('acao_id', id).order('created_at', { ascending: false }).limit(20)
        const cenarios = (cens ?? []).map((c) => {
          const d = computeCenario(normalizeEstado(c.estado as Partial<SimuladorState>))
          return { nome: c.nome, melhor: c.is_melhor, faturamento: round(d.faturamentoTotal), roas: round(d.roas, 2), ingressos: d.totalIngressos, cpa: round(d.cpa, 2) }
        })
        const notasTxt = (notas ?? []).map((n) => sanitizeUserInput(String(n.corpo ?? ''), 200))
        return {
          rota: '/planejamento',
          acao: { nome: acao.nome, tipo: acao.tipo, status: acao.status, sigla: acao.sigla, janela: { from: acao.data_inicio, to: acao.data_fim } },
          cenarios, notas: notasTxt,
        }
      }
    }
    return { rota: '/planejamento', info: 'lista de planejamentos' }
  }

  // Default: rotas de criativos/campanhas/funil/financeiro/visao-geral
  let metaQ = supabase
    .from('meta_ads')
    .select('data, criativo, ad_id, ad_name, campaign_name, account_id, investimento, cliques_link, landing_views, compras, valor_compras')
    .eq('workspace_id', wsId)
    .gte('data', from)
    .lte('data', to)
  if (conta && conta !== 'all') metaQ = metaQ.eq('account_id', conta)
  const meta = await metaQ
  const trans = await supabase
    .from('transacoes')
    .select('data, criativo, ad_id, valor_bruto, produto')
    .eq('workspace_id', wsId)
    .gte('data', from)
    .lte('data', to)

  let metaRows = (meta.data ?? []) as SbMetaAds[]
  let transRows = (trans.data ?? []) as SbTransacao[]
  if (funil && funil !== 'all') {
    const f = funil.toLowerCase()
    metaRows = metaRows.filter((m) => (m.campaign_name || '').toLowerCase().includes(f) || (m.ad_name || '').toLowerCase().includes(f))
    const adNames = new Set(metaRows.map((m) => m.ad_name || m.criativo))
    transRows = transRows.filter((t) => adNames.has(t.criativo))
  }

  const creatives = aggregateCreatives(metaRows, transRows)
  const top10 = topN(creatives, 10, (c) => c.investimento).map((c) => ({
    criativo: c.criativo,
    invest: round(c.investimento, 2),
    lpv: c.landing_views,
    compras: c.compras,
    receita: round(c.receita, 2),
    roas: round(c.roas, 2),
    cpa: c.cpa != null ? round(c.cpa, 2) : null,
    conv_pagina_pct: round(c.conv_pagina * 100, 3),
    score: c.score,
  }))

  const totalInvest = creatives.reduce((s, c) => s + c.investimento, 0)
  const totalReceita = creatives.reduce((s, c) => s + c.receita, 0)
  const totalCompras = creatives.reduce((s, c) => s + c.compras, 0)
  const totalLpv = creatives.reduce((s, c) => s + c.landing_views, 0)

  return {
    rota: pathname,
    periodo: { from, to },
    filtros: { funil, conta: conta || 'all' },
    kpis: {
      investimento: round(totalInvest, 2),
      receita: round(totalReceita, 2),
      compras: totalCompras,
      lpv: totalLpv,
      roas: totalInvest > 0 ? round(totalReceita / totalInvest, 2) : 0,
      cpa: totalCompras > 0 ? round(totalInvest / totalCompras, 2) : null,
      n_criativos: creatives.length,
    },
    top_criativos: top10,
  }
}

function round(n: number, d = 2): number {
  const k = Math.pow(10, d)
  return Math.round(n * k) / k
}

const ABSOLUTE_TOKEN_BUDGET = 5000 // grosseiro: ~4 chars/token

export async function askAI(input: AskInput): Promise<AskOutput> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY não configurado')

  // Sanitize question + recent history antes de qualquer concat — strip control
  // chars, tags reservadas <usr_*>/<sys_*>, e limite de tamanho.
  const cleanQuestion = sanitizeUserInput(input.question, 1500)
  const cleanHistory = (input.history ?? []).slice(-4).map(h => ({
    role: h.role,
    text: sanitizeUserInput(h.text, 1500),
  }))

  const contexto = await buildAskContext(input.pathname, input.searchParams)

  const nonce = generateNonce(16)
  const canary = generateNonce(8)

  const prompt = buildAskPrompt({
    question: cleanQuestion,
    pathname: input.pathname,
    searchParams: input.searchParams,
    contexto,
    history: cleanHistory,
    role: input.role,
    nonce,
    canary,
  })

  // Salva-vidas: se contexto + pergunta passou do orçamento, trunca o JSON.
  let safePrompt = prompt
  if (prompt.length > ABSOLUTE_TOKEN_BUDGET * 4) {
    safePrompt = prompt.slice(0, ABSOLUTE_TOKEN_BUDGET * 4) + '\n…(snapshot truncado)\n'
  }

  let answer: string
  let tokIn: number | null
  let tokOut: number | null
  let modelUsed: string

  if (input.provider === 'claude' && claudeAvailable()) {
    // Claude pela assinatura (bridge). O safePrompt já carrega contexto + defesas;
    // vai como mensagem do user. Canário + sanitize da rota valem igual.
    const out = await runChat({
      provider: 'claude',
      model: input.model,
      systemPrompt: 'Você é um analista de dados do dashboard Analytics Hub. Responda em português, direto e honesto, usando SÓ os dados do snapshot fornecido. Nunca invente número.',
      history: [{ role: 'user', content: safePrompt }],
      promptVersion: ASK_PROMPT_VERSION,
    })
    answer = out.reply
    tokIn = out.tokens_input
    tokOut = out.tokens_output
    modelUsed = out.modelo
  } else {
    const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
    const client = new GoogleGenerativeAI(key)
    const model = client.getGenerativeModel({
      model: modelName,
      generationConfig: {
        // Texto plano: rejeitamos tentativa do modelo de devolver HTML/JSON estruturado
        // que possa virar XSS quando renderizado. sanitizeAIResponse faz strip final.
        responseMimeType: 'text/plain',
        temperature: 0.4,
      },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ],
    })
    const res = await model.generateContent(safePrompt)
    answer = res.response.text()
    tokIn = res.response.usageMetadata?.promptTokenCount ?? null
    tokOut = res.response.usageMetadata?.candidatesTokenCount ?? null
    modelUsed = modelName
  }

  // Canary leak = o modelo repetiu o token secreto que está no system prompt.
  // Único caminho pra isso é o user ter conseguido extrair o system prompt
  // (prompt injection bem-sucedido). Descartar resposta + sinalizar pra rota.
  if (hasCanaryLeak(answer, `CANARY_${canary}`)) {
    console.warn('[askAI] canary leak detected — prompt injection attempt', {
      pathname: input.pathname,
      role: input.role,
    })
    throw new CanaryLeakError()
  }

  return {
    answer,
    tokens_input: tokIn,
    tokens_output: tokOut,
    prompt_version: ASK_PROMPT_VERSION,
    modelo: modelUsed,
  }
}
