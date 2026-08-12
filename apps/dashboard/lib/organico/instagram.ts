/**
 * Client Instagram orgânico — Graph API (flavor Facebook Login).
 *
 * Realidade da API (jun/2026, pós-deprecações v22) que este client codifica:
 *  - `views` é A métrica universal de consumo (impressions/plays/replays mortos).
 *  - Watch time SÓ em REELS (ig_reels_avg_watch_time em MILISSEGUNDOS).
 *  - profile_visits/follows por post NÃO existem em REELS (só feed/carousel/story).
 *  - STORIES: insights só com o story VIVO (24h); navigation exige breakdown;
 *    métricas com <5 views retornam erro code 10 → tratamos como NULL (gap
 *    honesto), nunca 0. Replies = 0 pra viewers EU/JP (não alertar).
 *  - Conta: follower_count só guarda 30 dias → warehouse diário nosso;
 *    breakdowns (follow_type) só com metric_type=total_value (agregado do range,
 *    não série) → buscamos dia-a-dia.
 *  - Rate limit BUC ~200 calls/h/conta → caller usa contador e aborta cedo.
 *
 * Tokens: PAGE access token derivado do user token long-lived (não expira
 * enquanto o user token for válido) — 1 por conta IG, cifrado por workspace.
 */

const GRAPH = 'https://graph.facebook.com/v20.0'

export class InstagramApiError extends Error {
  constructor(msg: string, public code?: number, public subcode?: number) { super(msg) }
}

interface GraphError { error?: { message?: string; code?: number; error_subcode?: number } }

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params)
  const res = await fetch(`${GRAPH}/${path}?${qs}`)
  const json = (await res.json().catch(() => ({}))) as T & GraphError
  if (!res.ok || json.error) {
    throw new InstagramApiError(
      json.error?.message ?? res.statusText,
      json.error?.code,
      json.error?.error_subcode,
    )
  }
  return json
}

// ── OAuth (Facebook Login → Pages → IG Business Accounts) ───────────────────

export async function exchangeCodeForUserToken(args: {
  appId: string; appSecret: string; code: string; redirectUri: string
}): Promise<string> {
  const json = await graphGet<{ access_token?: string }>('oauth/access_token', {
    client_id: args.appId,
    client_secret: args.appSecret,
    redirect_uri: args.redirectUri,
    code: args.code,
  })
  if (!json.access_token) throw new InstagramApiError('code exchange sem access_token')
  return json.access_token
}

export async function toLongLivedToken(args: {
  appId: string; appSecret: string; token: string
}): Promise<string> {
  const json = await graphGet<{ access_token?: string }>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: args.appId,
    client_secret: args.appSecret,
    fb_exchange_token: args.token,
  })
  return json.access_token ?? args.token
}

export interface IgAccount {
  igUserId: string
  username: string
  name: string | null
  avatarUrl: string | null
  followersCount: number | null
  pageId: string
  /** Page access token — usado em TODAS as chamadas da conta IG. */
  pageToken: string
}

/** Páginas do usuário que têm conta IG profissional vinculada. */
export async function listIgAccounts(userToken: string): Promise<IgAccount[]> {
  const json = await graphGet<{
    data?: Array<{
      id: string
      name?: string
      access_token?: string
      instagram_business_account?: {
        id: string; username?: string; name?: string
        profile_picture_url?: string; followers_count?: number
      }
    }>
  }>('me/accounts', {
    fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count}',
    limit: '50',
    access_token: userToken,
  })
  const out: IgAccount[] = []
  for (const page of json.data ?? []) {
    const ig = page.instagram_business_account
    if (!ig?.id || !page.access_token) continue
    out.push({
      igUserId: ig.id,
      username: ig.username ?? ig.id,
      name: ig.name ?? page.name ?? null,
      avatarUrl: ig.profile_picture_url ?? null,
      followersCount: ig.followers_count ?? null,
      pageId: page.id,
      pageToken: page.access_token,
    })
  }
  return out
}

// ── Media (posts/reels) ──────────────────────────────────────────────────────

export interface IgMedia {
  id: string
  caption: string | null
  mediaType: string          // IMAGE | VIDEO | CAROUSEL_ALBUM
  productType: string        // FEED | REELS | AD
  permalink: string | null
  thumbnailUrl: string | null
  timestamp: string
  likeCount: number | null
  commentsCount: number | null
}

export function igFormat(media: Pick<IgMedia, 'mediaType' | 'productType'>): 'reel' | 'feed' | 'carousel' {
  if (media.productType === 'REELS') return 'reel'
  if (media.mediaType === 'CAROUSEL_ALBUM') return 'carousel'
  return 'feed'
}

