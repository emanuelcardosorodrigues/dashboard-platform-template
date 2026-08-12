/**
 * Camada de dados + agregações DETERMINÍSTICAS da aba "Análises de Comentários".
 * Números exatos (rankings, frequências, leads, objeções, gatilhos) são hard-coded
 * aqui; a leitura qualitativa (dores/dificuldades/oportunidades) vem da IA em
 * organic_comment_insights (endpoint analyze-comment-insights). RLS deny-all →
 * service-role; cache por workspaceId (tag sb-organico).
 */
import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

const REVALIDATE = 300
function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export interface ComentarioRow {
  id: string
  author_handle: string | null
  text: string | null
  like_count: number | null
  reply_count: number | null
  published_at: string | null
  is_reply: boolean
  sentiment: 'positivo' | 'negativo' | 'neutro' | null
  themes: string[]
  is_question: boolean | null
  post_id: string
  post_title: string | null
  post_permalink: string | null
  post_thumb: string | null
  platform: string
  account_external_id: string | null
}

/** Comentários do workspace enriquecidos com dados do post/conta (1 query, join). */
const _comentariosCore = unstable_cache(
  async (workspaceId: string): Promise<ComentarioRow[]> => {
    const { data } = await sb().from('organic_comments')
      .select('id, author_handle, text, like_count, reply_count, published_at, is_reply, sentiment, themes, is_question, post_id, organic_posts!inner ( title, permalink, thumbnail_url, platform, organic_accounts!inner ( external_id ) )')
      .eq('workspace_id', workspaceId)
      .limit(8000)
    type Raw = Omit<ComentarioRow, 'post_title' | 'post_permalink' | 'post_thumb' | 'platform' | 'account_external_id'> & {
      organic_posts: { title: string | null; permalink: string | null; thumbnail_url: string | null; platform: string; organic_accounts: { external_id: string | null } } | null
    }
    return ((data ?? []) as unknown as Raw[]).map((r) => ({
      id: r.id, author_handle: r.author_handle, text: r.text, like_count: r.like_count,
      reply_count: r.reply_count, published_at: r.published_at, is_reply: r.is_reply,
      sentiment: r.sentiment, themes: r.themes ?? [], is_question: r.is_question, post_id: r.post_id,
      post_title: r.organic_posts?.title ?? null,
      post_permalink: r.organic_posts?.permalink ?? null,
      post_thumb: r.organic_posts?.thumbnail_url ?? null,
      platform: r.organic_posts?.platform ?? 'instagram',
      account_external_id: r.organic_posts?.organic_accounts?.external_id ?? null,
    }))
  },
  ['organico-comentarios-v1'],
  { tags: ['sb-organico'], revalidate: REVALIDATE },
)
export const fetchComentarios = cache(async (): Promise<ComentarioRow[]> => _comentariosCore(await getActiveWorkspaceId()))

/** Palavras-gatilho de automação CONFIRMADas (normalizadas). */
const _triggersCore = unstable_cache(
  async (workspaceId: string): Promise<string[]> => {
    const { data } = await sb().from('organic_comment_triggers').select('word').eq('workspace_id', workspaceId)
    return ((data ?? []) as Array<{ word: string }>).map((r) => r.word)
  },
  ['organico-comment-triggers-v1'],
  { tags: ['sb-organico-triggers'], revalidate: REVALIDATE },
)
export const fetchTriggers = cache(async (): Promise<string[]> => _triggersCore(await getActiveWorkspaceId()))

export interface CommentInsights {
  dores: InsightItem[]; dificuldades: InsightItem[]; oportunidades: InsightItem[]
  desejos: InsightItem[]; duvidas: InsightItem[]
}
export interface InsightItem { titulo: string; evidencia: string; freq: number | null }
const EMPTY_INSIGHTS: CommentInsights = { dores: [], dificuldades: [], oportunidades: [], desejos: [], duvidas: [] }

const _commentInsightsCore = unstable_cache(
  async (workspaceId: string) => {
    const { data } = await sb().from('organic_comment_insights')
      .select('insights, computed_at, amostra').eq('workspace_id', workspaceId).maybeSingle()
    const row = data as { insights: Partial<CommentInsights>; computed_at: string; amostra: number | null } | null
    return {
      insights: { ...EMPTY_INSIGHTS, ...(row?.insights ?? {}) } as CommentInsights,
      computedAt: row?.computed_at ?? null,
      amostra: row?.amostra ?? null,
    }
  },
  ['organico-comment-insights-v1'],
  { tags: ['sb-organico-cinsights'], revalidate: REVALIDATE },
)
export const fetchCommentInsights = cache(async () => _commentInsightsCore(await getActiveWorkspaceId()))

// ─── Texto: normalização, stopwords, tokenização ─────────────────────────────

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Normaliza p/ detecção de gatilho: maiúscula, sem acento, só letras/números. */
export function normalizeTrigger(text: string): string {
  return semAcento((text ?? '').trim().toLowerCase()).replace(/[^a-z0-9]/g, '').toUpperCase()
}

