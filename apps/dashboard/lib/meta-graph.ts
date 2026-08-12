/**
 * Meta Graph API client — leitura de assets, comments e insights por ad.
 *
 * Por quê esse arquivo existe (separado de `app/api/cron/sync-meta/route.ts`):
 * - sync-meta fala /insights agregados pra atualizar a tabela `meta_ads`.
 * - Aqui ficam as leituras AD-A-AD pra /criativos v2: vídeo + thumb + post_id +
 *   comments + insights detalhados (incluindo `video_p75_watched_actions` pra
 *   Body Rate).
 * - Erros são tipados (`MetaGraphError`) e nunca silenciados [mind-vault: 6nwa5txkxsq3].
 *
 * Token: `META_ACCESS_TOKEN` precisa de `ads_read` + `pages_read_engagement`
 *        (comments) + `ads_management` (pausar/escalar, vem em PR 8).
 */

const META_API = process.env.META_GRAPH_URL ?? 'https://graph.facebook.com/v20.0'

export class MetaGraphError extends Error {
  constructor(msg: string, readonly status?: number, readonly cause?: unknown) {
    super(msg)
    this.name = 'MetaGraphError'
  }
}

function getToken(): string {
  const t = process.env.META_ACCESS_TOKEN
  if (!t) throw new MetaGraphError('META_ACCESS_TOKEN não configurado')
  return t
}

// Token pra ler o vídeo da Página (campo `source`/`captions`). O token de Ads
// (system user) não acessa o source; um Page Access Token sim. Cai no de Ads
// se o page token não estiver configurado.
function getVideoToken(): string {
  return process.env.META_PAGE_TOKEN || getToken()
}

async function fetchJson<T>(url: string, where: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (cause) {
    throw new MetaGraphError(`network failure ${where}`, undefined, cause)
  }
  let body: unknown
  try {
    body = await res.json()
  } catch (cause) {
    throw new MetaGraphError(`non-JSON response ${where} (status ${res.status})`, res.status, cause)
  }
  if (typeof body !== 'object' || body === null) {
    throw new MetaGraphError(`non-object response ${where}`, res.status)
  }
  const env = body as { error?: { message?: string; code?: number; error_subcode?: number } }
  if (env.error) {
    const sub = env.error.error_subcode ? `/${env.error.error_subcode}` : ''
    throw new MetaGraphError(
      `Meta API ${where}: ${env.error.message ?? 'unknown'} (code ${env.error.code ?? '?'}${sub})`,
      res.status
    )
  }
  if (!res.ok) {
    throw new MetaGraphError(`HTTP ${res.status} ${where}`, res.status)
  }
  return body as T
}

// ─── Assets ───────────────────────────────────────────────────────────────────

export interface AdCreativeAssets {
  adId: string
  postId: string | null               // effective_object_story_id (FB shadow)
  effectiveObjectStoryId: string | null
  igMediaId: string | null            // pref. pra IG-native ads — usar com getIgMediaComments
  videoUrl: string | null
  videoId: string | null
  thumbnailUrl: string | null
  copy: string | null
  instagramPermalinkUrl: string | null
  previewShareableLink: string | null
}

interface GraphAdResponse {
  id?: string
  preview_shareable_link?: string
  creative?: {
    id?: string
    body?: string
    effective_object_story_id?: string
    effective_instagram_media_id?: string
    instagram_permalink_url?: string
    object_story_spec?: {
      video_data?: { video_id?: string; image_url?: string; message?: string }
      link_data?: { message?: string; image_hash?: string; picture?: string }
    }
    image_url?: string
    thumbnail_url?: string
    video_id?: string
  }
}

interface GraphVideoResponse {
  source?: string
  picture?: string
  /** Frames em resolução real (1080x1920). `picture` é uma redução (160x284). */
  thumbnails?: { data?: Array<{ uri?: string; is_preferred?: boolean }> }
}

