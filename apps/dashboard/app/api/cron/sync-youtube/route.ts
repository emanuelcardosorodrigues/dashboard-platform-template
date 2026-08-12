/**
 * Cron: sincroniza YouTube orgânico → Supabase (área ORGÂNICO, Onda 1).
 *
 * Dispatcher por projeto (mesmo padrão do sync-meta): alvos = [workspace
 * default] ∪ [workspaces com credencial 'youtube']. Por conta conectada:
 *
 *  1. Data API     → inventário completo (uploads playlist → videos.list):
 *                    upsert organic_posts (snapshot lifetime + metadados).
 *  2. Analytics    → métricas lifetime por vídeo (AVD/APV/subs±/shares/engaged)
 *                    em lotes; série diária + curva de retenção + fontes de
 *                    tráfego + termos de busca + subscribedStatus pros
 *                    DETAIL_LIMIT vídeos mais novos (retenção = 1 query/vídeo).
 *  3. Analytics    → série diária do canal (organic_profile_daily) + snapshots
 *                    de demografia/devices (organic_audience_snapshots).
 *  4. Reporting    → CSVs novos de impressões/CTR de thumbnail
 *                    (channel_reach_basic_a1) → organic_post_metrics_daily
 *                    source='reporting' + agregado lifetime nos posts.
 *
 * Honestidade de dados: métrica que a API não retornou fica NULL (nunca 0);
 * falha por conta vira organic_accounts.last_error/status (nunca silenciosa).
 * Lag oficial do Analytics = 48-72h — não alarmar sobre "ontem".
 *
 * `?days=N` (1-90, default 7) = janela da série diária. Quota Data API por run
 * de um canal de ~200 vídeos ≈ 10-60 units (limite 10.000/dia).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { brazilDateStr } from '@/lib/brazilDate'
import { getYoutubeConfig, type YoutubeConfig } from '@/lib/integrations/factory'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'
import {
  refreshAccessToken, fetchMyChannel, fetchUploadsVideoIds, fetchVideosMeta,
  fetchVideoRangeMetrics, fetchVideoDaily, fetchRetention, fetchTrafficSources,
  fetchSearchTerms, fetchSubscribedStatus, fetchChannelDaily, fetchDemographics,
  fetchDeviceTypes, ensureReportingJobs, listNewReports, downloadReportCsv,
  fetchRevenueDaily, fetchVideoRevenue, formatFromDuration, type YtVideoMeta,
} from '@/lib/organico/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Vídeos mais novos que ganham detalhe caro (retenção/tráfego/daily). */
const DETAIL_LIMIT = 20
/** CSVs do Reporting processados por run (catch-up gradual no backfill). */
const MAX_CSVS_PER_RUN = 12
const LIFETIME_START = '2015-01-01'

