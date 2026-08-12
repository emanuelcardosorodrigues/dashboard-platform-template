/**
 * Início do OAuth do YouTube (orgânico) — admin-only.
 *
 * GET /api/oauth/youtube/start?ws=<workspace_id>
 * Redireciona pro consent do Google com:
 *  - access_type=offline + prompt=consent → garante refresh token SEMPRE;
 *  - prompt inclui select_account → dono escolhe a conta/CANAL DE MARCA certo;
 *  - state assinado amarrando o workspace + nonce em cookie httpOnly (CSRF).
 *
 * PRÉ-REQUISITO OPERACIONAL: o OAuth app no Google Cloud precisa estar
 * "In production" — em Testing os refresh tokens morrem em 7 dias.
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { newNonce, signState, appBaseUrl, OAUTH_NONCE_COOKIE } from '@/lib/organico/oauthState'

export const dynamic = 'force-dynamic'

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  // receita/RPM (painel financeiro) — canal precisa estar monetizado pra ter dado
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
].join(' ')

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

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'GOOGLE_OAUTH_CLIENT_ID não configurado no ambiente' },
      { status: 500 },
    )
  }

  const nonce = newNonce()
  const state = signState(ws, nonce)
  const redirectUri = `${appBaseUrl(req)}/api/oauth/youtube/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
  })

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  res.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/api/oauth',
  })
  return res
}
