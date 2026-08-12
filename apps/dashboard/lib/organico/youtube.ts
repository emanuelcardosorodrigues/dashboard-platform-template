/**
 * Client YouTube (orgânico) — Data API v3 + Analytics API v2 + Reporting API v1.
 *
 * Três APIs porque cada uma tem dado exclusivo:
 *  - Data API: inventário de vídeos (uploads playlist → videos.list) e metadados.
 *    Quota 10k units/dia; cada list = 1 unit/página. `search.list` é PROIBIDO
 *    (bucket próprio de 100/dia e custo inútil — uploads playlist cobre tudo).
 *  - Analytics API: métricas por vídeo (AVD/APV/subs±/shares...), curva de
 *    retenção (audienceWatchRatio — 1 vídeo por query), fontes de tráfego,
 *    termos de busca, demografia. Dados com lag oficial de 48-72h.
 *  - Reporting API: IMPRESSÕES + CTR de thumbnail (channel_reach_basic_a1,
 *    jan/2026) — não existem na Analytics API. Jobs bulk criados na conexão
 *    (backfill ~30d só na criação) e CSVs baixados pelo cron.
 *
 * Auth: OAuth do dono do canal (refresh token por-workspace via factory;
 * client id/secret do app no env). Access token ~1h → renovado por run.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DATA_API = 'https://www.googleapis.com/youtube/v3'
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports'
const REPORTING_API = 'https://youtubereporting.googleapis.com/v1'

/** Report types bulk que queremos (impressões/CTR por vídeo). */
export const REPORTING_TYPES = ['channel_reach_basic_a1'] as const

export class YoutubeApiError extends Error {
  constructor(msg: string, public status?: number) { super(msg) }
}

async function jsonOrThrow<T>(res: Response, ctx: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) {
    throw new YoutubeApiError(`${ctx}: ${body?.error?.message ?? res.statusText}`, res.status)
  }
  return body
}

// ── OAuth ────────────────────────────────────────────────────────────────────

export async function refreshAccessToken(cfg: {
  clientId: string; clientSecret: string; refreshToken: string
}): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const json = await jsonOrThrow<{ access_token?: string }>(res, 'youtube token refresh')
  if (!json.access_token) throw new YoutubeApiError('token refresh sem access_token')
  return json.access_token
}

export async function exchangeCodeForTokens(args: {
  clientId: string; clientSecret: string; code: string; redirectUri: string
}): Promise<{ accessToken: string; refreshToken: string | null }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      grant_type: 'authorization_code',
      redirect_uri: args.redirectUri,
    }),
  })
  const json = await jsonOrThrow<{ access_token?: string; refresh_token?: string }>(res, 'youtube code exchange')
  if (!json.access_token) throw new YoutubeApiError('code exchange sem access_token')
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? null }
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

// ── Data API ─────────────────────────────────────────────────────────────────

export interface YtChannel {
  id: string
  title: string
  thumbnailUrl: string | null
  uploadsPlaylistId: string | null
  subscriberCount: number | null
  videoCount: number | null
  /** Views totais do canal (lifetime, público). */
  viewCount: number | null
}

export async function fetchMyChannel(accessToken: string): Promise<YtChannel | null> {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails,statistics', mine: 'true',
  })
  const res = await fetch(`${DATA_API}/channels?${params}`, { headers: authHeaders(accessToken) })
  const json = await jsonOrThrow<{
    items?: Array<{
      id: string
      snippet?: { title?: string; thumbnails?: { default?: { url?: string } } }
      contentDetails?: { relatedPlaylists?: { uploads?: string } }
      statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string }
    }>
  }>(res, 'channels.list')
  const ch = json.items?.[0]
  if (!ch) return null
  return {
    id: ch.id,
    title: ch.snippet?.title ?? '',
    thumbnailUrl: ch.snippet?.thumbnails?.default?.url ?? null,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads ?? null,
    subscriberCount: ch.statistics?.subscriberCount != null ? Number(ch.statistics.subscriberCount) : null,
    videoCount: ch.statistics?.videoCount != null ? Number(ch.statistics.videoCount) : null,
    viewCount: ch.statistics?.viewCount != null ? Number(ch.statistics.viewCount) : null,
  }
}

