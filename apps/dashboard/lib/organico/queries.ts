/**
 * Fetchers das tabelas do ORGÂNICO (server-only) — RLS é deny-all, então tudo
 * via service-role + unstable_cache re-chaveado por workspaceId (isolamento
 * multi-tenant no cache, mesmo padrão de lib/supabase.ts) + React cache()
 * pra dedup dentro do mesmo render. Tag 'sb-organico' (revalidada pelos crons).
 */
import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

const REVALIDATE = 300

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export type OrganicPlatform = 'youtube' | 'instagram' | 'tiktok'

export interface OrganicAccount {
  id: string
  platform: OrganicPlatform
  external_id: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
  status: string
  last_sync_at: string | null
  last_error: string | null
  meta: {
    channel_stats?: { subscribers?: number | null; total_views?: number | null; videos?: number | null }
    subscriber_count_at_connect?: number | null
    [k: string]: unknown
  }
}

const _accountsCore = unstable_cache(
  async (workspaceId: string, platform: string) => {
    const { data } = await sb().from('organic_accounts')
      .select('id, platform, external_id, handle, display_name, avatar_url, status, last_sync_at, last_error, meta')
      .eq('workspace_id', workspaceId).eq('platform', platform).neq('status', 'disconnected')
      .order('connected_at')
    return (data ?? []) as OrganicAccount[]
  },
  ['organico-accounts-v1'],
  { tags: ['sb-organico'], revalidate: REVALIDATE },
)
export const fetchOrganicAccounts = cache(async (platform: OrganicPlatform): Promise<OrganicAccount[]> => {
  const ws = await getActiveWorkspaceId()
  return _accountsCore(ws, platform)
})

export interface OrganicProfileDay {
  account_id: string
  date: string
  followers: number | null
  subs_gained: number | null
  subs_lost: number | null
  views: number | null
  watch_time_s: number | null
  revenue: number | null
  cpm: number | null
  reach: number | null
  accounts_engaged: number | null
  views_followers: number | null
  views_non_followers: number | null
  follows: number | null
  unfollows: number | null
  link_taps: number | null
  profile_views: number | null
}

const PROFILE_COLS = 'account_id, date, followers, subs_gained, subs_lost, views, watch_time_s, revenue, cpm, reach, accounts_engaged, views_followers, views_non_followers, follows, unfollows, link_taps, profile_views'
// fallback até as migrations 0032/0033 rodarem (colunas novas ausentes → retry sem elas)
const PROFILE_COLS_LEGACY = PROFILE_COLS.replace(', watch_time_s', '').replace(', revenue, cpm', '')

const _profileDailyCore = unstable_cache(
  async (workspaceId: string, platform: string, days: number, accountExternalId?: string) => {
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
    let accQuery = sb().from('organic_accounts')
      .select('id').eq('workspace_id', workspaceId).eq('platform', platform)
    if (accountExternalId) accQuery = accQuery.eq('external_id', accountExternalId)
    const { data: accs } = await accQuery
    const ids = ((accs ?? []) as { id: string }[]).map((a) => a.id)
    if (ids.length === 0) return []
    const first = await sb().from('organic_profile_daily')
      .select(PROFILE_COLS)
      .eq('workspace_id', workspaceId).in('account_id', ids).gte('date', since)
      .order('date')
    let rows: unknown[] = (first.data ?? []) as unknown[]
    if (first.error) {
      const second = await sb().from('organic_profile_daily')
        .select(PROFILE_COLS_LEGACY)
        .eq('workspace_id', workspaceId).in('account_id', ids).gte('date', since)
        .order('date')
      rows = (second.data ?? []) as unknown[]
    }
    return rows.map((r) => ({
      watch_time_s: null, revenue: null, cpm: null, ...(r as Record<string, unknown>),
    })) as unknown as OrganicProfileDay[]
  },
  ['organico-profile-daily-v3'],
  { tags: ['sb-organico'], revalidate: REVALIDATE },
)
export const fetchOrganicProfileDaily = cache(async (platform: OrganicPlatform, days = 90, accountExternalId?: string): Promise<OrganicProfileDay[]> => {
  const ws = await getActiveWorkspaceId()
  return _profileDailyCore(ws, platform, days, accountExternalId)
})