export async function getAdCreativeAssets(
  adId: string,
  opts?: { accessToken?: string; videoToken?: string },
): Promise<AdCreativeAssets> {
  // Token por-projeto (multi-tenant): override > env global (DEMO). Callers
  // existentes (sem opts) ficam idênticos.
  const token = opts?.accessToken || getToken()
  const videoTokenResolved = opts?.videoToken || opts?.accessToken || getVideoToken()
  const fields = [
    'preview_shareable_link',
    'creative{id,body,effective_object_story_id,effective_instagram_media_id,instagram_permalink_url,object_story_spec,image_url,thumbnail_url,video_id}',
  ].join(',')
  const ad = await fetchJson<GraphAdResponse>(
    `${META_API}/${adId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`,
    `getAdCreativeAssets(${adId})`
  )

  const c = ad.creative ?? {}
  const videoId = c.video_id ?? c.object_story_spec?.video_data?.video_id ?? null
  const copy =
    c.body ??
    c.object_story_spec?.video_data?.message ??
    c.object_story_spec?.link_data?.message ??
    null

  let videoUrl: string | null = null
  // Ordem por RESOLUÇÃO, não por nome. Medido na conta real: `creative.thumbnail_url`
  // sempre volta 64x64 (o `stp=...p64x64...` está cravado na URL) enquanto `image_url`
  // volta 1080x1080 — então o thumbnail_url é o ÚLTIMO recurso, não o primeiro. Pra
  // vídeo, o melhor vem da edge /thumbnails (1080x1920), resolvida logo abaixo.
  let thumbnailUrl: string | null =
    c.image_url ??
    c.object_story_spec?.video_data?.image_url ??
    c.object_story_spec?.link_data?.picture ??
    c.thumbnail_url ??
    null

  if (videoId) {
    // Pode falhar com (#10) se o token não tem permissão de vídeo
    // (`read_insights`+pages_read). Não é fatal — caller que precisar do
    // videoUrl (PR 3, Gemini multimodal) cuida disso. Pra comments só importa
    // postId. Log warn pra rastreabilidade.
    try {
      const video = await fetchJson<GraphVideoResponse>(
        `${META_API}/${videoId}?fields=${encodeURIComponent('source,picture,thumbnails{uri,is_preferred}')}&access_token=${encodeURIComponent(videoTokenResolved)}`,
        `getVideo(${videoId})`
      )
      videoUrl = video.source ?? null
      // Vídeo: o frame da edge /thumbnails vem em 1080x1920 (mesma qualidade dos
      // frames da VPS) e VENCE o que veio do creative. `is_preferred` é o frame que
      // o próprio Meta elegeu como capa; sem ele, o primeiro. `picture` (160x284) e
      // o thumbnail_url (64x64) ficam só de rede de segurança.
      const frames = video.thumbnails?.data ?? []
      const preferido = frames.find((t) => t.is_preferred)?.uri ?? frames[0]?.uri ?? null
      thumbnailUrl = preferido ?? thumbnailUrl ?? video.picture ?? null
    } catch (err) {
      if (err instanceof MetaGraphError) {
        // log fica em chamadores que importam log; aqui só re-expõe na resposta
        // null/null e o erro continua observável pelos logs do route handler
      } else {
        throw err
      }
    }
  }

  // effective_object_story_id é o "page_id_postId" — quebra em postId pra /comments.
  const effective = c.effective_object_story_id ?? null
  const postId = effective ? effective.split('_').slice(1).join('_') || effective : null

  return {
    adId,
    postId: effective,
    effectiveObjectStoryId: effective,
    igMediaId: c.effective_instagram_media_id ?? null,
    videoUrl,
    videoId,
    thumbnailUrl,
    copy,
    instagramPermalinkUrl: c.instagram_permalink_url ?? null,
    previewShareableLink: ad.preview_shareable_link ?? null,
  }
}

// ─── Tipo de criativo + cards do carrossel (camada de dados do carrossel) ─────
// Diferente de getAdCreativeAssets (que resolve vídeo/thumb/post pra 1 ad): aqui
// só interessa CLASSIFICAR o criativo (carousel|video|image|dynamic) e, se for
// carrossel, extrair os cards — em LOTE, barato, pra popular meta_ads. Token: ads_read.

export type CreativeType = 'carousel' | 'video' | 'image' | 'dynamic'

/** Um card do carrossel. Shape estável que a UI (follow-up) vai ler do jsonb. */
export interface CarouselCard {
  title: string | null
  image_url: string | null
  link: string | null
}

export interface AdCreativeType {
  adId: string
  tipoCriativo: CreativeType | null
  childAttachments: CarouselCard[] | null
}

interface RawChildAttachment {
  link?: string
  name?: string
  description?: string
  picture?: string
  image_url?: string
  image_hash?: string
  video_id?: string
}

