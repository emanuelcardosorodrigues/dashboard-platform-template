/**
 * Callback do OAuth do YouTube (orgânico).
 *
 * Valida state (assinatura + exp + nonce do cookie), troca o code por tokens,
 * descobre o canal (channels.list mine=true), MERGEIA o refresh token no mapa
 * { tokens: { [channelId]: token } } da credencial cifrada do WORKSPACE DO
 * STATE, upserta organic_accounts e cria os Reporting jobs NA HORA — o
 * backfill (~30d) de impressões só é gerado na criação do job.
 *
 * Erros voltam pro admin via redirect ?yt_erro=<code> (nunca página branca).
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { audit } from '@/lib/audit'
import { verifyState, appBaseUrl, OAUTH_NONCE_COOKIE } from '@/lib/organico/oauthState'
import { getWorkspaceCredential, setWorkspaceCredential } from '@/lib/integrations/credentials'
import { exchangeCodeForTokens, fetchMyChannel, ensureReportingJobs } from '@/lib/organico/youtube'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(req: NextRequest) {
  const jar = await cookies()
  const sessionId = jar.get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const base = appBaseUrl(req)
  const fail = (ws: string | null, code: string) =>
    NextResponse.redirect(`${base}/admin/projetos${ws ? `/${ws}` : ''}?yt_erro=${code}`)

  const state = verifyState(req.nextUrl.searchParams.get('state'))
  const nonceCookie = jar.get(OAUTH_NONCE_COOKIE)?.value
  if (!state || !nonceCookie || state.nonce !== nonceCookie) return fail(null, 'state')

  const ws = state.ws
  if (req.nextUrl.searchParams.get('error')) return fail(ws, 'negado')
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return fail(ws, 'sem_code')

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return fail(ws, 'env')

  try {
    const { accessToken, refreshToken } = await exchangeCodeForTokens({
      clientId, clientSecret, code,
      redirectUri: `${base}/api/oauth/youtube/callback`,
    })
    // prompt=consent garante refresh_token; se vier null algo está errado — não
    // gravar credencial capada que morreria em 1h.
    if (!refreshToken) return fail(ws, 'sem_refresh')

    const channel = await fetchMyChannel(accessToken)
    if (!channel) return fail(ws, 'sem_canal')

    // Merge no mapa multi-canal (não clobbera canais já conectados do projeto).
    const existing = await getWorkspaceCredential<{ tokens?: Record<string, string> }>(ws, 'youtube')
    const tokens = { ...(existing?.secret?.tokens ?? {}), [channel.id]: refreshToken }
    await setWorkspaceCredential(ws, 'youtube', { tokens }, {
      channels: Object.keys(tokens).filter((k) => k !== '*'),
    })

    // Reporting jobs JÁ (backfill só na criação). Falha aqui não aborta a
    // conexão — o cron tenta de novo via ensureReportingJobs.
    let reportingJobs: Record<string, string> = {}
    try {
      reportingJobs = await ensureReportingJobs(accessToken)
    } catch (e) {
      console.warn('[oauth-youtube] reporting jobs falharam (cron retenta):', (e as Error).message)
    }

    const { error } = await db().from('organic_accounts').upsert({
      workspace_id: ws,
      platform: 'youtube',
      external_id: channel.id,
      handle: channel.title,
      display_name: channel.title,
      avatar_url: channel.thumbnailUrl,
      status: 'active',
      last_error: null,
      meta: {
        uploads_playlist_id: channel.uploadsPlaylistId,
        reporting_jobs: reportingJobs,
        subscriber_count_at_connect: channel.subscriberCount,
        video_count_at_connect: channel.videoCount,
      },
    }, { onConflict: 'workspace_id,platform,external_id' })
    if (error) throw new Error(error.message)

    await audit({
      action: 'admin.organico.connect', actorRole: 'admin', actorLabel: session.user_id,
      resource: ws, metadata: { platform: 'youtube', channel: channel.id, title: channel.title },
    }).catch(() => {})

    const res = NextResponse.redirect(`${base}/admin/projetos/${ws}?yt=ok`)
    res.cookies.delete(OAUTH_NONCE_COOKIE)
    return res
  } catch (e) {
    console.error('[oauth-youtube] callback falhou:', (e as Error).message)
    return fail(ws, 'troca')
  }
}
