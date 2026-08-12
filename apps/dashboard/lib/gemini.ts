import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { buildInsightsPrompt, INSIGHTS_PROMPT_VERSION } from './prompts/insights-v1'
import { buildInsightsV2Prompt, INSIGHTS_V2_PROMPT_VERSION } from './prompts/insights-v2'
import {
  buildCriativoAnalisePrompt,
  criativoAnaliseSchema,
  CRIATIVO_ANALISE_PROMPT_VERSION,
  type WorkspaceContext,
} from './prompts/criativo-analise-v1'
import {
  buildSugestoesPrompt,
  sugestoesSchema,
  SUGESTOES_PROMPT_VERSION,
  type SugestoesPromptInput,
} from './prompts/sugestoes-v1'
import type { AiInsightItem } from './supabase'

const insightItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    titulo: { type: SchemaType.STRING },
    severidade: { type: SchemaType.STRING, enum: ['alta', 'media', 'baixa'] },
    metrica: { type: SchemaType.STRING },
    descricao: { type: SchemaType.STRING },
  },
  required: ['titulo', 'descricao'],
}

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    tldr: { type: SchemaType.STRING },
    alertas: { type: SchemaType.ARRAY, items: insightItemSchema },
    oportunidades: { type: SchemaType.ARRAY, items: insightItemSchema },
    recomendacoes: { type: SchemaType.ARRAY, items: insightItemSchema },
  },
  required: ['tldr', 'alertas', 'oportunidades', 'recomendacoes'],
}

export interface InsightInput {
  data: string
  contexto: unknown
}

export interface InsightInputV2 {
  from: string
  to: string
  contexto: unknown
}

export interface InsightOutput {
  modelo: string
  prompt_version: string
  tldr: string
  alertas: AiInsightItem[]
  oportunidades: AiInsightItem[]
  recomendacoes: AiInsightItem[]
  tokens_input: number | null
  tokens_output: number | null
}

function buildModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY não configurado')
  const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  const client = new GoogleGenerativeAI(key)
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema as never,
    },
  })
  return { model, modelName }
}

export async function generateInsight(input: InsightInput): Promise<InsightOutput> {
  const { model, modelName } = buildModel()
  const prompt = buildInsightsPrompt(input)
  const res = await model.generateContent(prompt)
  const parsed = JSON.parse(res.response.text())
  return {
    modelo: modelName,
    prompt_version: INSIGHTS_PROMPT_VERSION,
    tldr: parsed.tldr ?? '',
    alertas: parsed.alertas ?? [],
    oportunidades: parsed.oportunidades ?? [],
    recomendacoes: parsed.recomendacoes ?? [],
    tokens_input: res.response.usageMetadata?.promptTokenCount ?? null,
    tokens_output: res.response.usageMetadata?.candidatesTokenCount ?? null,
  }
}

/**
 * Geração livre (sem schema JSON) — útil para análises customizadas como
 * experiment-health insights (Fase 7). Retorna texto puro.
 *
 * Resiliência:
 *  - Retry exponencial em 503/429 (cada modelo) — Gemini sofre spikes de demanda
 *  - Fallback cadeia de modelos: se um esgotar retries, tenta o próximo
 */
export async function generateText(prompt: string): Promise<string> {
  let lastErr: unknown = new Error('nenhum provider de texto disponível')

  // 1) DeepInfra (pago) → Groq → OpenRouter. PRIMEIRO porque o free tier do Gemini
  // está zerado (429 limit:0) — não adianta gastar backoff nele. Com billing do
  // DeepInfra ativo, a classificação/análise roda sem cota. Vocabulário fixo +
  // sanitização do caller garantem a qualidade do Llama-3.3-70B.
  const llama = await textViaLlama(prompt).catch((e) => { lastErr = e; return null })
  if (llama && llama.trim()) return llama

  // 2) Gemini (free) — só se o Llama/DeepInfra falhar e a cota do Gemini voltar.
  const key = process.env.GEMINI_API_KEY
  if (key) {
    const primary = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
    const chain = [primary, 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
      .filter((m, i, a) => a.indexOf(m) === i)
    const client = new GoogleGenerativeAI(key)
    const delays = [500, 1500, 3500]
    for (const modelName of chain) {
      const model = client.getGenerativeModel({ model: modelName })
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          const res = await model.generateContent(prompt)
          return res.response.text()
        } catch (e) {
          lastErr = e
          const msg = (e as Error).message ?? ''
          const transient = /\b(503|429)\b|high demand|overloaded|rate limit|quota|exhaust/i.test(msg)
          if (!transient) break
          if (attempt === delays.length) break
          await new Promise(r => setTimeout(r, delays[attempt]))
        }
      }
    }
  }
  throw lastErr
}

