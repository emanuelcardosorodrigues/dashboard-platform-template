/**
 * Cron: sincroniza Instagram orgânico (media + perfil + audiência) → Supabase.
 *
 * Dispatcher por projeto (padrão sync-meta). Por conta IG conectada:
 *  1. Lista de media (até 200 mais recentes) → upsert organic_posts (metadados).
 *  2. Insights por media pros INSIGHT_LIMIT mais novos (1 call/media, lifetime
 *     snapshot) → atualiza posts e gera DELTA diário (source='snapshot_delta'):
 *     a API do IG não tem série diária por post; o warehouse é o delta entre
 *     snapshots nossos. Delta só quando havia snapshot anterior (gap honesto).
 *  3. Perfil: ontem + hoje (follower_count, views c/ split follower×non-follower
 *     NÍVEL CONTA, reach, engaged, follows/unfollows, link taps) → profile_daily.
 *  4. Domingo: demografia (follower/engaged/reached × age/gender/city) +
 *     online_followers → audience_snapshots.
 *
 * Rate limit BUC ~200 calls/h/conta → contador aborta em MAX_CALLS e reporta
 * 'parcial' (na próxima janela de 6h continua). Roda 4×/dia via pg_cron.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { brazilDateStr } from '@/lib/brazilDate'
import { getInstagramOrganicConfig } from '@/lib/integrations/factory'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'
import {
  fetchMediaList, fetchMediaInsights, fetchProfileDay, fetchDemographics,
  fetchOnlineFollowers, igFormat, type IgMedia,
} from '@/lib/organico/instagram'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Medias mais novas que ganham insights por run (1 call cada). */
const INSIGHT_LIMIT = 40
/** Teto de calls por CONTA por run (BUC ~200/h — folga pros outros usos). */
const MAX_CALLS = 140

interface AccountRow {
  id: string
  external_id: string
  status: string
  meta: Record<string, unknown>
}

const DELTA_KEYS = ['views', 'reach', 'likes', 'comments_count', 'shares', 'saves', 'follows'] as const
type DeltaKey = typeof DELTA_KEYS[number]