export interface OrganicPost {
  id: string
  account_id: string
  external_id: string
  format: string | null
  title: string | null
  caption: string | null
  thumbnail_url: string | null
  permalink: string | null
  published_at: string
  duration_seconds: number | null
  views: number | null
  engaged_views: number | null
  reach: number | null
  likes: number | null
  comments_count: number | null
  shares: number | null
  saves: number | null
  apv: number | null
  avg_watch_time_s: number | null
  total_watch_time_s: number | null
  completion_rate: number | null
  skip_rate: number | null
  subs_gained: number | null
  subs_lost: number | null
  profile_visits: number | null
  impressions: number | null
  impressions_ctr: number | null
  revenue: number | null
  gancho_codigo: string | null
  estrutura: string | null
  tema: string | null
  composite_score: number | null
  outlier_score: number | null
  traffic_sources: Record<string, number> | null
  search_terms: Array<{ term: string; views: number }> | null
}

const POST_COLS = 'id, account_id, external_id, format, title, caption, thumbnail_url, permalink, published_at, duration_seconds, views, engaged_views, reach, likes, comments_count, shares, saves, apv, avg_watch_time_s, total_watch_time_s, completion_rate, skip_rate, subs_gained, subs_lost, profile_visits, impressions, impressions_ctr, revenue, gancho_codigo, estrutura, tema, composite_score, outlier_score, traffic_sources, search_terms'

const _postsCore = unstable_cache(
  async (workspaceId: string, platform: string, accountExternalId?: string) => {
    // Filtro por conta: resolve external_id → account_id(s) e restringe os posts.
    // external_id é único por (workspace, platform), mas filtramos por lista de
    // account_id pra ser robusto e manter o mesmo caminho de query.
    let accountIds: string[] | null = null
    if (accountExternalId) {
      const { data: accs } = await sb().from('organic_accounts')
        .select('id').eq('workspace_id', workspaceId).eq('platform', platform).eq('external_id', accountExternalId)
      accountIds = ((accs ?? []) as { id: string }[]).map((a) => a.id)
      if (accountIds.length === 0) return []
    }
    const run = (cols: string) => {
      let q = sb().from('organic_posts')
        .select(cols)
        .eq('workspace_id', workspaceId).eq('platform', platform)
      if (accountIds) q = q.in('account_id', accountIds)
      return q.order('published_at', { ascending: false }).limit(500)
    }
    const first = await run(POST_COLS)
    let rows: unknown[] = (first.data ?? []) as unknown[]
    if (first.error) {
      const second = await run(POST_COLS.replace(', revenue', ''))
      rows = (second.data ?? []) as unknown[]
    }
    return rows.map((r) => ({
      revenue: null, ...(r as Record<string, unknown>),
    })) as unknown as OrganicPost[]
  },
  ['organico-posts-v3'],
  { tags: ['sb-organico'], revalidate: REVALIDATE },
)
export const fetchOrganicPosts = cache(async (platform: OrganicPlatform, accountExternalId?: string): Promise<OrganicPost[]> => {
  const ws = await getActiveWorkspaceId()
  return _postsCore(ws, platform, accountExternalId)
})

export interface OrganicStory {
  id: string
  account_id: string
  external_id: string
  media_type: string | null
  thumbnail_url: string | null
  published_at: string
  expires_at: string | null
  views: number | null
  reach: number | null
  replies: number | null
  shares: number | null
  profile_visits: number | null
  follows: number | null
  taps_forward: number | null
  taps_back: number | null
  exits: number | null
  swipes_forward: number | null
  finalized: boolean
}