/** Completion de TEXTO via API OpenAI-compatible (DeepInfra/Groq/OpenRouter, Llama). */
async function textViaLlama(prompt: string): Promise<string | null> {
  const providers = [
    // DeepInfra PRIMEIRO: pago (billing ativo), sem cota, confiável — destrava a
    // classificação quando o free tier do Gemini/Groq esgota.
    { base: 'https://api.deepinfra.com/v1/openai', key: process.env.DEEPINFRA_API_KEY, model: process.env.DEEPINFRA_LLM_MODEL ?? 'meta-llama/Llama-3.3-70B-Instruct', label: 'deepinfra' },
    { base: 'https://api.groq.com/openai/v1', key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile', label: 'groq' },
    { base: 'https://openrouter.ai/api/v1', key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct', label: 'openrouter' },
  ]
  for (const p of providers) {
    if (!p.key) continue
    try {
      const r = await fetch(`${p.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 4096 }),
      })
      if (!r.ok) continue
      const j = await r.json()
      const content = j?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.trim()) return content
    } catch { /* tenta o próximo provider */ }
  }
  return null
}

// ─── Criativo (multimodal) ────────────────────────────────────────────────────

export interface CriativoAnalyzeInput {
  videoUrl: string | null
  thumbnailUrl: string | null
  copy: string | null
  workspace: WorkspaceContext
  /** Transcrição Whisper já pronta (VPS). Se presente, classifica sobre TEXTO+frames (não baixa o vídeo). */
  transcricao?: string | null
  /** URLs dos frames extraídos pela VPS (Supabase Storage), pra contexto visual. */
  frames?: string[]
  /** Anúncio de IMAGEM (ou vídeo sem transcrição): classifica pela imagem (thumbnailUrl) + copy, sem baixar vídeo. */
  imageOnly?: boolean
}

export interface CriativoAnalyzeOutput {
  modelo: string
  prompt_version: string
  video_hash: string | null
  transcricao: string
  resumo: string
  hook_descricao: string
  hook_tipo: string[]
  angulo_copy: string[]
  formato_visual: string[]
  elementos_visuais: string[]
  cta: string[]
  producao: string[]
  nivel_consciencia: string
  momento_funil: string
  promessa_principal: string
  one_belief_score: number | null
  one_belief_desvio: string
  estrutura_roteiro: Record<string, unknown>
  padroes_detectados: Record<string, unknown>
  tokens_input: number | null
  tokens_output: number | null
}

/** Escolhe até `max` frames representativos (espalhados), pra dar contexto visual sem inflar o payload. */
function pickFrames(frames: string[], max = 4): string[] {
  const f = frames.filter((u) => typeof u === 'string' && u.trim() !== '')
  if (f.length <= max) return f
  const out: string[] = []
  for (let i = 0; i < max; i++) out.push(f[Math.round((i * (f.length - 1)) / (max - 1))])
  return [...new Set(out)]
}

// Gemini inlineData aceita até 20MB. Acima disso é Files API (PR 3.5).
const INLINE_VIDEO_MAX_BYTES = 20 * 1024 * 1024

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const { createHash } = await import('node:crypto')
  const h = createHash('sha256')
  h.update(Buffer.from(buf))
  return h.digest('hex')
}

async function fetchMedia(url: string): Promise<{ buf: ArrayBuffer; mime: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch media falhou: HTTP ${res.status} (${url.slice(0, 80)}...)`)
  const buf = await res.arrayBuffer()
  const mime = res.headers.get('content-type') ?? 'application/octet-stream'
  return { buf, mime }
}

// Fallback NÃO-Gemini (texto-só) pra quando os modelos Gemini esgotam a cota.
// Gemini força o schema via responseSchema; aqui descrevemos o shape no prompt.
const LLAMA_JSON_HINT = `

Responda SOMENTE um objeto JSON válido (sem markdown, sem texto fora do JSON) com EXATAMENTE estas chaves:
{"transcricao":string,"resumo":string,"hook_descricao":string,
"hook_tipo":string[] (subconjunto de PAR,ESP,CUR,POL,PER,AUT,URG,DEMO,ID),
"angulo_copy":string[] (de dor,ganho,status,identidade,fomo,prova_social,simplicidade,metodo,transformacao),
"formato_visual":string[] (siglas POV,Esquete,FAFZ,"Conversa no Carro",CPAP,Cinema,Rotina,TH-CAM,TH-CLI,TH-DESK),
"elementos_visuais":string[],"cta":string[],"producao":string[],
"nivel_consciencia":string (Inconsciente|"Consciente do problema"|"Consciente da solução"|"Consciente do produto"|"O mais consciente"),
"momento_funil":string (Topo|Meio|Fundo|Remarketing),
"promessa_principal":string,"one_belief_score":number (0 a 1),"one_belief_desvio":string,
"estrutura_roteiro":{"narrativa":string,"gancho":string,"desenvolvimento":string,"cta_timing":string,"confianca":number},
"padroes_detectados":{"gancho_codigo":string[] (g01..g46),"tom":string,"objecoes_respondidas":string[],"gatilhos_mentais":string[],"observacoes":string}}`

/** Classifica via API OpenAI-compatible (OpenRouter/Groq). Texto-só. */
async function classifyViaOpenAICompat(opts: {
  base: string
  key: string
  model: string
  prompt: string
  label: string
}): Promise<Record<string, unknown>> {
  const r = await fetch(`${opts.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.key}` },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: 'user', content: opts.prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 4096,
    }),
  })
  if (!r.ok) throw new Error(`${opts.label} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  const content: string = j?.choices?.[0]?.message?.content ?? ''
  if (!content.trim()) throw new Error(`${opts.label}: resposta vazia`)
  const clean = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  return JSON.parse(clean) as Record<string, unknown>
}

/**
 * Analisa criativo multimodal (vídeo + thumbnail + copy) com Gemini 2.5 Pro.
 * Cache eterno via video_hash deve ser feito pelo caller (route) ANTES desta
 * função — aqui sempre re-analisa.
 */
export async function analyzeCreative(input: CriativoAnalyzeInput): Promise<CriativoAnalyzeOutput> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY não configurado')
  // Default Flash pra rodar sem billing. Pra Pro (melhor compreensão de
  // vídeo/sutilezas de hook), ative billing no Google Cloud e seta
  // GEMINI_CRIATIVOS_MODEL=gemini-2.5-pro na env.
  const modelName = process.env.GEMINI_CRIATIVOS_MODEL ?? 'gemini-2.5-flash'

  const client = new GoogleGenerativeAI(key)
  // Fallback de modelo + retry: o free tier do Gemini limita por modelo (429).
  // Em 429/503/quota, espera (backoff) e tenta o próximo modelo — cada um tem
  // cota grátis própria, então a chain triplica a capacidade diária sem billing.
  const chain = [modelName, 'gemini-2.5-flash-lite', 'gemini-2.0-flash'].filter((m, i, a) => a.indexOf(m) === i)

  const parts: Array<{ inlineData: { data: string; mimeType: string } } | { text: string }> = []
  let videoHash: string | null = null
  let framesCount = 0
  const temTranscricao = !!(input.transcricao && input.transcricao.trim())

  if (temTranscricao) {
    // MODO TEXTO+FRAMES (VPS): usa a transcrição Whisper + frames já extraídos.
    // NÃO baixa o vídeo → sem teto de 20MB e sem gastar com re-transcrição.
    for (const url of pickFrames(input.frames ?? [], 4)) {
      try {
        const { buf, mime } = await fetchMedia(url)
        parts.push({
          inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: mime.startsWith('image/') ? mime : 'image/jpeg' },
        })
        framesCount++
      } catch {
        /* frame indisponível — segue com os demais */
      }
    }
    if (framesCount === 0 && input.thumbnailUrl) {
      try {
        const { buf, mime } = await fetchMedia(input.thumbnailUrl)
        parts.push({ inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: mime } })
        framesCount = 1
      } catch {
        /* sem imagem — classifica só pela transcrição + copy */
      }
    }
  } else if (input.imageOnly) {
    // MODO IMAGEM: anúncio estático (ou vídeo sem transcrição) — classifica pela
    // imagem do criativo (thumbnailUrl = image_url/thumbnail do Meta) + copy.
    // NÃO baixa vídeo (evita o teto de 20MB e o caminho que falha em vídeos sem áudio).
    if (input.thumbnailUrl) {
      try {
        const { buf, mime } = await fetchMedia(input.thumbnailUrl)
        parts.push({ inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: mime.startsWith('image/') ? mime : 'image/jpeg' } })
        framesCount = 1
      } catch {
        /* sem imagem acessível — classifica só pela copy */
      }
    }
  } else if (input.videoUrl) {
    // MODO LEGADO (sem transcrição Whisper): vídeo inline no Gemini.
    const { buf, mime } = await fetchMedia(input.videoUrl)
    if (buf.byteLength > INLINE_VIDEO_MAX_BYTES) {
      throw new Error(`vídeo > 20MB (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB) — use o pipeline da VPS (transcrição+frames)`)
    }
    videoHash = await sha256Hex(buf)
    parts.push({ inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: mime } })
  } else if (input.thumbnailUrl) {
    const { buf, mime } = await fetchMedia(input.thumbnailUrl)
    parts.push({ inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: mime } })
  }

  const promptText = buildCriativoAnalisePrompt({
    workspace: input.workspace,
    copy: input.copy,
    transcricao: temTranscricao ? input.transcricao : null,
    framesCount,
    hasVideo: !temTranscricao && !input.imageOnly && !!input.videoUrl,
    isImage: !temTranscricao && !!input.imageOnly,
  })
  parts.push({ text: promptText })

  const delays = [1000, 3000, 8000]
  let res: Awaited<ReturnType<ReturnType<typeof client.getGenerativeModel>['generateContent']>> | undefined
  let usedModel = modelName
  let lastErr: unknown
  outer: for (const mName of chain) {
    const model = client.getGenerativeModel({
      model: mName,
      generationConfig: { responseMimeType: 'application/json', responseSchema: criativoAnaliseSchema as never },
    })
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        res = await model.generateContent(parts)
        usedModel = mName
        break outer
      } catch (e) {
        lastErr = e
        const msg = (e as Error).message ?? ''
        const quotaExhausted = /\b429\b|quota|rate limit|too many|exceeded/i.test(msg)
        const overloaded = /\b503\b|overloaded|unavailable|high demand/i.test(msg)
        // 429/cota não passa em poucos segundos → vai DIRETO pro próximo modelo
        // (evita gastar ~36s de backoff e estourar o limite de 60s da função Vercel).
        if (quotaExhausted) break
        if (!overloaded) throw e
        if (attempt === delays.length) break
        await new Promise((r) => setTimeout(r, delays[attempt]))
      }
    }
  }
  let parsed = res ? JSON.parse(res.response.text()) : undefined

  // Fallback NÃO-Gemini quando todos os modelos Gemini esgotam a cota (429):
  // OpenRouter (Llama) -> Groq (Llama). Texto-só (transcrição + copy, sem frames).
  if (parsed === undefined) {
    const provedores = [
      { label: 'deepinfra', base: 'https://api.deepinfra.com/v1/openai', key: process.env.DEEPINFRA_API_KEY, model: process.env.DEEPINFRA_LLM_MODEL ?? 'meta-llama/Llama-3.3-70B-Instruct' },
      { label: 'openrouter', base: 'https://openrouter.ai/api/v1', key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct' },
      { label: 'groq', base: 'https://api.groq.com/openai/v1', key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile' },
    ]
    for (const p of provedores) {
      if (!p.key) continue
      try {
        parsed = await classifyViaOpenAICompat({ base: p.base, key: p.key, model: p.model, prompt: promptText + LLAMA_JSON_HINT, label: p.label })
        usedModel = `${p.label}:${p.model}`
        break
      } catch (e) {
        lastErr = e
      }
    }
  }
  if (parsed === undefined) throw lastErr instanceof Error ? lastErr : new Error('Gemini e Llama (OpenRouter/Groq) indisponíveis')

  return {
    modelo: usedModel,
    prompt_version: CRIATIVO_ANALISE_PROMPT_VERSION,
    video_hash: videoHash,
    // Em modo texto+frames, preserva a transcrição Whisper (VPS); não usa a do Gemini.
    transcricao: temTranscricao ? (input.transcricao as string) : (parsed.transcricao ?? ''),
    resumo: parsed.resumo ?? '',
    hook_descricao: parsed.hook_descricao ?? '',
    hook_tipo: parsed.hook_tipo ?? [],
    angulo_copy: parsed.angulo_copy ?? [],
    formato_visual: parsed.formato_visual ?? [],
    elementos_visuais: parsed.elementos_visuais ?? [],
    cta: parsed.cta ?? [],
    producao: parsed.producao ?? [],
    nivel_consciencia: parsed.nivel_consciencia ?? '',
    momento_funil: parsed.momento_funil ?? '',
    promessa_principal: parsed.promessa_principal ?? '',
    one_belief_score: typeof parsed.one_belief_score === 'number' ? parsed.one_belief_score : null,
    one_belief_desvio: parsed.one_belief_desvio ?? '',
    estrutura_roteiro: parsed.estrutura_roteiro ?? {},
    padroes_detectados: parsed.padroes_detectados ?? {},
    tokens_input: res?.response.usageMetadata?.promptTokenCount ?? null,
    tokens_output: res?.response.usageMetadata?.candidatesTokenCount ?? null,
  }
}

/**
 * Gera embedding 768d com gemini-embedding-001 (text-embedding-004 foi
 * descontinuado). Default desse modelo é 3072d — usamos outputDimensionality
 * pra reduzir pra 768 e bater com o schema vector(768) em criativo_analise.
 *
 * Usado pra busca semântica e agrupamento de criativos (PR 4 criativo_grupos).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY não configurado')
  const client = new GoogleGenerativeAI(key)
  const modelName = process.env.GEMINI_EMBED_MODEL ?? 'gemini-embedding-001'
  const model = client.getGenerativeModel({ model: modelName })
  const res = await model.embedContent({
    content: { role: 'user', parts: [{ text }] },
    outputDimensionality: 768,
  } as never)
  const v = res.embedding.values
  if (!Array.isArray(v) || v.length !== 768) {
    throw new Error(`embedding inesperado: tamanho ${v?.length} (esperava 768)`)
  }
  return v
}

// ─── Sugestões (cowork queue) ────────────────────────────────────────────────

export interface SugestaoItem {
  tipo: 'escalar' | 'pausar' | 'novo_brief' | 'lateralizar' | 'congruencia_fix' | 'vault_save'
  ad_id?: string | null
  titulo: string
  motivo: string
  payload?: Record<string, unknown>
}

export interface SugestoesOutput {
  modelo: string
  prompt_version: string
  sugestoes: SugestaoItem[]
  tokens_input: number | null
  tokens_output: number | null
}

export async function generateSugestoes(input: SugestoesPromptInput): Promise<SugestoesOutput> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY não configurado')
  const modelName = process.env.GEMINI_SUGESTOES_MODEL ?? 'gemini-2.5-flash'
  const client = new GoogleGenerativeAI(key)
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: sugestoesSchema as never,
    },
  })
  const res = await model.generateContent(buildSugestoesPrompt(input))
  const parsed = JSON.parse(res.response.text())
  return {
    modelo: modelName,
    prompt_version: SUGESTOES_PROMPT_VERSION,
    sugestoes: parsed.sugestoes ?? [],
    tokens_input: res.response.usageMetadata?.promptTokenCount ?? null,
    tokens_output: res.response.usageMetadata?.candidatesTokenCount ?? null,
  }
}

// ─── Chats (multi-turn) ──────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'model'
  content: string
}

export interface ChatTurnOutput {
  modelo: string
  prompt_version: string
  reply: string
  tokens_input: number | null
  tokens_output: number | null
}

/**
 * Multi-turn chat com Gemini. systemPrompt vai como systemInstruction;
 * o histórico é convertido pro formato Content[] do SDK.
 * Última mensagem do histórico DEVE ser do usuário (a que pede a resposta).
 */
export async function chatTurn(opts: {
  systemPrompt: string
  history: ChatMessage[]
  promptVersion: string
}): Promise<ChatTurnOutput> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY não configurado')
  if (opts.history.length === 0) throw new Error('history vazio')
  const last = opts.history[opts.history.length - 1]
  if (last.role !== 'user') throw new Error('última mensagem do history precisa ser do user')

  const modelName = process.env.GEMINI_CHATS_MODEL ?? 'gemini-2.5-flash'
  const client = new GoogleGenerativeAI(key)
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: opts.systemPrompt,
  })

  // Tudo menos a última vira história; a última vira message do sendMessage.
  const prior = opts.history.slice(0, -1).map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }))
  const chat = model.startChat({ history: prior })
  const res = await chat.sendMessage(last.content)

  return {
    modelo: modelName,
    prompt_version: opts.promptVersion,
    reply: res.response.text(),
    tokens_input: res.response.usageMetadata?.promptTokenCount ?? null,
    tokens_output: res.response.usageMetadata?.candidatesTokenCount ?? null,
  }
}

// ─── Chat AGÊNTICO (function-calling) — Equipe age, não só conversa ───────────
export interface AgenticTool {
  name: string
  description: string
  parameters: Record<string, unknown> // schema SchemaType.OBJECT
}
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

/**
 * chatTurn com tools (só Gemini — o bridge do Claude é texto-só). Roda o loop:
 * modelo pede function → executamos (executeTool) → devolvemos o resultado →
 * modelo conclui em texto. Máx 4 iterações (anti-loop). Devolve os nomes das
 * tools chamadas pra o caller saber se precisa dar refresh (ex.: tags aplicadas).
 */
export async function chatTurnAgentic(opts: {
  systemPrompt: string
  history: ChatMessage[]
  promptVersion: string
  tools: AgenticTool[]
  executeTool: ToolExecutor
}): Promise<ChatTurnOutput & { toolCalls: string[] }> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY não configurado')
  if (opts.history.length === 0) throw new Error('history vazio')
  const last = opts.history[opts.history.length - 1]
  if (last.role !== 'user') throw new Error('última mensagem do history precisa ser do user')

  const modelName = process.env.GEMINI_CHATS_MODEL ?? 'gemini-2.5-flash'
  const client = new GoogleGenerativeAI(key)
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: opts.systemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ functionDeclarations: opts.tools as any }],
  })

  const prior = opts.history.slice(0, -1).map((m) => ({ role: m.role, parts: [{ text: m.content }] }))
  const chat = model.startChat({ history: prior })

  const toolCalls: string[] = []
  let res = await chat.sendMessage(last.content)
  let tokIn = res.response.usageMetadata?.promptTokenCount ?? 0
  let tokOut = res.response.usageMetadata?.candidatesTokenCount ?? 0

  for (let iter = 0; iter < 4; iter++) {
    const calls = res.response.functionCalls?.() ?? []
    if (!calls.length) break
    const parts = []
    for (const c of calls) {
      toolCalls.push(c.name)
      let result: Record<string, unknown>
      try {
        result = await opts.executeTool(c.name, (c.args ?? {}) as Record<string, unknown>)
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) }
      }
      parts.push({ functionResponse: { name: c.name, response: result } })
    }
    res = await chat.sendMessage(parts)
    tokIn += res.response.usageMetadata?.promptTokenCount ?? 0
    tokOut += res.response.usageMetadata?.candidatesTokenCount ?? 0
  }

  return {
    modelo: modelName,
    prompt_version: opts.promptVersion,
    reply: res.response.text() || (toolCalls.length ? 'Feito.' : '(sem resposta)'),
    tokens_input: tokIn,
    tokens_output: tokOut,
    toolCalls,
  }
}

export async function generateInsightV2(input: InsightInputV2): Promise<InsightOutput> {
  const { model, modelName } = buildModel()
  const prompt = buildInsightsV2Prompt(input)
  const res = await model.generateContent(prompt)
  const parsed = JSON.parse(res.response.text())
  return {
    modelo: modelName,
    prompt_version: INSIGHTS_V2_PROMPT_VERSION,
    tldr: parsed.tldr ?? '',
    alertas: parsed.alertas ?? [],
    oportunidades: parsed.oportunidades ?? [],
    recomendacoes: parsed.recomendacoes ?? [],
    tokens_input: res.response.usageMetadata?.promptTokenCount ?? null,
    tokens_output: res.response.usageMetadata?.candidatesTokenCount ?? null,
  }
}