interface RawObjectStorySpec {
  video_data?: { video_id?: string; image_url?: string }
  photo_data?: unknown
  link_data?: {
    picture?: string
    image_hash?: string
    child_attachments?: RawChildAttachment[]
  }
}

interface RawAssetFeedSpec {
  ad_formats?: string[]
  images?: Array<{ hash?: string; url?: string }>
  videos?: Array<{ video_id?: string; thumbnail_url?: string; url?: string }>
  titles?: Array<{ text?: string }>
  bodies?: Array<{ text?: string }>
  link_urls?: Array<{ website_url?: string; display_url?: string }>
}

interface RawCreativeType {
  id?: string
  object_story_spec?: RawObjectStorySpec
  asset_feed_spec?: RawAssetFeedSpec
  effective_object_story_id?: string
}

interface GraphAdCreativeTypeResponse {
  id?: string
  creative?: RawCreativeType
}

function ossCards(list: RawChildAttachment[]): CarouselCard[] {
  return list.map((ca) => ({
    title: ca.name ?? ca.description ?? null,
    image_url: ca.picture ?? ca.image_url ?? null, // fbcdn assinada (expira) — re-resolvida pelo cron diário
    link: ca.link ?? null,
  }))
}

function afsCards(afs: RawAssetFeedSpec): CarouselCard[] {
  // asset_feed_spec não amarra card-a-card (assets são combinatórios); zip por índice best-effort.
  const titles = afs.titles ?? []
  const links = afs.link_urls ?? []
  const imgs = afs.images ?? []
  const vids = afs.videos ?? []
  const n = Math.max(imgs.length, vids.length, titles.length, links.length)
  const cards: CarouselCard[] = []
  for (let i = 0; i < n; i++) {
    const image_url = imgs[i]?.url ?? vids[i]?.thumbnail_url ?? vids[i]?.url ?? null
    const title = titles[i]?.text ?? null
    const link = links[i]?.website_url ?? links[i]?.display_url ?? null
    if (image_url || title || link) cards.push({ title, image_url, link })
  }
  return cards
}

/** Deriva tipo_criativo + child_attachments a partir do `creative` do Meta. Pura (sem I/O). */
export function deriveCreativeType(creative: RawCreativeType | undefined | null): {
  tipoCriativo: CreativeType | null
  childAttachments: CarouselCard[] | null
} {
  const oss = creative?.object_story_spec
  const afs = creative?.asset_feed_spec

  // 1) Carrossel explícito: object_story_spec.link_data.child_attachments.
  const ossKids = oss?.link_data?.child_attachments
  if (Array.isArray(ossKids) && ossKids.length > 0) {
    return { tipoCriativo: 'carousel', childAttachments: ossCards(ossKids) }
  }

  // 2) asset_feed_spec = criativo dinâmico (Advantage+/DCO) — e pode ser um carrossel.
  if (afs) {
    const formats = (afs.ad_formats ?? []).map((f) => String(f).toUpperCase())
    if (formats.some((f) => f.includes('CAROUSEL'))) {
      const cards = afsCards(afs)
      return { tipoCriativo: 'carousel', childAttachments: cards.length ? cards : null }
    }
    return { tipoCriativo: 'dynamic', childAttachments: null }
  }

  // 3) Peça única no object_story_spec.
  if (oss?.video_data) return { tipoCriativo: 'video', childAttachments: null }
  if (oss?.link_data || oss?.photo_data) return { tipoCriativo: 'image', childAttachments: null }

  return { tipoCriativo: null, childAttachments: null } // sem creative legível → caller pula
}

const CREATIVE_TYPE_FIELDS = 'creative{object_story_spec,asset_feed_spec,effective_object_story_id}'

async function fetchOneCreativeType(adId: string, token: string): Promise<AdCreativeType> {
  const ad = await fetchJson<GraphAdCreativeTypeResponse>(
    `${META_API}/${adId}?fields=${encodeURIComponent(CREATIVE_TYPE_FIELDS)}&access_token=${encodeURIComponent(token)}`,
    `getAdCreativeType(${adId})`,
  )
  return { adId, ...deriveCreativeType(ad.creative) }
}

/**
 * Classifica vários ad_ids em lote (tipo_criativo + cards do carrossel).
 * Batch de 50 via `?ids=` (mesma pegada do sync-meta). Como no `?ids=` um id
 * inválido derruba a requisição inteira, o fallback re-tenta o batch id-a-id —
 * um ad ruim NÃO derruba os outros 49. best-effort: ad que falha some do Map.
 * `batchDelayMs` = pausa entre batches (rate-limit defensivo).
 */
