/**
 * Instagram Hashtag Search (Graph API) + orçamento persistente.
 *
 * Permissão Meta: "Instagram Public Content Access". LIMITE DURO da plataforma:
 * 30 hashtags ÚNICAS por conta IG a cada 7 dias (janela móvel). Por isso a busca é
 * SOB DEMANDA (botão), NUNCA cron — e todo resolve de hashtag passa pelo orçamento
 * em `hashtag_query_budget` (migration 0037). hashtag_id já resolvido na janela é
 * reusado (não conta de novo). Só dados PÚBLICOS agregados; nada de autor.
 *
 * Token: page token por conta IG, de getInstagramOrganicConfig(workspaceId).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { InstagramApiError } from './instagram'

const GRAPH = 'https://graph.facebook.com/v20.0'
export const HASHTAG_BUDGET_LIMIT = 30
export const HASHTAG_BUDGET_WINDOW_DAYS = 7

const MEDIA_FIELDS = 'id,caption,media_type,media_url,permalink,like_count,comments_count,timestamp'

interface GraphError { error?: { message?: string; code?: number; error_subcode?: number } }

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params)
  const res = await fetch(`${GRAPH}/${path}?${qs}`, { cache: 'no-store' })
  const json = (await res.json().catch(() => ({}))) as T & GraphError
  if (!res.ok || json.error) {
    throw new InstagramApiError(json.error?.message ?? res.statusText, json.error?.code, json.error?.error_subcode)
  }
  return json
}

// ── normalização ────────────────────────────────────────────────────────────
function normalizeHashtag(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_]/g, '')
}
export function normalizeHashtags(list: string[]): string[] {
  return [...new Set(list.map(normalizeHashtag).filter(Boolean))]
}

// ── client da Graph (Hashtag Search) ─────────────────────────────────────────
export interface HashtagMedia {
  externalId: string
  mediaType: string | null
  caption: string | null
  mediaUrl: string | null
  permalink: string | null
  likeCount: number | null
  commentsCount: number | null
  takenAt: string | null
}

interface RawMedia {
  id: string
  caption?: string
  media_type?: string
  media_url?: string
  permalink?: string
  like_count?: number
  comments_count?: number
  timestamp?: string
}

function toMedia(rows: RawMedia[]): HashtagMedia[] {
  return rows.map((m) => ({
    externalId: m.id,
    mediaType: m.media_type ?? null,
    caption: m.caption ?? null,
    mediaUrl: m.media_url ?? null,
    permalink: m.permalink ?? null,
    likeCount: m.like_count ?? null,
    commentsCount: m.comments_count ?? null,
    takenAt: m.timestamp ?? null,
  }))
}

/** Resolve o id da hashtag (GET /ig_hashtag_search). null se não encontrada. */
export async function fetchHashtagId(token: string, igUserId: string, q: string): Promise<string | null> {
  const json = await graphGet<{ data?: { id: string }[] }>('ig_hashtag_search', {
    user_id: igUserId, q, access_token: token,
  })
  return json.data?.[0]?.id ?? null
}

export async function fetchHashtagTopMedia(token: string, igUserId: string, hashtagId: string): Promise<HashtagMedia[]> {
  const json = await graphGet<{ data?: RawMedia[] }>(`${hashtagId}/top_media`, {
    user_id: igUserId, fields: MEDIA_FIELDS, access_token: token,
  })
  return toMedia(json.data ?? [])
}

export async function fetchHashtagRecentMedia(token: string, igUserId: string, hashtagId: string): Promise<HashtagMedia[]> {
  const json = await graphGet<{ data?: RawMedia[] }>(`${hashtagId}/recent_media`, {
    user_id: igUserId, fields: MEDIA_FIELDS, access_token: token,
  })
  return toMedia(json.data ?? [])
}

// ── orçamento (30 hashtags únicas / 7 dias por conta IG) ─────────────────────
export interface SbHashtagQueryBudget {
  workspace_id: string
  ig_user_id: string
  hashtag: string
  hashtag_id: string | null
  queried_at: string
}