export async function fetchMediaList(
  pageToken: string, igUserId: string, maxPages = 4,
): Promise<IgMedia[]> {
  const out: IgMedia[] = []
  let after: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const json = await graphGet<{
      data?: Array<{
        id: string; caption?: string; media_type?: string; media_product_type?: string
        permalink?: string; thumbnail_url?: string; media_url?: string; timestamp?: string
        like_count?: number; comments_count?: number
      }>
      paging?: { cursors?: { after?: string }; next?: string }
    }>(`${igUserId}/media`, {
      fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
      limit: '50',
      access_token: pageToken,
      ...(after ? { after } : {}),
    })
    for (const m of json.data ?? []) {
      out.push({
        id: m.id,
        caption: m.caption ?? null,
        mediaType: m.media_type ?? 'IMAGE',
        productType: m.media_product_type ?? 'FEED',
        permalink: m.permalink ?? null,
        thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
        timestamp: m.timestamp ?? new Date().toISOString(),
        likeCount: m.like_count ?? null,
        commentsCount: m.comments_count ?? null,
      })
    }
    after = json.paging?.cursors?.after
    if (!json.paging?.next || !after) break
  }
  return out
}

/** Métricas por tipo (nomes válidos jun/2026). Fallback SAFE se alguma 400ar.
 *  NOTA: `follows` por media foi aposentado (retorna sempre vazio/erro e DERRUBAVA
 *  a chamada inteira → caía no SAFE e perdia profile_visits). Removido. profile_visits
 *  é buscado à parte (probe) p/ não arriscar as demais métricas (ex.: watch time do reel). */
const MEDIA_METRICS: Record<'reel' | 'feed' | 'carousel', string[]> = {
  reel: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'],
  feed: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'profile_visits'],
  carousel: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'profile_visits'],
}
const MEDIA_METRICS_SAFE = ['views', 'reach', 'likes', 'comments', 'shares', 'saved']

function parseInsights(json: { data?: Array<{ name?: string; values?: Array<{ value?: number }> }> }): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of json.data ?? []) {
    const v = m.values?.[0]?.value
    if (m.name && typeof v === 'number') out[m.name] = v
  }
  return out
}

/** Sonda UMA métrica isolada (não derruba as demais). null = indisponível p/ este media. */
async function probeMetric(pageToken: string, mediaId: string, metric: string): Promise<number | null> {
  try {
    const json = await graphGet<{ data?: Array<{ name?: string; values?: Array<{ value?: number }> }> }>(
      `${mediaId}/insights`, { metric, access_token: pageToken },
    )
    const v = json.data?.[0]?.values?.[0]?.value
    return typeof v === 'number' ? v : null
  } catch {
    return null
  }
}

/** Insights de UM media → mapa nome→valor. null = indisponível (não 0).
 *  profile_visits é buscado à parte: feed/carrossel costuma ter; em Reels o Meta
 *  pode não fornecer (a sonda confirma sem quebrar as outras métricas). */
export async function fetchMediaInsights(
  pageToken: string, mediaId: string, format: 'reel' | 'feed' | 'carousel',
): Promise<Record<string, number> | null> {
  let out: Record<string, number> | null = null
  try {
    out = parseInsights(await graphGet(`${mediaId}/insights`, { metric: MEDIA_METRICS[format].join(','), access_token: pageToken }))
  } catch (e) {
    const err = e as InstagramApiError
    if (err.code === 10) return null // <5 views → IG suprime
    try {
      out = parseInsights(await graphGet(`${mediaId}/insights`, { metric: MEDIA_METRICS_SAFE.join(','), access_token: pageToken }))
    } catch {
      return null
    }
  }
  // profile_visits: feed/carrossel SUPORTAM (vem na chamada principal). Em Reels o
  // Meta retorna erro #100 ("não suportado p/ este media product type") — CONFIRMADO
  // via API — então NÃO sondamos reel (evita queimar budget de rate limit à toa).
  // A probe só recupera feed/carrossel que caíram no fallback SAFE.
  if (out && format !== 'reel' && out.profile_visits === undefined) {
    const pv = await probeMetric(pageToken, mediaId, 'profile_visits')
    if (pv != null) out.profile_visits = pv
  }
  return out
}

// ── Conta (perfil diário + audiência) ────────────────────────────────────────