export async function fetchAdCreativeTypes(
  adIds: string[],
  opts?: { accessToken?: string; batchDelayMs?: number },
): Promise<Map<string, AdCreativeType>> {
  const token = opts?.accessToken || getToken()
  const delay = opts?.batchDelayMs ?? 250
  const out = new Map<string, AdCreativeType>()
  const uniq = [...new Set(adIds.filter(Boolean))]

  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50)
    try {
      const json = await fetchJson<Record<string, GraphAdCreativeTypeResponse>>(
        `${META_API}/?ids=${encodeURIComponent(batch.join(','))}&fields=${encodeURIComponent(CREATIVE_TYPE_FIELDS)}&access_token=${encodeURIComponent(token)}`,
        `fetchAdCreativeTypes(batch@${i})`,
      )
      for (const id of batch) {
        const ad = json[id]
        if (ad) out.set(id, { adId: id, ...deriveCreativeType(ad.creative) })
      }
    } catch {
      // 1 id ruim derrubou o `?ids=` → individual, cada um isolado
      for (const id of batch) {
        try {
          out.set(id, await fetchOneCreativeType(id, token))
        } catch {
          /* best-effort: ad ruim fica de fora; o caller loga o que sobrou */
        }
      }
    }
    if (delay > 0 && i + 50 < uniq.length) await new Promise((r) => setTimeout(r, delay))
  }
  return out
}

// ─── Instagram Graph API: comments de IG-native posts ────────────────────────
// Anúncios Instagram-only (single Instagram account, ad runs as IG post não
// republicado no FB) têm `effective_object_story_id` apontando pra uma "Page
// shadow" que NÃO é acessível mesmo com `pages_read_engagement`. Os comments
// vivem na IG Graph API e exigem:
//   - IG Business Account atribuído ao System User no BM
//   - escopos `instagram_basic` + `instagram_manage_comments` no token
//
// Retorna mesmo shape de `MetaComment` pra ser intercambiável.

interface IgCommentRaw {
  id: string
  text?: string
  timestamp?: string
  username?: string
  like_count?: number
  replies_count?: number
}

interface IgCommentsResponse {
  data?: IgCommentRaw[]
  paging?: { cursors?: { after?: string }; next?: string }
}

