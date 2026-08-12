'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rateLimit'
import { log } from '@/lib/log'
import { audit } from '@/lib/audit'

// Mesmo mecanismo de rate limit/lockout do login principal (app/login/actions.ts):
// burst protect via lib/rateLimit.ts (RPC check_rate_limit) + lockout por
// IP+usuário na tabela public.login_attempts (server-authoritative, com fallback
// em cookie HMAC-assinado se o Supabase falhar). Chave prefixada com "nfse:" pra
// não compartilhar orçamento de tentativas com o login principal.

const ATTEMPTS_COOKIE = 'nfse_attempts'
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

// Sessão: token único por login, HMAC-assinado (ver createSessionToken abaixo).
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8h — igual ao maxAge do cookie

interface AttemptsPayload {
  count: number
  lockedUntil: number | null
}

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function hashKey(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function getServerAttempts(key: string): Promise<AttemptsPayload> {
  try {
    const sb = getSupabase()
    const { data } = await sb
      .from('login_attempts')
      .select('count, locked_until')
      .eq('key', key)
      .maybeSingle() as { data: { count: number; locked_until: string | null } | null }
    if (!data) return { count: 0, lockedUntil: null }
    return {
      count: data.count,
      lockedUntil: data.locked_until ? new Date(data.locked_until).getTime() : null,
    }
  } catch (err) {
    log.warn('[nfse-login] getServerAttempts falhou — fallback cookie', { err })
    return { count: 0, lockedUntil: null }
  }
}

async function saveServerAttempts(key: string, payload: AttemptsPayload): Promise<void> {
  try {
    const sb = getSupabase()
    await sb.from('login_attempts').upsert(
      {
        key,
        count: payload.count,
        locked_until: payload.lockedUntil ? new Date(payload.lockedUntil).toISOString() : null,
        last_attempt: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
  } catch (err) {
    log.warn('[nfse-login] saveServerAttempts falhou', { err })
  }
}

async function getCookieAttempts(secret: string): Promise<AttemptsPayload> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(ATTEMPTS_COOKIE)?.value
  if (!raw) return { count: 0, lockedUntil: null }
  try {
    const [dataB64, sigHex] = raw.split('.')
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    )
    const sig = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(dataB64))
    if (!valid) return { count: 0, lockedUntil: null }
    return JSON.parse(atob(dataB64)) as AttemptsPayload
  } catch {
    return { count: 0, lockedUntil: null }
  }
}

async function saveCookieAttempts(secret: string, payload: AttemptsPayload) {
  const dataB64 = btoa(JSON.stringify(payload))
  const sigHex = await hmacSign(secret, dataB64)
  const cookieStore = await cookies()
  cookieStore.set(ATTEMPTS_COOKIE, `${dataB64}.${sigHex}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60,
    path: '/notas-fiscais',
  })
}

async function mergedAttempts(serverKey: string, secret: string): Promise<AttemptsPayload> {
  const [server, cookie] = await Promise.all([
    getServerAttempts(serverKey),
    getCookieAttempts(secret),
  ])
  return {
    count: Math.max(server.count, cookie.count),
    lockedUntil:
      server.lockedUntil && cookie.lockedUntil
        ? Math.max(server.lockedUntil, cookie.lockedUntil)
        : server.lockedUntil ?? cookie.lockedUntil ?? null,
  }
}

/**
 * Sessão com id único por login em vez do NFSE_SESSION_TOKEN estático cru.
 * Formato: "${sessionId}.${issuedAtMs}.${sigHex}", assinado com SESSION_SECRET.
 * layout.tsx recomputa a assinatura e confere expiração (8h) — um token vazado
 * não vale pra sempre feito o token estático antigo, e cada login gera um valor
 * diferente (não é mais o segredo cru trafegando como cookie).
 */
async function createSessionToken(secret: string): Promise<string> {
  const sessionId = crypto.randomUUID()
  const issuedAt = Date.now()
  const payload = `${sessionId}.${issuedAt}`
  const sig = await hmacSign(secret, payload)
  return `${payload}.${sig}`
}

export async function loginNfse(formData: FormData) {
  const user = ((formData.get('user') as string | null) ?? '').trim()
  const pass = (formData.get('pass') as string | null) ?? ''

  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret) {
    throw new Error('Servidor mal configurado')
  }

  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const ua = h.get('user-agent') ?? null
  const userHash = await hashKey(user.toLowerCase() || 'anon@nfse')
  const serverKey = `nfse:${ip}|${userHash}`

  // Burst protect (anti-DoS no endpoint de login das notas fiscais).
  // O lockout por conta abaixo cuida de brute force; isso corta floods.
  const burst = await checkRateLimit(`nfse-login:ip:${ip}`, 15, 60)
  if (!burst.allowed) {
    await audit({
      action: 'nfse_login.burst_blocked',
      status: 'denied',
      ip,
      userAgent: ua,
      resource: '/notas-fiscais/login',
      metadata: { remaining: burst.remaining },
    })
    redirect('/notas-fiscais/login?erro=throttled')
  }

  const attempts = await mergedAttempts(serverKey, sessionSecret)

  if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
    const minutos = Math.ceil((attempts.lockedUntil - Date.now()) / 60000)
    await audit({
      action: 'nfse_login.locked',
      status: 'denied',
      ip,
      userAgent: ua,
      resource: '/notas-fiscais/login',
      metadata: { minutos_restantes: minutos },
    })
    redirect(`/notas-fiscais/login?erro=locked&min=${minutos}`)
  }

  const valid = !!user && !!pass && pass.length <= 256
    && user === process.env.NFSE_ADMIN_USER
    && pass === process.env.NFSE_ADMIN_PASSWORD

  if (!valid) {
    const newCount = (attempts.count || 0) + 1
    const lockedUntil = newCount >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null
    await Promise.all([
      saveServerAttempts(serverKey, { count: newCount, lockedUntil }),
      saveCookieAttempts(sessionSecret, { count: newCount, lockedUntil }),
      audit({
        action: lockedUntil ? 'nfse_login.lockout_triggered' : 'nfse_login.failed',
        status: 'denied',
        ip,
        userAgent: ua,
        resource: '/notas-fiscais/login',
        metadata: { count: newCount, user_present: !!user },
      }),
    ])

    if (lockedUntil) {
      redirect('/notas-fiscais/login?erro=locked&min=15')
    }
    redirect(`/notas-fiscais/login?erro=1&tentativas=${newCount}`)
  }

  await Promise.all([
    saveServerAttempts(serverKey, { count: 0, lockedUntil: null }),
    saveCookieAttempts(sessionSecret, { count: 0, lockedUntil: null }),
    audit({
      action: 'nfse_login.success',
      ip,
      userAgent: ua,
      resource: '/notas-fiscais/login',
    }),
  ])

  const token = await createSessionToken(sessionSecret)
  const store = await cookies()
  store.set('nfse_auth', token, {
    httpOnly: true,
    secure:   true,
    sameSite: 'lax',
    path:     '/notas-fiscais',
    maxAge:   SESSION_TTL_MS / 1000,
  })

  redirect('/notas-fiscais')
}