async function syncAccount(args: {
  supabase: SupabaseClient
  workspaceId: string
  account: AccountRow
  pageToken: string
  todayStr: string
}): Promise<Record<string, unknown>> {
  const { supabase, workspaceId, account, pageToken, todayStr } = args
  let calls = 0
  const budget = () => { calls++; return calls <= MAX_CALLS }

  // ── 1) Inventário de media ─────────────────────────────────────────────────
  let medias: IgMedia[]
  try {
    medias = await fetchMediaList(pageToken, account.external_id)
    calls += 4
  } catch (e) {
    const msg = (e as Error).message
    const tokenDead = /OAuth|access token|expired|Error validating/i.test(msg)
    await supabase.from('organic_accounts')
      .update({ status: tokenDead ? 'token_expired' : 'active', last_error: msg })
      .eq('id', account.id)
    return { erro: `media list: ${msg}` }
  }

  const baseRecords = medias.map((m) => ({
    workspace_id: workspaceId,
    account_id: account.id,
    platform: 'instagram',
    external_id: m.id,
    format: igFormat(m),
    caption: m.caption?.slice(0, 5000) ?? null,
    thumbnail_url: m.thumbnailUrl,
    permalink: m.permalink,
    published_at: m.timestamp,
    likes: m.likeCount,
    comments_count: m.commentsCount,
    updated_at: new Date().toISOString(),
  }))
  for (let i = 0; i < baseRecords.length; i += 200) {
    const { error } = await supabase.from('organic_posts')
      .upsert(baseRecords.slice(i, i + 200), { onConflict: 'workspace_id,platform,external_id' })
    if (error) throw new Error(`upsert organic_posts: ${error.message}`)
  }

  // Snapshot ANTERIOR (pra delta diário) + mapa external→uuid
  const { data: prevRows, error: prevErr } = await supabase.from('organic_posts')
    .select('id, external_id, views, reach, likes, comments_count, shares, saves, follows')
    .eq('workspace_id', workspaceId).eq('account_id', account.id)
  if (prevErr) throw new Error(`map ids: ${prevErr.message}`)
  const prevByExternal = new Map(
    (prevRows as Array<{ id: string; external_id: string } & Record<DeltaKey, number | null>>)
      .map((r) => [r.external_id, r]),
  )

  // ── 2) Insights por media (mais novas primeiro) + delta diário ────────────
  const newest = [...medias].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, INSIGHT_LIMIT)
  let insightsOk = 0
  const dailyRows: Array<Record<string, unknown>> = []

  for (const m of newest) {
    if (!budget()) break
    const prev = prevByExternal.get(m.id)
    if (!prev) continue
    const ins = await fetchMediaInsights(pageToken, m.id, igFormat(m))
    if (!ins) continue

    const novo: Record<DeltaKey, number | null> = {
      views: ins.views ?? null,
      reach: ins.reach ?? null,
      likes: ins.likes ?? m.likeCount ?? null,
      comments_count: ins.comments ?? m.commentsCount ?? null,
      shares: ins.shares ?? null,
      saves: ins.saved ?? null,
      follows: ins.follows ?? null,
    }

    const patch: Record<string, unknown> = { ...novo }
    if (ins.ig_reels_avg_watch_time != null) patch.avg_watch_time_s = ins.ig_reels_avg_watch_time / 1000
    if (ins.ig_reels_video_view_total_time != null) patch.total_watch_time_s = ins.ig_reels_video_view_total_time / 1000
    if (ins.reels_skip_rate != null) patch.skip_rate = ins.reels_skip_rate
    if (ins.profile_visits != null) patch.profile_visits = ins.profile_visits
    await supabase.from('organic_posts').update(patch).eq('id', prev.id)

    // delta vs snapshot anterior → linha diária de HOJE (acumula no upsert do dia)
    const delta: Record<string, number> = {}
    for (const k of DELTA_KEYS) {
      const antes = prev[k]
      const depois = novo[k]
      if (antes != null && depois != null && depois >= antes) delta[k] = depois - antes
    }
    if (Object.values(delta).some((v) => v > 0)) {
      dailyRows.push({
        workspace_id: workspaceId, post_id: prev.id, date: todayStr, source: 'snapshot_delta',
        views: delta.views ?? null, reach: delta.reach ?? null, likes: delta.likes ?? null,
        comments: delta.comments_count ?? null, shares: delta.shares ?? null,
        saves: delta.saves ?? null, follows: delta.follows ?? null,
      })
    }
    insightsOk++
  }

  if (dailyRows.length > 0) {
    const { error } = await supabase.from('organic_post_metrics_daily')
      .upsert(dailyRows, { onConflict: 'workspace_id,post_id,date' })
    if (error) console.warn('[sync-instagram] daily delta:', error.message)
  }

  // ── 3) Perfil: ontem + hoje ────────────────────────────────────────────────
  let profileOk = 0
  for (const day of [brazilDateStr(1), todayStr]) {
    if (!budget()) break
    calls += 5
    try {
      const p = await fetchProfileDay(pageToken, account.external_id, day)
      const { error } = await supabase.from('organic_profile_daily').upsert({
        workspace_id: workspaceId, account_id: account.id, date: p.date,
        followers: p.followers, views: p.views,
        views_followers: p.viewsFollowers, views_non_followers: p.viewsNonFollowers,
        reach: p.reach, accounts_engaged: p.accountsEngaged,
        follows: p.follows, unfollows: p.unfollows, link_taps: p.linkTaps,
      }, { onConflict: 'workspace_id,account_id,date' })
      if (!error) profileOk++
    } catch (e) {
      console.warn(`[sync-instagram] perfil ${day}:`, (e as Error).message)
    }
  }

  // ── 4) Audiência (domingo) ─────────────────────────────────────────────────
  const isSunday = new Date(`${todayStr}T12:00:00-03:00`).getDay() === 0
  if (isSunday && budget()) {
    try {
      const [age, city, online] = await Promise.all([
        fetchDemographics(pageToken, account.external_id, 'follower_demographics', 'age'),
        fetchDemographics(pageToken, account.external_id, 'follower_demographics', 'city'),
        fetchOnlineFollowers(pageToken, account.external_id),
      ])
      calls += 3
      const snaps: Array<Record<string, unknown>> = []
      if (Object.keys(age).length > 0 || Object.keys(city).length > 0) {
        snaps.push({ workspace_id: workspaceId, account_id: account.id, captured_on: todayStr, kind: 'follower', breakdown: { age, city } })
      }
      if (Object.keys(online).length > 0) {
        snaps.push({ workspace_id: workspaceId, account_id: account.id, captured_on: todayStr, kind: 'online_times', breakdown: online })
      }
      if (snaps.length > 0) {
        await supabase.from('organic_audience_snapshots')
          .upsert(snaps, { onConflict: 'workspace_id,account_id,captured_on,kind' })
      }
    } catch (e) {
      console.warn('[sync-instagram] audiência:', (e as Error).message)
    }
  }

  await supabase.from('organic_accounts').update({
    status: 'active', last_error: null, last_sync_at: new Date().toISOString(),
  }).eq('id', account.id)

  return {
    medias: medias.length, insights: insightsOk, daily: dailyRows.length,
    perfil: profileOk, calls, ...(calls > MAX_CALLS ? { parcial: 'budget de rate limit atingido' } : {}),
  }
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

  const todayStr = brazilDateStr(0)
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  const url = new URL(req.url)
  const wsParam = url.searchParams.get('ws')
  let workspaceIds: string[]
  if (wsParam && /^[0-9a-f-]{36}$/i.test(wsParam)) {
    workspaceIds = [wsParam]
  } else {
    const defaultWs = await getActiveWorkspaceId()
    const credWs = await listWorkspacesWithProvider('instagram')
    workspaceIds = [...new Set([defaultWs, ...credWs])]
  }

  const results: Record<string, unknown> = {}

  for (const workspaceId of workspaceIds) {
    const cfg = await getInstagramOrganicConfig(workspaceId)
    if (!cfg) {
      results[workspaceId] = { skipped: 'Instagram não configurado' }
      continue
    }

    const { data: accountRows, error: accErr } = await supabase.from('organic_accounts')
      .select('id, external_id, status, meta')
      .eq('workspace_id', workspaceId).eq('platform', 'instagram').neq('status', 'disconnected')
    if (accErr) {
      results[workspaceId] = { erro: `organic_accounts: ${accErr.message}` }
      continue
    }

    for (const account of (accountRows ?? []) as AccountRow[]) {
      const resKey = `${workspaceId}:${account.external_id}`
      const pageToken = cfg.tokens[account.external_id]
      if (!pageToken) {
        await supabase.from('organic_accounts')
          .update({ status: 'token_expired', last_error: 'sem page token pra esta conta' })
          .eq('id', account.id)
        results[resKey] = { erro: 'sem page token' }
        continue
      }
      try {
        console.log(`[sync-instagram] ws=${workspaceId} conta=@${account.external_id}`)
        results[resKey] = await syncAccount({ supabase, workspaceId, account, pageToken, todayStr })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[sync-instagram] ❌ ${resKey}:`, msg)
        await supabase.from('organic_accounts')
          .update({ last_error: msg, last_sync_at: new Date().toISOString() })
          .eq('id', account.id)
        results[resKey] = { erro: msg }
      }
    }
  }

  revalidateTag('sb-organico', 'max')

  return NextResponse.json({ date: todayStr, contas: results })
}