export async function getIgMediaComments(
  igMediaId: string,
  opts: { max?: number } = {}
): Promise<MetaComment[]> {
  const token = getToken()
  const max = opts.max ?? 500
  const fields = 'id,text,timestamp,username,like_count,replies_count'
  const out: MetaComment[] = []
  let url: string | null =
    `${META_API}/${igMediaId}/comments?fields=${encodeURIComponent(fields)}` +
    `&limit=100&access_token=${encodeURIComponent(token)}`

  while (url && out.length < max) {
    const page: IgCommentsResponse = await fetchJson(url, `getIgMediaComments(${igMediaId})`)
    for (const c of page.data ?? []) {
      out.push({
        id: c.id,
        message: c.text ?? null,
        createdTime: c.timestamp ?? new Date().toISOString(),
        likeCount: c.like_count ?? 0,
        replyCount: c.replies_count ?? 0,
        fromName: c.username ?? null,
        fromId: null,
      })
      if (out.length >= max) break
    }
    url = page.paging?.next ?? null
  }
  return out
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export interface MetaComment {
  id: string
  message: string | null
  createdTime: string
  likeCount: number
  replyCount: number
  fromName: string | null
  fromId: string | null
}

interface GraphCommentRaw {
  id: string
  message?: string
  created_time?: string
  like_count?: number
  comment_count?: number
  from?: { id?: string; name?: string }
}

interface GraphCommentsResponse {
  data?: GraphCommentRaw[]
  paging?: { cursors?: { after?: string }; next?: string }
}

export async function getPostComments(
  postId: string,
  opts: { since?: Date; max?: number } = {}
): Promise<MetaComment[]> {
  const token = getToken()
  const max = opts.max ?? 500
  const fields = 'id,message,created_time,like_count,comment_count,from'
  const sinceTs = opts.since ? Math.floor(opts.since.getTime() / 1000) : undefined

  const out: MetaComment[] = []
  let url: string | null =
    `${META_API}/${postId}/comments?fields=${encodeURIComponent(fields)}` +
    `&order=reverse_chronological&limit=100` +
    (sinceTs ? `&since=${sinceTs}` : '') +
    `&access_token=${encodeURIComponent(token)}`

  while (url && out.length < max) {
    const page: GraphCommentsResponse = await fetchJson(url, `getPostComments(${postId})`)
    for (const c of page.data ?? []) {
      out.push({
        id: c.id,
        message: c.message ?? null,
        createdTime: c.created_time ?? new Date().toISOString(),
        likeCount: c.like_count ?? 0,
        replyCount: c.comment_count ?? 0,
        fromName: c.from?.name ?? null,
        fromId: c.from?.id ?? null,
      })
      if (out.length >= max) break
    }
    url = page.paging?.next ?? null
  }

  return out
}

// ─── Inventário da conta (criativos que NÃO rodaram) ──────────────────────────
// Diferente de /insights (só quem entregou): estas leituras enumeram a CONTA toda
// — anúncios independente de entrega + a biblioteca de mídia (vídeos/imagens).
// Usado pra achar criativos com 0 entrega + assets soltos. Token: ads_read.

export interface AccountAd {
  adId: string
  name: string | null
  effectiveStatus: string | null
  videoId: string | null
  imageHash: string | null
}

interface GraphAccountAdsResponse {
  data?: Array<{
    id: string
    name?: string
    effective_status?: string
    creative?: {
      video_id?: string
      image_hash?: string
      object_story_spec?: {
        video_data?: { video_id?: string; image_hash?: string }
        link_data?: { image_hash?: string }
      }
    }
  }>
  paging?: { next?: string }
}

/** Lista TODOS os anúncios da conta (independente de entrega) + effective_status + asset usado. */
export async function listAccountAds(accountId: string, opts?: { accessToken?: string; max?: number }): Promise<AccountAd[]> {
  const token = opts?.accessToken || getToken()
  const max = opts?.max ?? 5000
  const fields = 'id,name,effective_status,creative{video_id,image_hash,object_story_spec}'
  const out: AccountAd[] = []
  let url: string | null =
    `${META_API}/act_${accountId}/ads?fields=${encodeURIComponent(fields)}&limit=200&access_token=${encodeURIComponent(token)}`
  while (url && out.length < max) {
    const page: GraphAccountAdsResponse = await fetchJson(url, `listAccountAds(${accountId})`)
    for (const a of page.data ?? []) {
      const c = a.creative ?? {}
      const videoId = c.video_id ?? c.object_story_spec?.video_data?.video_id ?? null
      const imageHash = c.image_hash ?? c.object_story_spec?.video_data?.image_hash ?? c.object_story_spec?.link_data?.image_hash ?? null
      out.push({ adId: a.id, name: a.name ?? null, effectiveStatus: a.effective_status ?? null, videoId, imageHash })
      if (out.length >= max) break
    }
    url = page.paging?.next ?? null
  }
  return out
}

export interface LibVideo { videoId: string; title: string | null; source: string | null; picture: string | null }
interface GraphAdVideosResponse { data?: Array<{ id: string; title?: string; source?: string; picture?: string }>; paging?: { next?: string } }

/** Vídeos na biblioteca de mídia da conta. `source` = URL baixável (usa page/video token). */
export async function listAdVideos(accountId: string, opts?: { accessToken?: string; max?: number }): Promise<LibVideo[]> {
  const token = opts?.accessToken || getVideoToken()
  const max = opts?.max ?? 5000
  const fields = 'id,title,source,picture'
  const out: LibVideo[] = []
  let url: string | null =
    `${META_API}/act_${accountId}/advideos?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(token)}`
  while (url && out.length < max) {
    const page: GraphAdVideosResponse = await fetchJson(url, `listAdVideos(${accountId})`)
    for (const v of page.data ?? []) {
      out.push({ videoId: v.id, title: v.title ?? null, source: v.source ?? null, picture: v.picture ?? null })
      if (out.length >= max) break
    }
    url = page.paging?.next ?? null
  }
  return out
}

/** Re-resolve a URL `source` (baixável) de um vídeo da biblioteca pelo video_id. */
export async function getVideoSource(videoId: string, opts?: { videoToken?: string }): Promise<{ source: string | null; picture: string | null }> {
  const token = opts?.videoToken || getVideoToken()
  try {
    const v = await fetchJson<GraphVideoResponse>(
      `${META_API}/${videoId}?fields=source,picture&access_token=${encodeURIComponent(token)}`,
      `getVideoSource(${videoId})`,
    )
    return { source: v.source ?? null, picture: v.picture ?? null }
  } catch (err) {
    if (err instanceof MetaGraphError) return { source: null, picture: null }
    throw err
  }
}

export interface LibImage { hash: string; name: string | null; url: string | null }
interface GraphAdImagesResponse { data?: Array<{ hash: string; name?: string; url?: string; permalink_url?: string }>; paging?: { next?: string } }

/** Imagens na biblioteca de mídia da conta. */
export async function listAdImages(accountId: string, opts?: { accessToken?: string; max?: number }): Promise<LibImage[]> {
  const token = opts?.accessToken || getToken()
  const max = opts?.max ?? 5000
  const fields = 'hash,name,url,permalink_url'
  const out: LibImage[] = []
  let url: string | null =
    `${META_API}/act_${accountId}/adimages?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(token)}`
  while (url && out.length < max) {
    const page: GraphAdImagesResponse = await fetchJson(url, `listAdImages(${accountId})`)
    for (const im of page.data ?? []) {
      out.push({ hash: im.hash, name: im.name ?? null, url: im.url ?? im.permalink_url ?? null })
      if (out.length >= max) break
    }
    url = page.paging?.next ?? null
  }
  return out
}

// ─── Insights diários (Body Rate + fadiga) ────────────────────────────────────

export interface AdInsightDay {
  date: string
  spend: number
  impressions: number
  reach: number
  clicks: number
  views3s: number
  views75pct: number
  views95pct: number
  purchases: number
  purchaseValue: number
  /** actions:comment — comentários no anúncio. Já vinha na resposta; só não era lido. */
  comments: number
}

interface GraphInsightRow {
  date_start: string
  spend?: string
  impressions?: string
  reach?: string
  inline_link_clicks?: string
  video_p75_watched_actions?: Array<{ action_type: string; value: string }>
  video_p95_watched_actions?: Array<{ action_type: string; value: string }>
  actions?: Array<{ action_type: string; value: string }>
  action_values?: Array<{ action_type: string; value: string }>
}

interface GraphInsightsResponse {
  data?: GraphInsightRow[]
  paging?: { next?: string }
}

function sumActions(arr: Array<{ value: string }> | undefined): number {
  return (arr ?? []).reduce((s, a) => s + (parseFloat(a.value) || 0), 0)
}

function actionValue(arr: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  const item = arr?.find((a) => a.action_type === type)
  return item ? parseFloat(item.value) || 0 : 0
}

export async function getAdInsightsDaily(
  adId: string,
  since: string,
  until: string
): Promise<AdInsightDay[]> {
  const token = getToken()
  const fields = [
    'date_start',
    'spend',
    'impressions',
    'reach',
    'inline_link_clicks',
    'video_p75_watched_actions',
    'video_p95_watched_actions',
    'actions',
    'action_values',
  ].join(',')
  const params = new URLSearchParams({
    fields,
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
    limit: '500',
    access_token: token,
  })

  const out: AdInsightDay[] = []
  let url: string | null = `${META_API}/${adId}/insights?${params}`
  while (url) {
    const page: GraphInsightsResponse = await fetchJson(url, `getAdInsightsDaily(${adId})`)
    for (const r of page.data ?? []) {
      out.push({
        date: r.date_start,
        spend: parseFloat(r.spend ?? '0') || 0,
        impressions: parseInt(r.impressions ?? '0') || 0,
        reach: parseInt(r.reach ?? '0') || 0,
        clicks: parseInt(r.inline_link_clicks ?? '0') || 0,
        views3s: Math.round(actionValue(r.actions, 'video_view')),
        views75pct: Math.round(sumActions(r.video_p75_watched_actions)),
        views95pct: Math.round(sumActions(r.video_p95_watched_actions)),
        purchases: Math.round(actionValue(r.actions, 'offsite_conversion.fb_pixel_purchase')),
        purchaseValue: actionValue(r.action_values, 'offsite_conversion.fb_pixel_purchase'),
        // `comment` já vem dentro de `actions` (nenhuma chamada nova, nenhuma permissão nova).
        // Ausente = 0 comentários naquele dia (o Meta omite a ação quando não houve nenhuma).
        comments: Math.round(actionValue(r.actions, 'comment')),
      })
    }
    url = page.paging?.next ?? null
  }
  return out
}