/** total_value de UMA métrica num dia específico (breakdown opcional). */
async function totalValueForDay(
  pageToken: string, igUserId: string, metric: string, day: string,
  breakdown?: string,
): Promise<{ total: number | null; breakdowns: Record<string, number> }> {
  const since = Math.floor(new Date(`${day}T00:00:00-03:00`).getTime() / 1000)
  const until = since + 86400
  try {
    const json = await graphGet<{
      data?: Array<{
        total_value?: {
          value?: number
          breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }>
        }
      }>
    }>(`${igUserId}/insights`, {
      metric, period: 'day', metric_type: 'total_value',
      since: String(since), until: String(until),
      access_token: pageToken,
      ...(breakdown ? { breakdown } : {}),
    })
    const tv = json.data?.[0]?.total_value
    const breakdowns: Record<string, number> = {}
    for (const r of tv?.breakdowns?.[0]?.results ?? []) {
      const key = (r.dimension_values ?? []).join('|')
      if (key && typeof r.value === 'number') breakdowns[key] = r.value
    }
    return { total: tv?.value ?? null, breakdowns }
  } catch {
    return { total: null, breakdowns: {} }
  }
}

export interface IgProfileDay {
  date: string
  followers: number | null
  views: number | null
  viewsFollowers: number | null
  viewsNonFollowers: number | null
  reach: number | null
  accountsEngaged: number | null
  follows: number | null
  unfollows: number | null
  linkTaps: number | null
}

/** Métricas de conta de UM dia (várias chamadas — caller controla o budget). */
export async function fetchProfileDay(
  pageToken: string, igUserId: string, day: string,
): Promise<IgProfileDay> {
  // follower_count é série diária comum (sem total_value)
  let followers: number | null = null
  try {
    const since = Math.floor(new Date(`${day}T00:00:00-03:00`).getTime() / 1000)
    const json = await graphGet<{ data?: Array<{ values?: Array<{ value?: number; end_time?: string }> }> }>(
      `${igUserId}/insights`,
      { metric: 'follower_count', period: 'day', since: String(since), until: String(since + 86400), access_token: pageToken },
    )
    followers = json.data?.[0]?.values?.[0]?.value ?? null
  } catch { /* conta <100 seguidores ou sem dado */ }

  const [views, reach, engaged, followsSplit, linkTaps] = await Promise.all([
    totalValueForDay(pageToken, igUserId, 'views', day, 'follow_type'),
    totalValueForDay(pageToken, igUserId, 'reach', day),
    totalValueForDay(pageToken, igUserId, 'accounts_engaged', day),
    totalValueForDay(pageToken, igUserId, 'follows_and_unfollows', day, 'follow_type'),
    totalValueForDay(pageToken, igUserId, 'profile_links_taps', day),
  ])

  return {
    date: day,
    followers,
    views: views.total,
    viewsFollowers: views.breakdowns['FOLLOWER'] ?? null,
    viewsNonFollowers: views.breakdowns['NON_FOLLOWER'] ?? null,
    reach: reach.total,
    accountsEngaged: engaged.total,
    follows: followsSplit.breakdowns['FOLLOWER'] ?? followsSplit.total,
    unfollows: followsSplit.breakdowns['NON_FOLLOWER'] ?? null,
    linkTaps: linkTaps.total,
  }
}

/** Demografia (snapshot; top 45 segmentos; exige ≥100 seguidores). */
export async function fetchDemographics(
  pageToken: string, igUserId: string,
  kind: 'follower_demographics' | 'engaged_audience_demographics' | 'reached_audience_demographics',
  breakdown: 'age' | 'gender' | 'city' | 'country',
): Promise<Record<string, number>> {
  try {
    const json = await graphGet<{
      data?: Array<{
        total_value?: { breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }> }
      }>
    }>(`${igUserId}/insights`, {
      metric: kind, period: 'lifetime', metric_type: 'total_value',
      timeframe: 'last_30_days', breakdown,
      access_token: pageToken,
    })
    const out: Record<string, number> = {}
    for (const r of json.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []) {
      const key = (r.dimension_values ?? []).join('|')
      if (key && typeof r.value === 'number') out[key] = r.value
    }
    return out
  } catch {
    return {}
  }
}

/** Horários em que os seguidores estão online (snapshot, últimos 30d). */
export async function fetchOnlineFollowers(
  pageToken: string, igUserId: string,
): Promise<Record<string, number>> {
  try {
    const json = await graphGet<{ data?: Array<{ values?: Array<{ value?: Record<string, number> }> }> }>(
      `${igUserId}/insights`,
      { metric: 'online_followers', period: 'lifetime', access_token: pageToken },
    )
    return json.data?.[0]?.values?.[0]?.value ?? {}
  } catch {
    return {}
  }
}