/** IDs de TODOS os uploads do canal (1 unit/página de 50). maxPages como guarda. */
export async function fetchUploadsVideoIds(
  accessToken: string, uploadsPlaylistId: string, maxPages = 40,
): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    })
    const res = await fetch(`${DATA_API}/playlistItems?${params}`, { headers: authHeaders(accessToken) })
    const json = await jsonOrThrow<{
      items?: Array<{ contentDetails?: { videoId?: string } }>
      nextPageToken?: string
    }>(res, 'playlistItems.list')
    for (const it of json.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId)
    pageToken = json.nextPageToken
    if (!pageToken) break
  }
  return ids
}

export interface YtVideoMeta {
  id: string
  title: string
  description: string
  publishedAt: string
  thumbnailUrl: string | null
  durationSeconds: number | null
  tags: string[]
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
}

/** Duração ISO8601 (PT1H2M3S) → segundos. null se não parsear. */
export function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  if (!m) return null
  return (Number(m[1] ?? 0)) * 3600 + (Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)
}

/** Shorts hoje vão até 3 min — heurística determinística por duração.
 *  (Refinada depois com creatorContentType da Analytics quando disponível.) */
export function formatFromDuration(durationSeconds: number | null): 'short' | 'long' {
  return durationSeconds != null && durationSeconds <= 183 ? 'short' : 'long'
}

export async function fetchVideosMeta(accessToken: string, ids: string[]): Promise<YtVideoMeta[]> {
  const out: YtVideoMeta[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    const params = new URLSearchParams({
      part: 'snippet,contentDetails,statistics', id: batch.join(','), maxResults: '50',
    })
    const res = await fetch(`${DATA_API}/videos?${params}`, { headers: authHeaders(accessToken) })
    const json = await jsonOrThrow<{
      items?: Array<{
        id: string
        snippet?: { title?: string; description?: string; publishedAt?: string; tags?: string[]; thumbnails?: { medium?: { url?: string }; high?: { url?: string } } }
        contentDetails?: { duration?: string }
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
      }>
    }>(res, 'videos.list')
    for (const v of json.items ?? []) {
      out.push({
        id: v.id,
        title: v.snippet?.title ?? '',
        description: v.snippet?.description ?? '',
        publishedAt: v.snippet?.publishedAt ?? new Date().toISOString(),
        thumbnailUrl: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url ?? null,
        durationSeconds: parseIsoDuration(v.contentDetails?.duration),
        tags: v.snippet?.tags ?? [],
        viewCount: v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null,
        likeCount: v.statistics?.likeCount != null ? Number(v.statistics.likeCount) : null,
        commentCount: v.statistics?.commentCount != null ? Number(v.statistics.commentCount) : null,
      })
    }
  }
  return out
}

// ── Analytics API ────────────────────────────────────────────────────────────

interface AnalyticsResponse {
  columnHeaders?: Array<{ name: string }>
  rows?: Array<Array<string | number>>
}

/** Query genérica — devolve linhas como objetos { header: valor }. */
export async function queryAnalytics(
  accessToken: string,
  params: Record<string, string>,
): Promise<Array<Record<string, string | number>>> {
  const qs = new URLSearchParams({ ids: 'channel==MINE', ...params })
  const res = await fetch(`${ANALYTICS_API}?${qs}`, { headers: authHeaders(accessToken) })
  const json = await jsonOrThrow<AnalyticsResponse>(res, 'analytics.query')
  const headers = (json.columnHeaders ?? []).map((h) => h.name)
  return (json.rows ?? []).map((row) => Object.fromEntries(row.map((v, i) => [headers[i], v])))
}

export interface YtVideoRangeMetrics {
  videoId: string
  views: number
  engagedViews: number | null
  estimatedMinutesWatched: number
  averageViewDuration: number
  averageViewPercentage: number
  likes: number
  comments: number
  shares: number
  subscribersGained: number
  subscribersLost: number
}