const STOPWORDS = new Set<string>([
  'a', 'o', 'e', 'de', 'do', 'da', 'em', 'um', 'uma', 'para', 'pra', 'pro', 'com', 'nao', 'que', 'os', 'as', 'dos',
  'das', 'no', 'na', 'se', 'por', 'mais', 'me', 'meu', 'minha', 'seu', 'sua', 'eu', 'voce', 'vc', 'ele', 'ela', 'isso',
  'esse', 'essa', 'este', 'esta', 'ja', 'tem', 'ter', 'foi', 'sao', 'ser', 'esta', 'estao', 'mas', 'como', 'so', 'ai',
  'aqui', 'la', 'tudo', 'todo', 'toda', 'muito', 'muita', 'bem', 'tao', 'vai', 'vou', 'ate', 'sem', 'sobre', 'pela', 'pelo',
  'das', 'dele', 'dela', 'nos', 'das', 'qual', 'quando', 'onde', 'porque', 'pq', 'tbm', 'tambem', 'sim', 'ne', 'ola', 'oi',
  'obrigado', 'obrigada', 'gente', 'fica', 'faz', 'ter', 'tipo', 'cada', 'vez', 'dia', 'hoje', 'agora', 'entao', 'depois',
])
/** Tokens significativos de um comentário (sem acento, sem stopword, len>=3). */
export function tokenize(text: string): string[] {
  return semAcento((text ?? '').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
}

// ─── Agregações (puras) ───────────────────────────────────────────────────────

export interface AutorRank { handle: string; comentarios: number; likes: number }
export function topAutores(rows: ComentarioRow[], n = 15): AutorRank[] {
  const m = new Map<string, AutorRank>()
  for (const r of rows) {
    const h = r.author_handle?.trim()
    if (!h) continue
    const cur = m.get(h) ?? { handle: h, comentarios: 0, likes: 0 }
    cur.comentarios++; cur.likes += r.like_count ?? 0
    m.set(h, cur)
  }
  return [...m.values()].sort((a, b) => b.comentarios - a.comentarios || b.likes - a.likes).slice(0, n)
}

export interface PostRank { postId: string; titulo: string; permalink: string | null; thumb: string | null; platform: string; comentarios: number }
export function topPosts(rows: ComentarioRow[], n = 12): PostRank[] {
  const m = new Map<string, PostRank>()
  for (const r of rows) {
    const cur = m.get(r.post_id) ?? { postId: r.post_id, titulo: (r.post_title || '').slice(0, 80) || r.post_id, permalink: r.post_permalink, thumb: r.post_thumb, platform: r.platform, comentarios: 0 }
    cur.comentarios++
    m.set(r.post_id, cur)
  }
  return [...m.values()].sort((a, b) => b.comentarios - a.comentarios).slice(0, n)
}

export interface WordRank { palavra: string; freq: number }
/** Palavras que mais repetem — ignora stopwords e as palavras-gatilho confirmadas. */
export function wordFreq(rows: ComentarioRow[], confirmedTriggers: Set<string>, n = 30): WordRank[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    if (!r.text) continue
    if (confirmedTriggers.has(normalizeTrigger(r.text))) continue // comentário-gatilho não conta
    for (const w of tokenize(r.text)) m.set(w, (m.get(w) ?? 0) + 1)
  }
  return [...m.entries()].map(([palavra, freq]) => ({ palavra, freq }))
    .filter((x) => x.freq >= 2).sort((a, b) => b.freq - a.freq).slice(0, n)
}

export interface TriggerRank { palavra: string; comentarios: number; confirmado: boolean }
/** Gatilhos: comentários de 1 palavra normalizada que repetem. Confirmados primeiro. */
export function gatilhos(rows: ComentarioRow[], confirmed: Set<string>, minRep = 3): TriggerRank[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const norm = normalizeTrigger(r.text ?? '')
    if (norm.length < 2 || norm.length > 24) continue
    // "1 palavra": o texto original tem só um token alfanumérico
    const tokens = (r.text ?? '').trim().split(/\s+/).filter(Boolean)
    if (tokens.length > 1) continue
    m.set(norm, (m.get(norm) ?? 0) + 1)
  }
  return [...m.entries()]
    .map(([palavra, comentarios]) => ({ palavra, comentarios, confirmado: confirmed.has(palavra) }))
    .filter((x) => x.confirmado || x.comentarios >= minRep)
    .sort((a, b) => Number(b.confirmado) - Number(a.confirmado) || b.comentarios - a.comentarios)
}

export interface SentDia { date: string; positivo: number; negativo: number; neutro: number }
export function sentimentoNoTempo(rows: ComentarioRow[]): SentDia[] {
  const m = new Map<string, SentDia>()
  for (const r of rows) {
    if (!r.published_at || !r.sentiment) continue
    const d = r.published_at.slice(0, 10)
    const cur = m.get(d) ?? { date: d, positivo: 0, negativo: 0, neutro: 0 }
    cur[r.sentiment]++
    m.set(d, cur)
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
    .map((v) => ({ ...v, date: v.date.slice(5).split('-').reverse().join('/') }))
}

export const temTema = (r: ComentarioRow, ...t: string[]) => r.themes.some((x) => t.includes(x))
