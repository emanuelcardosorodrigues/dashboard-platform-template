'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession, invalidateSessionCache } from '@/lib/sessions'
import { hashPassword, verifyPassword } from '@/lib/passwords'
import { audit } from '@/lib/audit'

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function meta() {
  const h = await headers()
  return {
    ip: (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown',
    ua: h.get('user-agent') ?? null,
  }
}

export async function completeOnboardingAction(formData: FormData): Promise<void> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (!sessionId) redirect('/login?error=session_expired')

  const session = await lookupSession(sessionId)
  if (!session) redirect('/login?error=session_expired')
  if (session.status !== 'pending_onboarding') {
    redirect('/visao-geral')
  }

  const current = (formData.get('current_password') as string) || ''
  const next1 = (formData.get('new_password') as string) || ''
  const next2 = (formData.get('confirm_password') as string) || ''

  if (next1.length < 10) {
    redirect('/onboarding?error=short')
  }
  if (next1 !== next2) {
    redirect('/onboarding?error=mismatch')
  }
  if (next1 === current) {
    redirect('/onboarding?error=same')
  }

  const sb = db()
  const { data: row } = await sb
    .from('users')
    .select('password_hash')
    .eq('id', session.user_id)
    .maybeSingle() as { data: { password_hash: string } | null }
  if (!row) redirect('/login?error=session_expired')

  const currentOk = await verifyPassword(row.password_hash, current)
  if (!currentOk) {
    const m = await meta()
    await audit({
      action: 'onboarding.failed',
      actorRole: session.role,
      actorLabel: session.user_id,
      ip: m.ip,
      userAgent: m.ua,
      resource: '/onboarding',
      metadata: { reason: 'wrong_current_password' },
    })
    redirect('/onboarding?error=wrong_current')
  }

  const newHash = await hashPassword(next1)
  const { error } = await sb
    .from('users')
    .update({
      password_hash: newHash,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.user_id)

  if (error) {
    redirect(`/onboarding?error=db&msg=${encodeURIComponent(error.message.slice(0, 80))}`)
  }

  invalidateSessionCache(sessionId)

  const m = await meta()
  await audit({
    action: 'onboarding.complete',
    actorRole: session.role,
    actorLabel: session.user_id,
    ip: m.ip,
    userAgent: m.ua,
    resource: '/onboarding',
    metadata: { user_id: session.user_id },
  })

  if (session.role === 'admin') {
    redirect('/visao-geral')
  }
  const first = session.allowed_paths.includes('/visao-geral')
    ? '/visao-geral'
    : session.allowed_paths[0] ?? '/login?error=no_access'
  redirect(first)
}