/** Métricas agregadas do range por vídeo, em lotes (dimensions=video). */
export async function fetchVideoRangeMetrics(
  accessToken: string, videoIds: string[], startDate: string, endDate: string,
): Promise<YtVideoRangeMetrics[]> {
  const out: YtVideoRangeMetrics[] = []
  const metricsWithEngaged = 'views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost'
  const metricsFallback = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost'
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    let rows: Array<Record<string, string | number>>
    try {
      rows = await queryAnalytics(accessToken, {
        dimensions: 'video',
        metrics: metricsWithEngaged,
        startDate, endDate,
        filters: `video==${batch.join(',')}`,
        maxResults: '200',
      })
    } catch {
      // engagedViews pode não estar habilitado em canais antigos — degrade honesto
      rows = await queryAnalytics(accessToken, {
        dimensions: 'video',
        metrics: metricsFallback,
        startDate, endDate,
        filters: `video==${batch.join(',')}`,
        maxResults: '200',
      })
    }
    for (const r of rows) {
      out.push({
        videoId: String(r.video ?? ''),
        views: Number(r.views ?? 0),
        engagedViews: r.engagedViews != null ? Number(r.engagedViews) : null,
        estimatedMinutesWatched: Number(r.estimatedMinutesWatched ?? 0),
        averageViewDuration: Number(r.averageViewDuration ?? 0),
        averageViewPercentage: Number(r.averageViewPercentage ?? 0),
        likes: Number(r.likes ?? 0),
        comments: Number(r.comments ?? 0),
        shares: Number(r.shares ?? 0),
        subscribersGained: Number(r.subscribersGained ?? 0),
        subscribersLost: Number(r.subscribersLost ?? 0),
      })
    }
  }
  return out
}

/** Série diária de UM vídeo (dimensions=day). */
export async function fetchVideoDaily(
  accessToken: string, videoId: string, startDate: string, endDate: string,
): Promise<Array<{ date: string; views: number; engagedViews: number | null; watchTimeMin: number; likes: number; comments: number; shares: number; subscribersGained: number; subscribersLost: number }>> {
  let rows: Array<Record<string, string | number>>
  try {
    rows = await queryAnalytics(accessToken, {
      dimensions: 'day',
      metrics: 'views,engagedViews,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost',
      startDate, endDate, filters: `video==${videoId}`,
    })
  } catch {
    rows = await queryAnalytics(accessToken, {
      dimensions: 'day',
      metrics: 'views,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost',
      startDate, endDate, filters: `video==${videoId}`,
    })
  }
  return rows.map((r) => ({
    date: String(r.day ?? ''),
    views: Number(r.views ?? 0),
    engagedViews: r.engagedViews != null ? Number(r.engagedViews) : null,
    watchTimeMin: Number(r.estimatedMinutesWatched ?? 0),
    likes: Number(r.likes ?? 0),
    comments: Number(r.comments ?? 0),
    shares: Number(r.shares ?? 0),
    subscribersGained: Number(r.subscribersGained ?? 0),
    subscribersLost: Number(r.subscribersLost ?? 0),
  }))
}

/** Curva de retenção de UM vídeo (única API do mercado que expõe isso). */
export async function fetchRetention(
  accessToken: string, videoId: string,
): Promise<Array<{ elapsedRatio: number; audienceWatchRatio: number; relativePerformance: number | null }>> {
  let rows: Array<Record<string, string | number>>
  try {
    rows = await queryAnalytics(accessToken, {
      dimensions: 'elapsedVideoTimeRatio',
      metrics: 'audienceWatchRatio,relativeRetentionPerformance',
      filters: `video==${videoId};audienceType==ORGANIC`,
      // retenção exige range: lifetime aproximado
      startDate: '2015-01-01', endDate: new Date().toISOString().slice(0, 10),
    })
  } catch {
    rows = await queryAnalytics(accessToken, {
      dimensions: 'elapsedVideoTimeRatio',
      metrics: 'audienceWatchRatio',
      filters: `video==${videoId};audienceType==ORGANIC`,
      startDate: '2015-01-01', endDate: new Date().toISOString().slice(0, 10),
    })
  }
  return rows.map((r) => ({
    elapsedRatio: Number(r.elapsedVideoTimeRatio ?? 0),
    audienceWatchRatio: Number(r.audienceWatchRatio ?? 0),
    relativePerformance: r.relativeRetentionPerformance != null ? Number(r.relativeRetentionPerformance) : null,
  }))
}

/** Fontes de tráfego de UM vídeo (enums da API ≠ nomes do Studio:
 *  SUBSCRIBER=Browse, RELATED_VIDEO=Suggested, YT_SEARCH=Busca). */
export async function fetchTrafficSources(
  accessToken: string, videoId: string, startDate: string, endDate: string,
): Promise<Record<string, number>> {
  const rows = await queryAnalytics(accessToken, {
    dimensions: 'insightTrafficSourceType',
    metrics: 'views',
    startDate, endDate, filters: `video==${videoId}`,
  })
  const out: Record<string, number> = {}
  for (const r of rows) out[String(r.insightTrafficSourceType ?? '?')] = Number(r.views ?? 0)
  return out
}

