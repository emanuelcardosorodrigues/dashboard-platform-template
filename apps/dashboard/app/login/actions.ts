'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { createSession, revokeSession, SESSION_TTL_MS } from '@/lib/sessions'
import { verifyPassword } from '@/lib/passwords'
import { log } from '@/lib/log'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rateLimit'

const ATTEMPTS_COOKIE = 'lst_attempts'
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

interface AttemptsPayload {
  count: number
  lockedUntil: number | null
}

interface UserRow {
  id: string
  email: string
  password_hash: string
  role: 'admin' | 'viewer'
  status: 'active' | 'pending_onboarding' | 'disabled'
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
    log.warn('[login] getServerAttempts falhou — fallback cookie', { err })
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
    log.warn('[login] saveServerAttempts falhou', { err })
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
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
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
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataB64))
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  const cookieStore = await cookies()
  cookieStore.set(ATTEMPTS_COOKIE, `${dataB64}.${sigHex}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60,
    path: '/',
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

async function lookupUserByEmail(email: string): Promise<UserRow | null> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('users')
    .select('id, email, password_hash, role, status')
    .eq('email', email)
    .maybeSingle() as { data: UserRow | null; error: { message: string } | null }
  if (error) {
    log.warn('[login] lookupUserByEmail falhou', { error: error.message })
    return null
  }
  return data
}

export async function loginAction(formData: FormData) {
  const emailRaw = (formData.get('email') as string | null) ?? ''
  const password = (formData.get('password') as string | null) ?? ''
  const from = (formData.get('from') as string | null) ?? '/'

  const email = emailRaw.trim().toLowerCase()
  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret) {
    throw new Error('Servidor mal configurado')
  }

  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const ua = h.get('user-agent') ?? null
  const emailHash = await hashKey(email || 'anon@dashboard')
  const serverKey = `${ip}|${emailHash}`

  // Burst protect (anti-DoS no endpoint /login, independente de credenciais).
  // O lockout por conta continua cuidando de brute force; isso aqui corta floods.
  const burst = await checkRateLimit(`login:ip:${ip}`, 15, 60)
  if (!burst.allowed) {
    await audit({
      action: 'login.burst_blocked',
      status: 'denied',
      ip,
      userAgent: ua,
      resource: '/login',
      metadata: { remaining: burst.remaining },
    })
    redirect(`/login?error=throttled&from=${encodeURIComponent(from)}`)
  }

  const attempts = await mergedAttempts(serverKey, sessionSecret)

  if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
    const minutos = Math.ceil((attempts.lockedUntil - Date.now()) / 60000)
    await audit({
      action: 'login.locked',
      status: 'denied',
      ip,
      userAgent: ua,
      resource: '/login',
      metadata: { minutos_restantes: minutos },
    })
    redirect(`/login?error=locked&min=${minutos}&from=${encodeURIComponent(from)}`)
  }

  let user: UserRow | null = null
  if (email && password && password.length <= 256) {
    user = await lookupUserByEmail(email)
  }

  const passwordOk = user ? await verifyPassword(user.password_hash, password) : false
  const valid = !!user && passwordOk && user.status !== 'disabled'

  if (!valid) {
    const newCount = (attempts.count || 0) + 1
    const lockedUntil = newCount >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null
    await Promise.all([
      saveServerAttempts(serverKey, { count: newCount, lockedUntil }),
      saveCookieAttempts(sessionSecret, { count: newCount, lockedUntil }),
      audit({
        action: lockedUntil ? 'login.lockout_triggered' : 'login.failed',
        status: 'denied',
        ip,
        userAgent: ua,
        resource: '/login',
        metadata: { count: newCount, email_present: !!email },
      }),
    ])

    if (lockedUntil) {
      redirect(`/login?error=locked&min=15&from=${encodeURIComponent(from)}`)
    }
    redirect(`/login?error=1&attempts=${newCount}&from=${encodeURIComponent(from)}`)
  }

  // valid == true a partir daqui — narrow user.
  const u = user!

  await Promise.all([
    saveServerAttempts(serverKey, { count: 0, lockedUntil: null }),
    saveCookieAttempts(sessionSecret, { count: 0, lockedUntil: null }),
    audit({
      action: 'login.success',
      actorRole: u.role,
      actorLabel: u.id,
      ip,
      userAgent: ua,
      resource: '/login',
      metadata: { user_id: u.id },
    }),
  ])

  const sessionId = await createSession({ userId: u.id, ip, userAgent: ua })

  const sb = getSupabase()
  await sb.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', u.id)

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })

  if (u.status === 'pending_onboarding') {
    redirect('/onboarding')
  }

  if (u.role === 'viewer') {
    redirect('/visao-geral')
  }
  redirect(isSafeInternalPath(from) ? from : '/visao-geral')
}

const SAFE_PATH_RE = /^\/[a-z][a-z0-9\-/]*$/i

function isSafeInternalPath(value: string): boolean {
  if (!value) return false
  if (value.length > 200) return false
  return SAFE_PATH_RE.test(value)
}

export async function logoutAction() {
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const ua = h.get('user-agent') ?? null
  await audit({ action: 'login.logout', ip, userAgent: ua, resource: '/login' })

  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (sessionId) {
    void revokeSession(sessionId)
  }
  cookieStore.delete(SESSION_COOKIE)
  cookieStore.delete(ATTEMPTS_COOKIE)
  redirect('/login')
}
