/**
 * Início do OAuth do Instagram (orgânico) — admin-only.
 *
 * GET /api/oauth/instagram/start?ws=<workspace_id>
 * Flavor FACEBOOK LOGIN (exigido pra story_insights webhook): a conta IG
 * profissional precisa estar vinculada a uma Página do Facebook. Scopes de
 * leitura de insights + comentários (pra Onda 5) numa tacada só.
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { newNonce, signState, appBaseUrl, OAUTH_NONCE_COOKIE } from '@/lib/organico/oauthState'

export const dynamic = 'force-dynamic'

const SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_manage_comments',
  'pages_show_list',
  'pages_read_engagement',
].join(',')

export async function GET(req: NextRequest) {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ws = req.nextUrl.searchParams.get('ws') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(ws)) {
    return NextResponse.json({ error: 'ws inválido' }, { status: 400 })
  }

  const appId = process.env.META_APP_ID
  if (!appId) {
    return NextResponse.json({ error: 'META_APP_ID não configurado no ambiente' }, { status: 500 })
  }

  const nonce = newNonce()
  const state = signState(ws, nonce)
  const redirectUri = `${appBaseUrl(req)}/api/oauth/instagram/callback`

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  })

  const res = NextResponse.redirect(`https://www.facebook.com/v20.0/dialog/oauth?${params}`)
  res.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/api/oauth',
  })
  return res
}