/** Termos de busca que trouxeram views pra UM vídeo (top 10). */
export async function fetchSearchTerms(
  accessToken: string, videoId: string, startDate: string, endDate: string,
): Promise<Array<{ term: string; views: number }>> {
  try {
    const rows = await queryAnalytics(accessToken, {
      dimensions: 'insightTrafficSourceDetail',
      metrics: 'views',
      startDate, endDate,
      filters: `video==${videoId};insightTrafficSourceType==YT_SEARCH`,
      sort: '-views', maxResults: '10',
    })
    return rows.map((r) => ({ term: String(r.insightTrafficSourceDetail ?? ''), views: Number(r.views ?? 0) }))
  } catch {
    return [] // detail report indisponível p/ vídeos com pouco volume
  }
}

/** Views por status de inscrição (proxy de seguidor × não-seguidor). */
export async function fetchSubscribedStatus(
  accessToken: string, videoId: string, startDate: string, endDate: string,
): Promise<Record<string, number>> {
  const rows = await queryAnalytics(accessToken, {
    dimensions: 'subscribedStatus',
    metrics: 'views',
    startDate, endDate, filters: `video==${videoId}`,
  })
  const out: Record<string, number> = {}
  for (const r of rows) out[String(r.subscribedStatus ?? '?')] = Number(r.views ?? 0)
  return out
}

/** Série diária do CANAL (subs ±, views, watch time) → organic_profile_daily. */
export async function fetchChannelDaily(
  accessToken: string, startDate: string, endDate: string,
): Promise<Array<{ date: string; views: number; watchTimeMin: number; subscribersGained: number; subscribersLost: number }>> {
  const rows = await queryAnalytics(accessToken, {
    dimensions: 'day',
    metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost',
    startDate, endDate,
  })
  return rows.map((r) => ({
    date: String(r.day ?? ''),
    views: Number(r.views ?? 0),
    watchTimeMin: Number(r.estimatedMinutesWatched ?? 0),
    subscribersGained: Number(r.subscribersGained ?? 0),
    subscribersLost: Number(r.subscribersLost ?? 0),
  }))
}

/** Demografia (viewerPercentage por idade×gênero) — snapshot. */
export async function fetchDemographics(
  accessToken: string, startDate: string, endDate: string,
): Promise<Array<{ ageGroup: string; gender: string; viewerPercentage: number }>> {
  const rows = await queryAnalytics(accessToken, {
    dimensions: 'ageGroup,gender',
    metrics: 'viewerPercentage',
    startDate, endDate,
  })
  return rows.map((r) => ({
    ageGroup: String(r.ageGroup ?? ''),
    gender: String(r.gender ?? ''),
    viewerPercentage: Number(r.viewerPercentage ?? 0),
  }))
}

/** Views por tipo de device — snapshot. */
export async function fetchDeviceTypes(
  accessToken: string, startDate: string, endDate: string,
): Promise<Record<string, number>> {
  const rows = await queryAnalytics(accessToken, {
    dimensions: 'deviceType', metrics: 'views', startDate, endDate,
  })
  const out: Record<string, number> = {}
  for (const r of rows) out[String(r.deviceType ?? '?')] = Number(r.views ?? 0)
  return out
}

// ── Comentários (Data API, 1 unit/página de 100) ────────────────────────────

export interface OrganicComment {
  externalId: string
  author: string | null
  text: string
  likeCount: number | null
  replyCount: number | null
  publishedAt: string | null
}

