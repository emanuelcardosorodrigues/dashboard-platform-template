/**
 * Callback do OAuth do Instagram (orgânico).
 *
 * code → user token → LONG-LIVED user token → Páginas com conta IG
 * profissional → PAGE TOKENS (não expiram enquanto o user token vale).
 * Conecta TODAS as contas IG encontradas (o admin desconecta as que sobrarem).
 * Tokens cifrados no workspace DO STATE; organic_accounts upsertadas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { audit } from '@/lib/audit'
import { verifyState, appBaseUrl, OAUTH_NONCE_COOKIE } from '@/lib/organico/oauthState'
import { getWorkspaceCredential, setWorkspaceCredential } from '@/lib/integrations/credentials'
import { exchangeCodeForUserToken, toLongLivedToken, listIgAccounts } from '@/lib/organico/instagram'

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
    NextResponse.redirect(`${base}/admin/projetos${ws ? `/${ws}` : ''}?ig_erro=${code}`)

  const state = verifyState(req.nextUrl.searchParams.get('state'))
  const nonceCookie = jar.get(OAUTH_NONCE_COOKIE)?.value
  if (!state || !nonceCookie || state.nonce !== nonceCookie) return fail(null, 'state')

  const ws = state.ws
  if (req.nextUrl.searchParams.get('error')) return fail(ws, 'negado')
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return fail(ws, 'sem_code')

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return fail(ws, 'env')

  try {
    const shortToken = await exchangeCodeForUserToken({
      appId, appSecret, code,
      redirectUri: `${base}/api/oauth/instagram/callback`,
    })
    const userToken = await toLongLivedToken({ appId, appSecret, token: shortToken })
    const igAccounts = await listIgAccounts(userToken)
    if (igAccounts.length === 0) return fail(ws, 'sem_conta_ig')

    // Merge no mapa (não clobbera contas IG já conectadas de OUTRO login)
    const existing = await getWorkspaceCredential<{ tokens?: Record<string, string> }>(ws, 'instagram')
    const tokens: Record<string, string> = { ...(existing?.secret?.tokens ?? {}), __user: userToken }
    for (const acc of igAccounts) tokens[acc.igUserId] = acc.pageToken
    await setWorkspaceCredential(ws, 'instagram', { tokens }, {
      accounts: Object.keys(tokens).filter((k) => k !== '__user'),
    })

    const supabase = db()
    for (const acc of igAccounts) {
      const { error } = await supabase.from('organic_accounts').upsert({
        workspace_id: ws,
        platform: 'instagram',
        external_id: acc.igUserId,
        handle: acc.username,
        display_name: acc.name ?? acc.username,
        avatar_url: acc.avatarUrl,
        status: 'active',
        last_error: null,
        meta: { page_id: acc.pageId, followers_at_connect: acc.followersCount },
      }, { onConflict: 'workspace_id,platform,external_id' })
      if (error) throw new Error(error.message)
    }

    await audit({
      action: 'admin.organico.connect', actorRole: 'admin', actorLabel: session.user_id,
      resource: ws, metadata: { platform: 'instagram', accounts: igAccounts.map((a) => a.username) },
    }).catch(() => {})

    const res = NextResponse.redirect(`${base}/admin/projetos/${ws}?ig=ok&n=${igAccounts.length}`)
    res.cookies.delete(OAUTH_NONCE_COOKIE)
    return res
  } catch (e) {
    console.error('[oauth-instagram] callback falhou:', (e as Error).message)
    return fail(ws, 'troca')
  }
}
