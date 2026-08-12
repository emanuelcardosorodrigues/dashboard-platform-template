/**
 * State assinado dos fluxos OAuth do Orgânico (YouTube/Instagram/TikTok).
 *
 * O `state` amarra o WORKSPACE à autorização (o callback grava a credencial no
 * workspace do state, nunca no do cookie — evita gravar no projeto errado se o
 * admin trocar de projeto no meio) e carrega um nonce que precisa bater com o
 * cookie httpOnly setado no /start (CSRF). HMAC-SHA256 com SESSION_SECRET
 * (fallback CRON_SECRET). Expira em 10 minutos.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const TTL_MS = 10 * 60 * 1000
export const OAUTH_NONCE_COOKIE = 'org_oauth_nonce'

/** Base URL canônica do app (redirect_uri do OAuth precisa ser EXATA e
 *  registrada no console da plataforma) — env primeiro, origin como fallback. */
export function appBaseUrl(req: { nextUrl: { origin: string } }): string {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
}

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.CRON_SECRET
  if (!s) throw new Error('SESSION_SECRET/CRON_SECRET ausentes — state OAuth não pode ser assinado')
  return s
}

function hmac(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export interface OauthStatePayload {
  ws: string
  nonce: string
  exp: number
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url')
}

export function signState(ws: string, nonce: string): string {
  const payload = Buffer.from(JSON.stringify({ ws, nonce, exp: Date.now() + TTL_MS } satisfies OauthStatePayload)).toString('base64url')
  return `${payload}.${hmac(payload)}`
}

/** null = inválido/expirado/assinatura errada (sempre falha fechado). */
export function verifyState(state: string | null): OauthStatePayload | null {
  if (!state) return null
  const dot = state.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const expected = hmac(payload)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OauthStatePayload
    if (!parsed.ws || !parsed.nonce || typeof parsed.exp !== 'number') return null
    if (Date.now() > parsed.exp) return null
    return parsed
  } catch {
    return null
  }
}