export async function fetchCommentThreads(
  accessToken: string, videoId: string, maxPages = 2,
): Promise<OrganicComment[]> {
  const out: OrganicComment[] = []
  let pageToken: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      part: 'snippet', videoId, maxResults: '100', order: 'relevance', textFormat: 'plainText',
      ...(pageToken ? { pageToken } : {}),
    })
    let json: {
      items?: Array<{ snippet?: { totalReplyCount?: number; topLevelComment?: { id?: string; snippet?: { textOriginal?: string; authorDisplayName?: string; likeCount?: number; publishedAt?: string } } } }>
      nextPageToken?: string
    }
    try {
      const res = await fetch(`${DATA_API}/commentThreads?${params}`, { headers: authHeaders(accessToken) })
      json = await jsonOrThrow(res, 'commentThreads.list')
    } catch (e) {
      // comentários desativados no vídeo (403) → simplesmente sem comentários
      if ((e as YoutubeApiError).status === 403) break
      throw e
    }
    for (const it of json.items ?? []) {
      const c = it.snippet?.topLevelComment
      if (!c?.id || !c.snippet) continue
      out.push({
        externalId: c.id,
        author: c.snippet.authorDisplayName ?? null,
        text: c.snippet.textOriginal ?? '',
        likeCount: c.snippet.likeCount ?? null,
        replyCount: it.snippet?.totalReplyCount ?? null,
        publishedAt: c.snippet.publishedAt ?? null,
      })
    }
    pageToken = json.nextPageToken
    if (!pageToken) break
  }
  return out
}

// ── Extração COMPLETA de comentários (Extrair Comentários) ──────────────────
// Funções separadas de fetchCommentThreads de propósito: aquela é usada pelo
// cron sync-organic-comments (200 comments, order=relevance, sem replies) e
// NÃO pode mudar. Estas paginam TUDO (order=time = paginação estável pra
// retomada por cursor) e buscam replies além das ~5 inline que a API embute.

/** Extrai o videoId (11 chars) de watch?v=, youtu.be/, shorts/, live/, embed/.
 *  Texto solto de 11 chars NÃO é aceito (falso-positivo fácil) — só URLs. */
export function extractYoutubeVideoId(raw: string): string | null {
  const s = raw.trim()
  const m =
    s.match(/youtube\.com\/watch\?(?:[^\s#]*?[?&])?v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/) ??
    s.match(/youtube\.com\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/) ??
    s.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/)
  return m ? m[1] : null
}

/** Auth da extração: API key (dados públicos, SEM exigência de escopo) ou
 *  OAuth. GOTCHA da API do YouTube: commentThreads.list/comments.list exigem o
 *  escopo youtube.force-ssl mesmo pra dados públicos — a conexão OAuth do
 *  dashboard (readonly+analytics) NÃO o tem → "insufficient authentication
 *  scopes". Com API key não há escopo envolvido. */
export type YtAuth = { accessToken: string } | { apiKey: string }

function authParts(auth: YtAuth): { headers: Record<string, string>; keyParam: Record<string, string> } {
  return 'apiKey' in auth
    ? { headers: {}, keyParam: { key: auth.apiKey } }
    : { headers: authHeaders(auth.accessToken), keyParam: {} }
}

export interface YtCommentRow {
  externalId: string
  /** null = comentário raiz; senão, id do comentário pai. */
  parentExternalId: string | null
  author: string | null
  authorChannelUrl: string | null
  text: string
  likeCount: number | null
  /** Total de respostas — só em raiz (replies têm null). */
  replyCount: number | null
  publishedAt: string | null
}

export interface ThreadsChunkResult {
  /** Raízes + replies inline (subconjunto que a API embute em part=replies). */
  comments: YtCommentRow[]
  /** Raízes com totalReplyCount > replies inline recebidas → buscar via fetchAllReplies. */
  incompleteThreadIds: string[]
  /** null = acabaram as páginas. Se quotaExceeded=true, é o token da página que FALHOU (retomada). */
  nextPageToken: string | null
  /** Páginas buscadas com sucesso (≈ units de quota gastas). */
  pagesFetched: number
  commentsDisabled: boolean
  quotaExceeded: boolean
}

interface RawCommentSnippet {
  textOriginal?: string
  authorDisplayName?: string
  authorChannelUrl?: string | null
  likeCount?: number
  publishedAt?: string
  parentId?: string
}

/** Classifica a resposta da API de comentários: ok | commentsDisabled | quotaExceeded.
 *  Não reusa jsonOrThrow (caminho do cron): precisamos do `reason` do erro,
 *  que distingue os dois 403 possíveis. Outros erros → throw. */
async function classifyCommentsResponse<T>(
  res: Response, ctx: string,
): Promise<{ ok: true; json: T } | { ok: false; reason: 'commentsDisabled' | 'quotaExceeded' }> {
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; errors?: Array<{ reason?: string }> }
  }
  if (res.ok) return { ok: true, json: body }
  const reason = body?.error?.errors?.[0]?.reason
  if (res.status === 403 && reason === 'commentsDisabled') return { ok: false, reason: 'commentsDisabled' }
  if (res.status === 403 && (reason === 'quotaExceeded' || reason === 'rateLimitExceeded')) {
    return { ok: false, reason: 'quotaExceeded' }
  }
  // Token OAuth sem youtube.force-ssl (conexão analytics) → erro acionável
  if (res.status === 403 && reason === 'insufficientPermissions') {
    throw new YoutubeApiError(
      `${ctx}: a conexão do YouTube não tem permissão pra ler comentários — configure YOUTUBE_API_KEY na Vercel (recomendado) ou reconecte o canal com o escopo novo`,
      403,
    )
  }
  throw new YoutubeApiError(`${ctx}: ${body?.error?.message ?? res.statusText}`, res.status)
}