function db(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

interface AccountRow {
  id: string
  external_id: string
  status: string
  meta: Record<string, unknown>
}

function ymdFromReporting(d: string): string {
  // Reporting API usa YYYYMMDD
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d
}

async function syncAccount(args: {
  supabase: SupabaseClient
  workspaceId: string
  account: AccountRow
  cfg: YoutubeConfig
  sinceStr: string
  todayStr: string
}): Promise<Record<string, unknown>> {
  const { supabase, workspaceId, account, cfg, sinceStr, todayStr } = args
  const refreshToken = cfg.tokens[account.external_id] ?? cfg.tokens['*']
  if (!refreshToken) {
    await supabase.from('organic_accounts')
      .update({ status: 'token_expired', last_error: 'sem refresh token pra este canal' })
      .eq('id', account.id)
    return { erro: 'sem refresh token' }
  }

  let accessToken: string
  try {
    accessToken = await refreshAccessToken({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken })
  } catch (e) {
    const msg = (e as Error).message
    await supabase.from('organic_accounts')
      .update({ status: 'token_expired', last_error: `refresh falhou: ${msg}` })
      .eq('id', account.id)
    return { erro: `token: ${msg}` }
  }

  const meta = { ...(account.meta ?? {}) }

  // ── 1) Inventário (Data API) ───────────────────────────────────────────────
  let uploadsPlaylistId = typeof meta.uploads_playlist_id === 'string' ? meta.uploads_playlist_id : null
  let subscriberCount: number | null = null
  const channel = await fetchMyChannel(accessToken).catch(() => null)
  if (channel) {
    uploadsPlaylistId = channel.uploadsPlaylistId ?? uploadsPlaylistId
    subscriberCount = channel.subscriberCount
    meta.uploads_playlist_id = uploadsPlaylistId
    // stats do canal pro cabeçalho de identidade (/organico/youtube)
    meta.channel_stats = {
      subscribers: channel.subscriberCount,
      total_views: channel.viewCount,
      videos: channel.videoCount,
      title: channel.title,
      updated_at: new Date().toISOString(),
    }
  }
  if (!uploadsPlaylistId) throw new Error('uploads playlist não encontrada pro canal')

  const videoIds = await fetchUploadsVideoIds(accessToken, uploadsPlaylistId)
  const metas = await fetchVideosMeta(accessToken, videoIds)

  // ── 2) Lifetime por vídeo (Analytics, em lotes) ───────────────────────────
  const range = await fetchVideoRangeMetrics(accessToken, videoIds, LIFETIME_START, todayStr)
    .catch((e) => { console.warn('[sync-youtube] range metrics falhou:', (e as Error).message); return [] })
  const rangeById = new Map(range.map((r) => [r.videoId, r]))

  const postRecords = metas.map((v: YtVideoMeta) => {
    const a = rangeById.get(v.id)
    const format = formatFromDuration(v.durationSeconds)
    return {
      workspace_id: workspaceId,
      account_id: account.id,
      platform: 'youtube',
      external_id: v.id,
      format,
      title: v.title,
      caption: v.description.slice(0, 5000) || null,
      thumbnail_url: v.thumbnailUrl,
      permalink: format === 'short' ? `https://www.youtube.com/shorts/${v.id}` : `https://youtu.be/${v.id}`,
      published_at: v.publishedAt,
      duration_seconds: v.durationSeconds,
      hashtags: v.tags.slice(0, 50),
      views: v.viewCount,
      likes: v.likeCount,
      comments_count: v.commentCount,
      engaged_views: a?.engagedViews ?? null,
      shares: a?.shares ?? null,
      apv: a?.averageViewPercentage ?? null,
      avg_watch_time_s: a?.averageViewDuration ?? null,
      total_watch_time_s: a ? a.estimatedMinutesWatched * 60 : null,
      subs_gained: a?.subscribersGained ?? null,
      subs_lost: a?.subscribersLost ?? null,
      updated_at: new Date().toISOString(),
    }
  })
  for (let i = 0; i < postRecords.length; i += 200) {
    const { error } = await supabase.from('organic_posts')
      .upsert(postRecords.slice(i, i + 200), { onConflict: 'workspace_id,platform,external_id' })
    if (error) throw new Error(`upsert organic_posts: ${error.message}`)
  }

  // Mapa external_id → uuid (PK do daily/retenção)
  const { data: idRows, error: idErr } = await supabase.from('organic_posts')
    .select('id, external_id')
    .eq('workspace_id', workspaceId).eq('account_id', account.id)
  if (idErr) throw new Error(`map ids: ${idErr.message}`)
  const postIdByExternal = new Map((idRows as { id: string; external_id: string }[]).map((r) => [r.external_id, r.id]))

  // ── 3) Detalhe caro pros mais novos ────────────────────────────────────────
  // allSettled de propósito: retenção/subscribedStatus FALHAM normalmente em
  // vídeo com poucas views — cada parte grava o que conseguiu (gap honesto),
  // nunca derruba a série diária junto.
  const newest = [...metas].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, DETAIL_LIMIT)
  let detailOk = 0
  for (const v of newest) {
    const postId = postIdByExternal.get(v.id)
    if (!postId) continue
    const [dailyR, retentionR, trafficR, searchR, subR] = await Promise.allSettled([
      fetchVideoDaily(accessToken, v.id, sinceStr, todayStr),
      fetchRetention(accessToken, v.id),
      fetchTrafficSources(accessToken, v.id, LIFETIME_START, todayStr),
      fetchSearchTerms(accessToken, v.id, LIFETIME_START, todayStr),
      fetchSubscribedStatus(accessToken, v.id, LIFETIME_START, todayStr),
    ])
    const warn = (label: string, r: PromiseSettledResult<unknown>) => {
      if (r.status === 'rejected') console.warn(`[sync-youtube] ${label} ${v.id}:`, (r.reason as Error)?.message ?? r.reason)
    }
    warn('daily', dailyR); warn('retention', retentionR); warn('traffic', trafficR); warn('search', searchR); warn('substatus', subR)

    let partOk = false
    try {
      if (dailyR.status === 'fulfilled' && dailyR.value.length > 0) {
        const rows = dailyR.value.map((d) => ({
          workspace_id: workspaceId, post_id: postId, date: d.date, source: 'analytics',
          views: d.views, engaged_views: d.engagedViews, likes: d.likes, comments: d.comments,
          shares: d.shares, watch_time_s: d.watchTimeMin * 60,
          subs_gained: d.subscribersGained, subs_lost: d.subscribersLost,
        }))
        const { error } = await supabase.from('organic_post_metrics_daily')
          .upsert(rows, { onConflict: 'workspace_id,post_id,date' })
        if (error) console.warn(`[sync-youtube] upsert daily ${v.id}:`, error.message)
        else partOk = true
      }

      if (retentionR.status === 'fulfilled' && retentionR.value.length > 0) {
        const rows = retentionR.value.map((p) => ({
          workspace_id: workspaceId, post_id: postId,
          elapsed_ratio: p.elapsedRatio, audience_watch_ratio: p.audienceWatchRatio,
          relative_performance: p.relativePerformance, captured_at: todayStr,
        }))
        const { error } = await supabase.from('organic_retention_points')
          .upsert(rows, { onConflict: 'workspace_id,post_id,elapsed_ratio' })
        if (error) console.warn(`[sync-youtube] upsert retention ${v.id}:`, error.message)
        else partOk = true
      }

      const patch: Record<string, unknown> = {}
      if (trafficR.status === 'fulfilled' && Object.keys(trafficR.value).length > 0) patch.traffic_sources = trafficR.value
      if (searchR.status === 'fulfilled' && searchR.value.length > 0) patch.search_terms = searchR.value
      if (subR.status === 'fulfilled' && Object.keys(subR.value).length > 0) patch.subscribed_status = subR.value
      if (Object.keys(patch).length > 0) {
        await supabase.from('organic_posts').update(patch).eq('id', postId)
        partOk = true
      }
    } catch (e) {
      console.warn(`[sync-youtube] detalhe ${v.id}:`, (e as Error).message)
    }
    if (partOk) detailOk++
  }

  // ── 4) Canal diário + audiência ────────────────────────────────────────────
  try {
    const channelDaily = await fetchChannelDaily(accessToken, sinceStr, todayStr)
    if (channelDaily.length > 0) {
      const rows = channelDaily.map((d) => ({
        workspace_id: workspaceId, account_id: account.id, date: d.date,
        views: d.views, subs_gained: d.subscribersGained, subs_lost: d.subscribersLost,
        watch_time_s: d.watchTimeMin * 60,
        // followers (total) só existe pro snapshot de HOJE — warehouse honesto
        ...(d.date === todayStr && subscriberCount != null ? { followers: subscriberCount } : {}),
      }))
      let { error } = await supabase.from('organic_profile_daily')
        .upsert(rows, { onConflict: 'workspace_id,account_id,date' })
      // migration 0032 (watch_time_s) ainda não rodada → grava sem a coluna
      if (error && /watch_time_s/.test(error.message)) {
        const semWatch = rows.map(({ watch_time_s: _w, ...rest }) => rest)
        ;({ error } = await supabase.from('organic_profile_daily')
          .upsert(semWatch, { onConflict: 'workspace_id,account_id,date' }))
      }
      if (error) throw new Error(error.message)
    }
  } catch (e) {
    console.warn('[sync-youtube] channel daily:', (e as Error).message)
  }

  // ── 4b) Receita (escopo monetário; null = não concedido/sem monetização) ──
  let revenueOk = false
  try {
    const [revDaily, revByVideo] = await Promise.all([
      fetchRevenueDaily(accessToken, sinceStr, todayStr),
      fetchVideoRevenue(accessToken, videoIds, LIFETIME_START, todayStr),
    ])
    if (revDaily && revDaily.length > 0) {
      const rows = revDaily.map((d) => ({
        workspace_id: workspaceId, account_id: account.id, date: d.date,
        revenue: d.revenue, cpm: d.cpm,
      }))
      let { error } = await supabase.from('organic_profile_daily')
        .upsert(rows, { onConflict: 'workspace_id,account_id,date' })
      if (error && /revenue|cpm/.test(error.message)) {
        // migration 0033 ainda não rodada — pula sem derrubar o resto
        error = null
      }
      if (!error) revenueOk = true
    }
    if (revByVideo && revByVideo.size > 0) {
      for (const [vid, revenue] of revByVideo) {
        const postId = postIdByExternal.get(vid)
        if (!postId) continue
        await supabase.from('organic_posts').update({ revenue }).eq('id', postId)
          .then(({ error }) => { if (error && !/revenue/.test(error.message)) console.warn('[sync-youtube] revenue post:', error.message) })
      }
      revenueOk = true
    }
  } catch (e) {
    console.warn('[sync-youtube] receita:', (e as Error).message)
  }

  try {
    const demoStart = brazilDateStr(28)
    const [demo, devices] = await Promise.all([
      fetchDemographics(accessToken, demoStart, todayStr),
      fetchDeviceTypes(accessToken, demoStart, todayStr),
    ])
    const snaps: Array<Record<string, unknown>> = []
    if (demo.length > 0) snaps.push({ workspace_id: workspaceId, account_id: account.id, captured_on: todayStr, kind: 'reached', breakdown: { demographics: demo } })
    if (Object.keys(devices).length > 0) snaps.push({ workspace_id: workspaceId, account_id: account.id, captured_on: todayStr, kind: 'device', breakdown: devices })
    if (snaps.length > 0) {
      await supabase.from('organic_audience_snapshots')
        .upsert(snaps, { onConflict: 'workspace_id,account_id,captured_on,kind' })
    }
  } catch (e) {
    console.warn('[sync-youtube] audiência:', (e as Error).message)
  }

  // ── 5) Reporting (impressões/CTR) ─────────────────────────────────────────
  let csvsProcessed = 0
  try {
    let jobs = (meta.reporting_jobs ?? {}) as Record<string, string>
    if (Object.keys(jobs).length === 0) {
      jobs = await ensureReportingJobs(accessToken)
      meta.reporting_jobs = jobs
    }
    const createdAfter = typeof meta.reports_synced_until === 'string' ? meta.reports_synced_until : undefined
    let maxCreateTime = createdAfter ?? ''
    const touchedPosts = new Set<string>()

    for (const jobId of Object.values(jobs)) {
      const reports = await listNewReports(accessToken, jobId, createdAfter)
      for (const report of reports.slice(0, MAX_CSVS_PER_RUN - csvsProcessed)) {
        const rows = await downloadReportCsv(accessToken, report.downloadUrl)
        // agrega por (date, video_id) — o CSV pode ter mais dimensões
        const agg = new Map<string, { impressions: number; weighted: number }>()
        for (const r of rows) {
          const vid = r.video_id
          const imp = Number(r.video_thumbnail_impressions ?? '')
          if (!vid || !Number.isFinite(imp)) continue
          const date = ymdFromReporting(r.date ?? '')
          const ctr = Number(r.video_thumbnail_impressions_ctr ?? '')
          const key = `${date}|${vid}`
          const cur = agg.get(key) ?? { impressions: 0, weighted: 0 }
          cur.impressions += imp
          cur.weighted += Number.isFinite(ctr) ? ctr * imp : 0
          agg.set(key, cur)
        }
        const dailyRows: Array<Record<string, unknown>> = []
        for (const [key, v] of agg) {
          const [date, vid] = key.split('|')
          const postId = postIdByExternal.get(vid)
          if (!postId || !date) continue
          touchedPosts.add(postId)
          dailyRows.push({
            workspace_id: workspaceId, post_id: postId, date, source: 'reporting',
            impressions: v.impressions,
            impressions_ctr: v.impressions > 0 ? v.weighted / v.impressions : null,
          })
        }
        for (let i = 0; i < dailyRows.length; i += 500) {
          const { error } = await supabase.from('organic_post_metrics_daily')
            .upsert(dailyRows.slice(i, i + 500), { onConflict: 'workspace_id,post_id,date' })
          if (error) throw new Error(`reporting daily: ${error.message}`)
        }
        csvsProcessed++
        if (report.createTime > maxCreateTime) maxCreateTime = report.createTime
        if (csvsProcessed >= MAX_CSVS_PER_RUN) break
      }
      if (csvsProcessed >= MAX_CSVS_PER_RUN) break
    }

    // agregado lifetime de impressões nos posts tocados
    if (touchedPosts.size > 0) {
      const ids = [...touchedPosts]
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100)
        const { data } = await supabase.from('organic_post_metrics_daily')
          .select('post_id, impressions, impressions_ctr')
          .in('post_id', batch).not('impressions', 'is', null)
        const byPost = new Map<string, { imp: number; weighted: number }>()
        for (const r of (data ?? []) as Array<{ post_id: string; impressions: number; impressions_ctr: number | null }>) {
          const cur = byPost.get(r.post_id) ?? { imp: 0, weighted: 0 }
          cur.imp += r.impressions
          cur.weighted += (r.impressions_ctr ?? 0) * r.impressions
          byPost.set(r.post_id, cur)
        }
        for (const [postId, v] of byPost) {
          await supabase.from('organic_posts').update({
            impressions: v.imp,
            impressions_ctr: v.imp > 0 ? v.weighted / v.imp : null,
          }).eq('id', postId)
        }
      }
    }
    if (maxCreateTime) meta.reports_synced_until = maxCreateTime
  } catch (e) {
    console.warn('[sync-youtube] reporting:', (e as Error).message)
  }

  await supabase.from('organic_accounts').update({
    status: 'active', last_error: null, last_sync_at: new Date().toISOString(), meta,
  }).eq('id', account.id)

  return { videos: metas.length, detalhe: detailOk, csvs: csvsProcessed, receita: revenueOk }
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const url = new URL(req.url)
  const daysParam = parseInt(url.searchParams.get('days') ?? '7', 10)
  const days = Number.isFinite(daysParam) ? Math.min(90, Math.max(1, daysParam)) : 7
  const sinceStr = brazilDateStr(days)
  const todayStr = brazilDateStr(0)

  const supabase = db()
  // `?ws=` restringe a UM workspace (botão "Sincronizar agora" do admin).
  const wsParam = url.searchParams.get('ws')
  let workspaceIds: string[]
  if (wsParam && /^[0-9a-f-]{36}$/i.test(wsParam)) {
    workspaceIds = [wsParam]
  } else {
    const defaultWs = await getActiveWorkspaceId()
    const credWs = await listWorkspacesWithProvider('youtube')
    workspaceIds = [...new Set([defaultWs, ...credWs])]
  }

  const results: Record<string, unknown> = {}

  for (const workspaceId of workspaceIds) {
    const cfg = await getYoutubeConfig(workspaceId)
    if (!cfg) {
      results[workspaceId] = { skipped: 'YouTube não configurado' }
      continue
    }

    const { data: accountRows, error: accErr } = await supabase.from('organic_accounts')
      .select('id, external_id, status, meta')
      .eq('workspace_id', workspaceId).eq('platform', 'youtube').neq('status', 'disconnected')
    if (accErr) {
      results[workspaceId] = { erro: `organic_accounts: ${accErr.message}` }
      continue
    }
    let accounts = (accountRows ?? []) as AccountRow[]

    // Bootstrap: token no env/credencial mas conta ainda não registrada (ex:
    // DEMO via YOUTUBE_REFRESH_TOKEN antes do fluxo OAuth) → cria a conta.
    const known = new Set(accounts.map((a) => a.external_id))
    for (const tokenKey of Object.keys(cfg.tokens)) {
      if (tokenKey !== '*' && known.has(tokenKey)) continue
      if (tokenKey === '*' && accounts.length > 0) continue
      try {
        const accessToken = await refreshAccessToken({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: cfg.tokens[tokenKey] })
        const ch = await fetchMyChannel(accessToken)
        if (!ch || known.has(ch.id)) continue
        const { data: inserted, error } = await supabase.from('organic_accounts').upsert({
          workspace_id: workspaceId, platform: 'youtube', external_id: ch.id,
          handle: ch.title, display_name: ch.title, avatar_url: ch.thumbnailUrl,
          status: 'active', meta: { uploads_playlist_id: ch.uploadsPlaylistId },
        }, { onConflict: 'workspace_id,platform,external_id' }).select('id, external_id, status, meta').single()
        if (!error && inserted) {
          accounts.push(inserted as AccountRow)
          known.add(ch.id)
        }
      } catch (e) {
        console.warn(`[sync-youtube] bootstrap ${tokenKey}:`, (e as Error).message)
      }
    }

    if (accounts.length === 0) {
      results[workspaceId] = { skipped: 'nenhum canal conectado' }
      continue
    }

    for (const account of accounts) {
      const resKey = `${workspaceId}:${account.external_id}`
      try {
        console.log(`[sync-youtube] ws=${workspaceId} canal=${account.external_id} janela=${sinceStr}..${todayStr}`)
        results[resKey] = await syncAccount({ supabase, workspaceId, account, cfg, sinceStr, todayStr })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[sync-youtube] ❌ ${resKey}:`, msg)
        await supabase.from('organic_accounts')
          .update({ last_error: msg, last_sync_at: new Date().toISOString() })
          .eq('id', account.id)
        results[resKey] = { erro: msg }
      }
    }
  }

  revalidateTag('sb-organico', 'max')

  return NextResponse.json({ range: { from: sinceStr, to: todayStr }, days, contas: results })
}
