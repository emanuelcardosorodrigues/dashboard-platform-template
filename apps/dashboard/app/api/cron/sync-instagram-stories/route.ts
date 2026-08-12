/**
 * Cron: poll dos STORIES vivos do Instagram → Supabase (3/3h via pg_cron).
 *
 * Por que separado do sync-instagram: insights de story só existem ENQUANTO o
 * story está vivo (24h). O poll de 3/3h captura o progresso; o webhook
 * story_insights (app/api/webhook/instagram) grava os números FINAIS na
 * expiração. Story que passou de expires_at sem webhook é finalizado aqui com
 * o último poll (dado parcial honesto > dado nenhum).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { getInstagramOrganicConfig } from '@/lib/integrations/factory'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'
import { fetchLiveStories, fetchStoryInsights } from '@/lib/organico/instagram'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

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
  const nowIso = new Date().toISOString()

  for (const workspaceId of workspaceIds) {
    const cfg = await getInstagramOrganicConfig(workspaceId)
    if (!cfg) {
      results[workspaceId] = { skipped: 'Instagram não configurado' }
      continue
    }

    const { data: accountRows } = await supabase.from('organic_accounts')
      .select('id, external_id, status')
      .eq('workspace_id', workspaceId).eq('platform', 'instagram').neq('status', 'disconnected')

    for (const account of (accountRows ?? []) as Array<{ id: string; external_id: string }>) {
      const resKey = `${workspaceId}:${account.external_id}`
      const pageToken = cfg.tokens[account.external_id]
      if (!pageToken) {
        results[resKey] = { erro: 'sem page token' }
        continue
      }
      try {
        // 1) stories vivos agora → upsert básico
        const lives = await fetchLiveStories(pageToken, account.external_id)
        for (const s of lives) {
          const publishedAt = new Date(s.timestamp)
          const { error } = await supabase.from('organic_stories').upsert({
            workspace_id: workspaceId,
            account_id: account.id,
            external_id: s.id,
            media_type: s.mediaType,
            thumbnail_url: s.thumbnailUrl,
            permalink: s.permalink,
            published_at: s.timestamp,
            expires_at: new Date(publishedAt.getTime() + 24 * 3600 * 1000).toISOString(),
          }, { onConflict: 'workspace_id,external_id', ignoreDuplicates: false })
          if (error) console.warn('[sync-ig-stories] upsert story:', error.message)
        }

        // 2) poll de insights dos não-finalizados ainda vivos
        const { data: openRows } = await supabase.from('organic_stories')
          .select('id, external_id, expires_at')
          .eq('workspace_id', workspaceId).eq('account_id', account.id)
          .eq('finalized', false)
        let polled = 0
        let finalizedStale = 0
        for (const row of (openRows ?? []) as Array<{ id: string; external_id: string; expires_at: string | null }>) {
          const stillLive = row.expires_at != null && row.expires_at > nowIso
          if (stillLive) {
            const ins = await fetchStoryInsights(pageToken, row.external_id)
            if (ins) {
              await supabase.from('organic_stories').update({
                views: ins.views, reach: ins.reach, replies: ins.replies, shares: ins.shares,
                profile_visits: ins.profileVisits, follows: ins.follows,
                taps_forward: ins.tapsForward, taps_back: ins.tapsBack,
                exits: ins.exits, swipes_forward: ins.swipesForward,
                last_polled_at: nowIso,
              }).eq('id', row.id)
            } else {
              await supabase.from('organic_stories').update({ last_polled_at: nowIso }).eq('id', row.id)
            }
            polled++
          } else {
            // expirou sem webhook → finaliza com o último poll (parcial honesto)
            await supabase.from('organic_stories').update({ finalized: true }).eq('id', row.id)
            finalizedStale++
          }
        }

        results[resKey] = { vivos: lives.length, polled, finalizados_sem_webhook: finalizedStale }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[sync-ig-stories] ❌ ${resKey}:`, msg)
        results[resKey] = { erro: msg }
      }
    }
  }

  revalidateTag('sb-organico', 'max')

  return NextResponse.json({ contas: results })
}