function mapCommentRow(id: string, s: RawCommentSnippet, parentId: string | null, replyCount: number | null): YtCommentRow {
  return {
    externalId: id,
    parentExternalId: parentId,
    author: s.authorDisplayName ?? null,
    authorChannelUrl: s.authorChannelUrl ?? null,
    text: s.textOriginal ?? '',
    likeCount: s.likeCount ?? null,
    replyCount,
    publishedAt: s.publishedAt ?? null,
  }
}

/** Pagina commentThreads.list (part=snippet,replies · order=time · 100/pág).
 *  Um "chunk" = até maxPages páginas — o caller persiste o cursor entre chunks. */
export async function fetchCommentThreadsChunk(
  auth: YtAuth, videoId: string,
  opts: { pageToken?: string; maxPages?: number },
): Promise<ThreadsChunkResult> {
  const { headers, keyParam } = authParts(auth)
  const maxPages = opts.maxPages ?? 15
  const comments: YtCommentRow[] = []
  const incompleteThreadIds: string[] = []
  let current: string | undefined = opts.pageToken
  let pagesFetched = 0

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      part: 'snippet,replies', videoId, maxResults: '100', order: 'time', textFormat: 'plainText',
      ...keyParam,
      ...(current ? { pageToken: current } : {}),
    })
    const res = await fetch(`${DATA_API}/commentThreads?${params}`, { headers })
    const parsed = await classifyCommentsResponse<{
      items?: Array<{
        id?: string
        snippet?: { totalReplyCount?: number; topLevelComment?: { id?: string; snippet?: RawCommentSnippet } }
        replies?: { comments?: Array<{ id?: string; snippet?: RawCommentSnippet }> }
      }>
      nextPageToken?: string
    }>(res, 'commentThreads.list(extracao)')

    if (!parsed.ok) {
      return {
        comments, incompleteThreadIds, pagesFetched,
        nextPageToken: current ?? null, // token da página que falhou = ponto de retomada
        commentsDisabled: parsed.reason === 'commentsDisabled',
        quotaExceeded: parsed.reason === 'quotaExceeded',
      }
    }
    pagesFetched++

    for (const it of parsed.json.items ?? []) {
      const root = it.snippet?.topLevelComment
      if (!root?.id || !root.snippet) continue
      const totalReplies = it.snippet?.totalReplyCount ?? 0
      comments.push(mapCommentRow(root.id, root.snippet, null, totalReplies))

      const inline = it.replies?.comments ?? []
      for (const rep of inline) {
        if (!rep.id || !rep.snippet) continue
        comments.push(mapCommentRow(rep.id, rep.snippet, root.id, null))
      }
      // part=replies embute só um subconjunto — comparação, não threshold fixo
      if (totalReplies > inline.length) incompleteThreadIds.push(root.id)
    }

    current = parsed.json.nextPageToken
    if (!current) {
      return { comments, incompleteThreadIds, nextPageToken: null, pagesFetched, commentsDisabled: false, quotaExceeded: false }
    }
  }
  return { comments, incompleteThreadIds, nextPageToken: current ?? null, pagesFetched, commentsDisabled: false, quotaExceeded: false }
}

export interface RepliesResult {
  replies: YtCommentRow[]
  pagesFetched: number
  quotaExceeded: boolean
  /** null = todas as replies desta raiz foram buscadas. Não-null = parou no
   *  meio (quota, teto de páginas ou deadline) e HÁ MAIS — token de retomada. */
  nextPageToken: string | null
}