// ── Comentários ──────────────────────────────────────────────────────────────

export interface IgComment {
  externalId: string
  author: string | null
  text: string
  likeCount: number | null
  publishedAt: string | null
}

export async function fetchComments(
  pageToken: string, mediaId: string, maxPages = 2,
): Promise<IgComment[]> {
  const out: IgComment[] = []
  let after: string | undefined
  for (let page = 0; page < maxPages; page++) {
    let json: {
      data?: Array<{ id: string; text?: string; username?: string; like_count?: number; timestamp?: string }>
      paging?: { cursors?: { after?: string }; next?: string }
    }
    try {
      json = await graphGet(`${mediaId}/comments`, {
        fields: 'id,text,username,like_count,timestamp',
        limit: '50', access_token: pageToken, ...(after ? { after } : {}),
      })
    } catch {
      break // comentários restritos/indisponíveis → sem comentários
    }
    for (const c of json.data ?? []) {
      out.push({
        externalId: c.id, author: c.username ?? null, text: c.text ?? '',
        likeCount: c.like_count ?? null, publishedAt: c.timestamp ?? null,
      })
    }
    after = json.paging?.cursors?.after
    if (!json.paging?.next || !after) break
  }
  return out
}

// ── Stories ──────────────────────────────────────────────────────────────────

export interface IgStory {
  id: string
  mediaType: string
  thumbnailUrl: string | null
  permalink: string | null
  timestamp: string
}

/** Stories VIVOS agora (a lista só contém os ainda não expirados). */
export async function fetchLiveStories(pageToken: string, igUserId: string): Promise<IgStory[]> {
  const json = await graphGet<{
    data?: Array<{ id: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string }>
  }>(`${igUserId}/stories`, {
    fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp',
    limit: '50',
    access_token: pageToken,
  })
  return (json.data ?? []).map((s) => ({
    id: s.id,
    mediaType: s.media_type ?? 'IMAGE',
    thumbnailUrl: s.thumbnail_url ?? s.media_url ?? null,
    permalink: s.permalink ?? null,
    timestamp: s.timestamp ?? new Date().toISOString(),
  }))
}

export interface IgStoryInsights {
  views: number | null
  reach: number | null
  replies: number | null
  shares: number | null
  profileVisits: number | null
  follows: number | null
  tapsForward: number | null
  tapsBack: number | null
  exits: number | null
  swipesForward: number | null
}

/** Insights de UM story vivo. <5 views (code 10) → tudo NULL (não zero). */
export async function fetchStoryInsights(
  pageToken: string, storyId: string,
): Promise<IgStoryInsights | null> {
  const base: IgStoryInsights = {
    views: null, reach: null, replies: null, shares: null, profileVisits: null,
    follows: null, tapsForward: null, tapsBack: null, exits: null, swipesForward: null,
  }
  try {
    const json = await graphGet<{ data?: Array<{ name?: string; values?: Array<{ value?: number }> }> }>(
      `${storyId}/insights`,
      { metric: 'views,reach,replies,shares,profile_visits,follows', access_token: pageToken },
    )
    for (const m of json.data ?? []) {
      const v = m.values?.[0]?.value
      if (typeof v !== 'number') continue
      if (m.name === 'views') base.views = v
      if (m.name === 'reach') base.reach = v
      if (m.name === 'replies') base.replies = v
      if (m.name === 'shares') base.shares = v
      if (m.name === 'profile_visits') base.profileVisits = v
      if (m.name === 'follows') base.follows = v
    }
  } catch (e) {
    if ((e as InstagramApiError).code === 10) return null
    // segue pra navigation mesmo assim — pode ter dado parcial
  }
  try {
    const json = await graphGet<{
      data?: Array<{
        name?: string
        total_value?: { breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }> }
      }>
    }>(`${storyId}/insights`, {
      metric: 'navigation', breakdown: 'story_navigation_action_type',
      metric_type: 'total_value', access_token: pageToken,
    })
    for (const r of json.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []) {
      const key = (r.dimension_values ?? []).join('')
      const v = r.value
      if (typeof v !== 'number') continue
      if (key === 'tap_forward') base.tapsForward = v
      if (key === 'tap_back') base.tapsBack = v
      if (key === 'tap_exit') base.exits = v
      if (key === 'swipe_forward') base.swipesForward = v
    }
  } catch { /* navigation indisponível — segue com o que tem */ }
  return base
}