export interface BudgetUsage { used: number; limit: number; remaining: number; hashtags: string[] }

function windowStartIso(): string {
  return new Date(Date.now() - HASHTAG_BUDGET_WINDOW_DAYS * 86_400_000).toISOString()
}

/** Distintas dos últimos 7 dias para a conta. Lança se a tabela não existe (caller trata). */
export async function getHashtagBudget(db: SupabaseClient, workspaceId: string, igUserId: string): Promise<BudgetUsage> {
  const { data, error } = await db.from('hashtag_query_budget')
    .select('hashtag')
    .eq('workspace_id', workspaceId)
    .eq('ig_user_id', igUserId)
    .gte('queried_at', windowStartIso())
  if (error) throw new Error(error.message)
  const hashtags = [...new Set((data ?? []).map((r: { hashtag: string }) => r.hashtag))]
  return {
    used: hashtags.length,
    limit: HASHTAG_BUDGET_LIMIT,
    remaining: Math.max(0, HASHTAG_BUDGET_LIMIT - hashtags.length),
    hashtags,
  }
}

export interface ResolveResult { id: string | null; blocked: boolean; reused: boolean }

/**
 * Resolve o id de UMA hashtag respeitando o orçamento. Muta `usage` para acumular
 * o gasto dentro da MESMA request (ex: 3 hashtags novas com saldo 2 → a 3ª bloqueia).
 *  - já resolvida na janela → reusa o id (não gasta);
 *  - nova + saldo esgotado → blocked=true (não chama a API);
 *  - nova + tem saldo → resolve via API, grava no orçamento e debita.
 */
export async function resolveHashtagWithBudget(
  db: SupabaseClient, token: string, workspaceId: string, igUserId: string,
  hashtag: string, usage: BudgetUsage,
): Promise<ResolveResult> {
  const { data: existing } = await db.from('hashtag_query_budget')
    .select('hashtag_id')
    .eq('workspace_id', workspaceId)
    .eq('ig_user_id', igUserId)
    .eq('hashtag', hashtag)
    .gte('queried_at', windowStartIso())
    .order('queried_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const cachedId = (existing as { hashtag_id?: string | null } | null)?.hashtag_id
  if (cachedId) return { id: cachedId, blocked: false, reused: true }

  if (usage.used >= HASHTAG_BUDGET_LIMIT) return { id: null, blocked: true, reused: false }

  const id = await fetchHashtagId(token, igUserId, hashtag)
  if (id) {
    await db.from('hashtag_query_budget').insert({
      workspace_id: workspaceId, ig_user_id: igUserId, hashtag, hashtag_id: id,
    })
    usage.used += 1
    usage.remaining = Math.max(0, usage.remaining - 1)
    usage.hashtags.push(hashtag)
  }
  return { id, blocked: false, reused: false }
}

// ── persistência do agregado público (ranking por hashtag) ───────────────────
export interface SbHashtagMedia {
  workspace_id: string
  hashtag: string
  rank_kind: 'top' | 'recent'
  media_external_id: string
  media_type: string | null
  caption: string | null
  media_url: string | null
  permalink: string | null
  like_count: number | null
  comments_count: number | null
  taken_at: string | null
  fetched_at: string
}

export async function persistHashtagMedia(
  db: SupabaseClient, workspaceId: string, hashtag: string,
  kind: 'top' | 'recent', media: HashtagMedia[],
): Promise<void> {
  if (media.length === 0) return
  const now = new Date().toISOString()
  const rows = media.map((m) => ({
    workspace_id: workspaceId, hashtag, rank_kind: kind,
    media_external_id: m.externalId, media_type: m.mediaType, caption: m.caption,
    media_url: m.mediaUrl, permalink: m.permalink, like_count: m.likeCount,
    comments_count: m.commentsCount, taken_at: m.takenAt, fetched_at: now,
  }))
  await db.from('hashtag_media').upsert(rows, { onConflict: 'workspace_id,hashtag,rank_kind,media_external_id' })
}