/** Replies de uma thread via comments.list?parentId= (100/pág).
 *  Retomável: opts.pageToken continua de onde parou; opts.deadlineMs corta por
 *  tempo devolvendo o cursor. Quem chama persiste nextPageToken na raiz e só
 *  marca replies_fetched=true quando ele volta null (senão perderia replies). */
export async function fetchAllReplies(
  auth: YtAuth, parentId: string,
  opts: { pageToken?: string; maxPages?: number; deadlineMs?: number } = {},
): Promise<RepliesResult> {
  const { headers, keyParam } = authParts(auth)
  const maxPages = opts.maxPages ?? 50
  const replies: YtCommentRow[] = []
  let pageToken: string | undefined = opts.pageToken
  let pagesFetched = 0

  for (let page = 0; page < maxPages; page++) {
    // Deadline só após a 1ª página (pageToken já é o cursor de retomada, nunca
    // null aqui — se tivesse acabado, o `if (!pageToken)` abaixo já retornou).
    if (page > 0 && opts.deadlineMs != null && Date.now() > opts.deadlineMs) {
      return { replies, pagesFetched, quotaExceeded: false, nextPageToken: pageToken ?? null }
    }
    const params = new URLSearchParams({
      part: 'snippet', parentId, maxResults: '100', textFormat: 'plainText',
      ...keyParam,
      ...(pageToken ? { pageToken } : {}),
    })
    const res = await fetch(`${DATA_API}/comments?${params}`, { headers })
    const parsed = await classifyCommentsResponse<{
      items?: Array<{ id?: string; snippet?: RawCommentSnippet }>
      nextPageToken?: string
    }>(res, 'comments.list(replies)')

    if (!parsed.ok) {
      // commentsDisabled não ocorre aqui (thread já veio da API) — trata como quota.
      // Devolve o token da página que falhou → retomada re-tenta ela (upsert dedup).
      return { replies, pagesFetched, quotaExceeded: true, nextPageToken: pageToken ?? null }
    }
    pagesFetched++

    for (const it of parsed.json.items ?? []) {
      if (!it.id || !it.snippet) continue
      replies.push(mapCommentRow(it.id, it.snippet, parentId, null))
    }
    pageToken = parsed.json.nextPageToken
    if (!pageToken) return { replies, pagesFetched, quotaExceeded: false, nextPageToken: null }
  }
  // Saiu pelo teto de páginas com token pendente → ainda há replies
  return { replies, pagesFetched, quotaExceeded: false, nextPageToken: pageToken ?? null }
}

export interface YtVideoLite {
  id: string
  title: string
  channelTitle: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
  /** null = contagem oculta (ex.: comentários desativados). */
  commentCount: number | null
}

/** Metadados leves pro submit da extração (videos.list, 1 unit por lote de 50).
 *  Separada de fetchVideosMeta (caminho do cron sync-youtube) de propósito —
 *  esta inclui channelTitle e nada de contentDetails. Vídeo privado/apagado
 *  simplesmente não vem no retorno (caller trata como não encontrado). */
export async function fetchVideosLite(auth: YtAuth, ids: string[]): Promise<YtVideoLite[]> {
  const { headers, keyParam } = authParts(auth)
  const out: YtVideoLite[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    const params = new URLSearchParams({
      part: 'snippet,statistics', id: batch.join(','), maxResults: '50',
      ...keyParam,
    })
    const res = await fetch(`${DATA_API}/videos?${params}`, { headers })
    const json = await jsonOrThrow<{
      items?: Array<{
        id: string
        snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string }; high?: { url?: string } } }
        statistics?: { commentCount?: string }
      }>
    }>(res, 'videos.list(lite)')
    for (const v of json.items ?? []) {
      out.push({
        id: v.id,
        title: v.snippet?.title ?? '',
        channelTitle: v.snippet?.channelTitle ?? null,
        thumbnailUrl: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.high?.url ?? null,
        publishedAt: v.snippet?.publishedAt ?? null,
        commentCount: v.statistics?.commentCount != null ? Number(v.statistics.commentCount) : null,
      })
    }
  }
  return out
}

// ── Receita (yt-analytics-monetary.readonly) ────────────────────────────────

export interface YtRevenueDay { date: string; revenue: number; cpm: number | null; monetizedPlaybacks: number | null }

/** Receita diária do canal em BRL. null = sem escopo monetário/sem permissão
 *  (token antigo) ou canal sem monetização — caller trata como gap honesto. */