const _storiesCore = unstable_cache(
  async (workspaceId: string, days: number, accountExternalId?: string) => {
    const since = new Date(Date.now() - days * 86400_000).toISOString()
    // Stories são sempre Instagram; o filtro resolve external_id → account_id(s).
    let accountIds: string[] | null = null
    if (accountExternalId) {
      const { data: accs } = await sb().from('organic_accounts')
        .select('id').eq('workspace_id', workspaceId).eq('platform', 'instagram').eq('external_id', accountExternalId)
      accountIds = ((accs ?? []) as { id: string }[]).map((a) => a.id)
      if (accountIds.length === 0) return []
    }
    let q = sb().from('organic_stories')
      .select('id, account_id, external_id, media_type, thumbnail_url, published_at, expires_at, views, reach, replies, shares, profile_visits, follows, taps_forward, taps_back, exits, swipes_forward, finalized')
      .eq('workspace_id', workspaceId).gte('published_at', since)
    if (accountIds) q = q.in('account_id', accountIds)
    const { data } = await q.order('published_at', { ascending: false }).limit(200)
    return (data ?? []) as OrganicStory[]
  },
  ['organico-stories-v2'],
  { tags: ['sb-organico'], revalidate: REVALIDATE },
)
export const fetchOrganicStories = cache(async (days = 30, accountExternalId?: string): Promise<OrganicStory[]> => {
  const ws = await getActiveWorkspaceId()
  return _storiesCore(ws, days, accountExternalId)
})

export interface RetentionPoint { elapsed_ratio: number; audience_watch_ratio: number | null; relative_performance: number | null }

const _retentionCore = unstable_cache(
  async (workspaceId: string, postId: string) => {
    const { data } = await sb().from('organic_retention_points')
      .select('elapsed_ratio, audience_watch_ratio, relative_performance')
      .eq('workspace_id', workspaceId).eq('post_id', postId)
      .order('elapsed_ratio')
    return (data ?? []) as RetentionPoint[]
  },
  ['organico-retention-v1'],
  { tags: ['sb-organico'], revalidate: REVALIDATE },
)
export const fetchRetentionCurve = cache(async (postId: string): Promise<RetentionPoint[]> => {
  const ws = await getActiveWorkspaceId()
  return _retentionCore(ws, postId)
})

export interface InsightRow { id: string; severity: 'alta' | 'media' | 'info'; titulo: string; evidencia: string; recomendacao: string }

const _insightsCore = unstable_cache(
  async (workspaceId: string) => {
    const { data } = await sb().from('organic_insights_cache')
      .select('insights, computed_at').eq('workspace_id', workspaceId).maybeSingle()
    const row = data as { insights: InsightRow[]; computed_at: string } | null
    return { insights: row?.insights ?? [], computedAt: row?.computed_at ?? null }
  },
  ['organico-insights-cache-v1'],
  { tags: ['sb-organico'], revalidate: REVALIDATE },
)
export const fetchOrganicInsights = cache(async (): Promise<{ insights: InsightRow[]; computedAt: string | null }> => {
  const ws = await getActiveWorkspaceId()
  return _insightsCore(ws)
})

export interface CommentSummary {
  total: number
  porSentimento: Record<string, number>
  porTema: Record<string, number>
  perguntas: number
}
const _commentSummaryCore = unstable_cache(
  async (workspaceId: string) => {
    const { data } = await sb().from('organic_comments')
      .select('sentiment, themes, is_question').eq('workspace_id', workspaceId).not('analyzed_at', 'is', null)
      .limit(5000)
    const rows = (data ?? []) as Array<{ sentiment: string | null; themes: string[] | null; is_question: boolean | null }>
    const porSentimento: Record<string, number> = {}
    const porTema: Record<string, number> = {}
    let perguntas = 0
    for (const r of rows) {
      if (r.sentiment) porSentimento[r.sentiment] = (porSentimento[r.sentiment] ?? 0) + 1
      for (const t of r.themes ?? []) porTema[t] = (porTema[t] ?? 0) + 1
      if (r.is_question) perguntas++
    }
    return { total: rows.length, porSentimento, porTema, perguntas } as CommentSummary
  },
  ['organico-comment-summary-v1'],
  { tags: ['sb-organico'], revalidate: REVALIDATE },
)
export const fetchCommentSummary = cache(async (): Promise<CommentSummary> => {
  const ws = await getActiveWorkspaceId()
  return _commentSummaryCore(ws)
})