export async function fetchRevenueDaily(
  accessToken: string, startDate: string, endDate: string,
): Promise<YtRevenueDay[] | null> {
  const variants = [
    'estimatedRevenue,cpm,monetizedPlaybacks',
    'estimatedRevenue',
  ]
  for (const metrics of variants) {
    try {
      const rows = await queryAnalytics(accessToken, {
        dimensions: 'day', metrics, startDate, endDate, currency: 'BRL',
      })
      return rows.map((r) => ({
        date: String(r.day ?? ''),
        revenue: Number(r.estimatedRevenue ?? 0),
        cpm: r.cpm != null ? Number(r.cpm) : null,
        monetizedPlaybacks: r.monetizedPlaybacks != null ? Number(r.monetizedPlaybacks) : null,
      }))
    } catch (e) {
      const status = (e as YoutubeApiError).status
      // 401/403 = escopo monetário não concedido neste token → reconectar
      if (status === 401 || status === 403) return null
      // outra falha: tenta a variante mais simples
    }
  }
  return null
}

/** Receita lifetime POR vídeo (BRL), em lotes. null = sem escopo/permissão. */
export async function fetchVideoRevenue(
  accessToken: string, videoIds: string[], startDate: string, endDate: string,
): Promise<Map<string, number> | null> {
  const out = new Map<string, number>()
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    try {
      const rows = await queryAnalytics(accessToken, {
        dimensions: 'video', metrics: 'estimatedRevenue',
        startDate, endDate, currency: 'BRL',
        filters: `video==${batch.join(',')}`, maxResults: '200',
      })
      for (const r of rows) out.set(String(r.video ?? ''), Number(r.estimatedRevenue ?? 0))
    } catch (e) {
      const status = (e as YoutubeApiError).status
      if (status === 401 || status === 403) return null
      // lote com erro não-permissão: segue pros próximos (gap honesto)
    }
  }
  return out
}

// ── Reporting API (bulk — impressões/CTR) ────────────────────────────────────

/** Garante os jobs bulk (idempotente: reusa job existente do mesmo reportTypeId).
 *  Criar NA CONEXÃO: o backfill (~30d) só é gerado na criação do job. */
export async function ensureReportingJobs(accessToken: string): Promise<Record<string, string>> {
  const existing = await fetch(`${REPORTING_API}/jobs`, { headers: authHeaders(accessToken) })
  const existingJson = await jsonOrThrow<{ jobs?: Array<{ id: string; reportTypeId: string }> }>(existing, 'reporting jobs.list')
  const byType: Record<string, string> = {}
  for (const j of existingJson.jobs ?? []) byType[j.reportTypeId] = j.id

  for (const typeId of REPORTING_TYPES) {
    if (byType[typeId]) continue
    try {
      const res = await fetch(`${REPORTING_API}/jobs`, {
        method: 'POST',
        headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportTypeId: typeId, name: `dash-${typeId}` }),
      })
      const json = await jsonOrThrow<{ id?: string }>(res, `reporting jobs.create ${typeId}`)
      if (json.id) byType[typeId] = json.id
    } catch (e) {
      // canal pode não ter o report type (ex: muito novo) — segue sem ele
      console.warn(`[youtube] reporting job ${typeId} indisponível:`, (e as Error).message)
    }
  }
  return byType
}

export interface ReportingReport { id: string; downloadUrl: string; startTime: string; createTime: string }

/** Relatórios (CSVs diários) de um job criados após `createdAfter` (ISO). */
export async function listNewReports(
  accessToken: string, jobId: string, createdAfter?: string,
): Promise<ReportingReport[]> {
  const params = new URLSearchParams(createdAfter ? { createdAfter } : {})
  const res = await fetch(`${REPORTING_API}/jobs/${jobId}/reports?${params}`, { headers: authHeaders(accessToken) })
  const json = await jsonOrThrow<{ reports?: ReportingReport[] }>(res, 'reporting reports.list')
  return (json.reports ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime))
}

/** Baixa e parseia um CSV do Reporting (header → índice; defensivo a colunas). */
export async function downloadReportCsv(
  accessToken: string, downloadUrl: string,
): Promise<Array<Record<string, string>>> {
  const res = await fetch(downloadUrl, { headers: authHeaders(accessToken) })
  if (!res.ok) throw new YoutubeApiError(`reporting download: ${res.statusText}`, res.status)
  const text = await res.text()
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]))
  })
}
