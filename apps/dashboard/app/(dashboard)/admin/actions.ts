'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { SESSION_COOKIE, DASHBOARD_PATHS } from '@/lib/auth'
import { sanitizeDomainIds } from '@/lib/access'
import { lookupSession, revokeSession } from '@/lib/sessions'
import { hashPassword, generateTempPassword } from '@/lib/passwords'
import { audit } from '@/lib/audit'
import { sendTempPasswordEmail } from '@/lib/email'

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function requireAdmin() {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session || session.role !== 'admin') {
    redirect('/visao-geral')
  }
  return session
}

async function meta() {
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const ua = h.get('user-agent') ?? null
  return { ip, ua }
}

async function currentLoginUrl(): Promise<string> {
  const h = await headers()
  const host = h.get('host') || 'dash-demo.usuario-exemplo.com.br'
  const proto = h.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}/login`
}

function validEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 200
}

const VALID_PATHS_SET = new Set<string>(DASHBOARD_PATHS as readonly string[])

function sanitizeAllowedPaths(raw: FormDataEntryValue[]): string[] {
  const set = new Set<string>()
  for (const v of raw) {
    const s = String(v).trim()
    if (VALID_PATHS_SET.has(s)) set.add(s)
  }
  return [...set]
}

function sanitizeDefaultFilters(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  const funil = (formData.get('default_funil') as string | null)?.trim()
  const conta = (formData.get('default_conta') as string | null)?.trim()
  const de = (formData.get('default_de') as string | null)?.trim()
  const ate = (formData.get('default_ate') as string | null)?.trim()
  if (funil && /^[a-z0-9_-]{1,30}$/i.test(funil)) out.funil = funil
  if (conta && /^[a-z0-9]{1,30}$/i.test(conta)) out.conta = conta
  if (de && /^\d{4}-\d{2}-\d{2}$/.test(de)) out.de = de
  if (ate && /^\d{4}-\d{2}-\d{2}$/.test(ate)) out.ate = ate
  return out
}

// Presets pra simplificar criação inicial.
const PRESET_PATHS: Record<string, string[]> = {
  todas: [...DASHBOARD_PATHS],
  // Novos usuários recebem Cards/Histórico pela rota consolidada. Grants legados
  // continuam válidos por sub-aba e não são migrados silenciosamente.
  basico: ['/visao-geral', '/calculadora', '/criativos-ia', '/campanhas', '/funil', '/financeiro'],
  vazio: [],
}

export async function createUserAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const email = ((formData.get('email') as string) || '').trim().toLowerCase()
  const name = ((formData.get('name') as string) || '').trim().slice(0, 120)
  const role = (formData.get('role') as string) === 'admin' ? 'admin' : 'viewer'
  const preset = (formData.get('preset') as string) || (role === 'admin' ? 'todas' : 'basico')

  if (!validEmail(email)) {
    redirect('/admin/new?error=email')
  }

  const sb = db()
  const { data: existing } = await sb
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle() as { data: { id: string } | null }
  if (existing) {
    redirect('/admin/new?error=duplicate')
  }

  const tempPassword = generateTempPassword(12)
  const passwordHash = await hashPassword(tempPassword)
  const id = randomUUID()
  const allowedPaths = PRESET_PATHS[preset] ?? PRESET_PATHS.basico

  const { error } = await sb.from('users').insert({
    id,
    email,
    name: name || null,
    role,
    status: 'pending_onboarding',
    password_hash: passwordHash,
    ai_config: {},
    allowed_paths: allowedPaths,
    default_filters: {},
  })

  if (error) {
    redirect(`/admin/new?error=db&msg=${encodeURIComponent(error.message.slice(0, 80))}`)
  }

  const m = await meta()
  await audit({
    action: 'admin.user.create',
    actorRole: 'admin',
    actorLabel: me.user_id,
    ip: m.ip,
    userAgent: m.ua,
    resource: '/admin/users',
    metadata: { actor_user_id: me.user_id, target_user_id: id, email, role, preset },
  })

  const emailResult = await sendTempPasswordEmail({
    to: email,
    name: name || null,
    tempPassword,
    loginUrl: await currentLoginUrl(),
  })

  revalidatePath('/admin')
  const emailFlag = emailResult.ok ? '&mailed=1' : emailResult.skipped ? '&mailed=skipped' : '&mailed=failed'
  redirect(`/admin/${id}?created=1&temp=${encodeURIComponent(tempPassword)}${emailFlag}`)
}

export async function updateUserProfileAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const userId = (formData.get('user_id') as string) || ''
  const name = ((formData.get('name') as string) || '').trim().slice(0, 120) || null
  const role = (formData.get('role') as string) === 'admin' ? 'admin' : 'viewer'
  const statusRaw = (formData.get('status') as string) || 'active'
  const status = ['active', 'pending_onboarding', 'disabled'].includes(statusRaw) ? statusRaw : 'active'
  const phone = ((formData.get('phone') as string) || '').trim().slice(0, 30) || null
  const avatarUrl = ((formData.get('avatar_url') as string) || '').trim().slice(0, 500) || null
  const adminNotes = ((formData.get('admin_notes') as string) || '').slice(0, 2000) || null
  const allowedPaths = sanitizeAllowedPaths(formData.getAll('allowed_paths'))
  const defaultFilters = sanitizeDefaultFilters(formData)

  if (!userId) return

  // Self-lockout protection: admin não rebaixa, não desativa e não esvazia
  // o próprio allowed_paths se for o último admin ativo.
  if (userId === me.user_id) {
    if (role !== 'admin') {
      redirect(`/admin/${userId}?error=self_lockout`)
    }
    if (status === 'disabled') {
      redirect(`/admin/${userId}?error=self_lockout`)
    }
  }

  const sb = db()
  // `periodo` (preset de período padrão) é escolhido pelo PRÓPRIO usuário na
  // estrela do Header e não tem campo neste formulário. Sem preservá-lo, salvar
  // o perfil pelo admin apagaria a preferência dele calado.
  const { data: atual, error: leituraErr } = await sb
    .from('users')
    .select('default_filters')
    .eq('id', userId)
    .maybeSingle()
  // Falha na leitura ABORTA. Seguir gravaria `default_filters` sem o `periodo` —
  // exatamente o apagamento silencioso que este bloco existe para evitar, só que
  // mais raro e sem rastro. Melhor o admin ver o erro e tentar de novo.
  if (leituraErr) {
    redirect(`/admin/${userId}?error=db&msg=${encodeURIComponent(leituraErr.message.slice(0, 80))}`)
  }
  const periodoAtual = (atual?.default_filters as Record<string, unknown> | null)?.periodo
  if (typeof periodoAtual === 'string' && periodoAtual) defaultFilters.periodo = periodoAtual

  const { error } = await sb
    .from('users')
    .update({
      name,
      role,
      status,
      phone,
      avatar_url: avatarUrl,
      admin_notes: adminNotes,
      allowed_paths: allowedPaths,
      default_filters: defaultFilters,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    redirect(`/admin/${userId}?error=db&msg=${encodeURIComponent(error.message.slice(0, 80))}`)
  }

  if (status === 'disabled') {
    const { data: sessions } = await sb
      .from('user_sessions')
      .select('id')
      .eq('user_id', userId)
      .is('revoked_at', null) as { data: { id: string }[] | null }
    for (const s of sessions ?? []) {
      await revokeSession(s.id)
    }
  }

  const m = await meta()
  await audit({
    action: 'admin.user.update',
    actorRole: 'admin',
    actorLabel: me.user_id,
    ip: m.ip,
    userAgent: m.ua,
    resource: `/admin/users/${userId}`,
    metadata: {
      actor_user_id: me.user_id,
      target_user_id: userId,
      role,
      status,
      allowed_paths_count: allowedPaths.length,
    },
  })

  revalidatePath(`/admin/${userId}`)
  revalidatePath('/admin')
  redirect(`/admin/${userId}?saved=profile`)
}

export async function updateAiConfigAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const userId = (formData.get('user_id') as string) || ''
  const quotaRaw = parseInt((formData.get('quota_daily') as string) || '0', 10)
  const quota = Math.max(1, Math.min(500, Number.isFinite(quotaRaw) ? quotaRaw : 20))
  const disabled = formData.get('disabled') === 'on'
  const dataDomains = sanitizeDomainIds(formData.getAll('data_domains'))

  if (!userId) return

  const sb = db()

  // Lê o papel do alvo pra decidir se persistimos data_domains. Admin é god-mode
  // (lib/access.ts curto-circuita), então NÃO gravamos domínios pra ele — os
  // checkboxes ficam disabled na UI e um [] gravado seria enganoso.
  const { data: target } = await sb
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle() as { data: { role: 'admin' | 'viewer' } | null }

  const aiConfig: { quota_daily: number; disabled: boolean; data_domains?: string[] } = {
    quota_daily: quota,
    disabled,
  }
  if (target?.role !== 'admin') {
    // [] = explicitamente nenhum domínio (fail-closed). Lista = só os marcados.
    aiConfig.data_domains = dataDomains
  }

  const { error } = await sb
    .from('users')
    .update({
      ai_config: aiConfig,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    redirect(`/admin/${userId}?error=db&msg=${encodeURIComponent(error.message.slice(0, 80))}`)
  }

  const m = await meta()
  await audit({
    action: 'admin.user.ai_config',
    actorRole: 'admin',
    actorLabel: me.user_id,
    ip: m.ip,
    userAgent: m.ua,
    resource: `/admin/users/${userId}/ai`,
    metadata: {
      actor_user_id: me.user_id,
      target_user_id: userId,
      quota_daily: quota,
      disabled,
      data_domains_count: target?.role === 'admin' ? 'all' : dataDomains.length,
    },
  })

  revalidatePath(`/admin/${userId}`)
  redirect(`/admin/${userId}?saved=ai`)
}

/**
 * Senha PADRÃO da operação (env `DEFAULT_USER_PASSWORD`, nunca no git).
 * Sem env configurado o modo "padrão" falha explícito — jamais cai num fallback fraco.
 */
function defaultPassword(): string | null {
  const v = (process.env.DEFAULT_USER_PASSWORD ?? '').trim()
  return v.length >= 8 ? v : null
}

/**
 * Reset de senha pelo admin. 3 modos:
 *   'padrao' → senha padrão da operação (env)   — admin já sabe qual é
 *   'custom' → senha digitada pelo admin (≥8)
 *   'random' → temporária gerada (default; manda email + marca pending_onboarding)
 * Sempre revoga TODAS as sessões ativas do alvo e grava auditoria.
 */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const userId = (formData.get('user_id') as string) || ''
  if (!userId) return

  const modoRaw = (formData.get('modo') as string) || 'random'
  const modo: 'padrao' | 'custom' | 'random' =
    modoRaw === 'padrao' ? 'padrao' : modoRaw === 'custom' ? 'custom' : 'random'

  let novaSenha: string
  if (modo === 'padrao') {
    const d = defaultPassword()
    if (!d) redirect(`/admin/${userId}?error=sem_padrao`)
    novaSenha = d
  } else if (modo === 'custom') {
    const c = ((formData.get('custom_password') as string) || '').trim()
    if (c.length < 8) redirect(`/admin/${userId}?error=senha_curta`)
    novaSenha = c
  } else {
    novaSenha = generateTempPassword(12)
  }

  const tempPassword = novaSenha
  const passwordHash = await hashPassword(novaSenha)

  const sb = db()

  const { data: target } = await sb
    .from('users')
    .select('email, name, status')
    .eq('id', userId)
    .maybeSingle() as { data: { email: string; name: string | null; status: string | null } | null }

  // Temporária → força onboarding. Padrão/custom → o admin definiu uma senha usável,
  // então destrava quem estava em pending_onboarding. NUNCA reativa um 'disabled'.
  const patch: Record<string, unknown> = {
    password_hash: passwordHash,
    updated_at: new Date().toISOString(),
  }
  if (modo === 'random') patch.status = 'pending_onboarding'
  else if (target?.status === 'pending_onboarding') patch.status = 'active'

  await sb.from('users').update(patch).eq('id', userId)

  const { data: sessions } = await sb
    .from('user_sessions')
    .select('id')
    .eq('user_id', userId)
    .is('revoked_at', null) as { data: { id: string }[] | null }
  for (const s of sessions ?? []) {
    await revokeSession(s.id)
  }

  const m = await meta()
  await audit({
    action: 'admin.user.password_reset',
    actorRole: 'admin',
    actorLabel: me.user_id,
    ip: m.ip,
    userAgent: m.ua,
    resource: `/admin/users/${userId}`,
    metadata: { actor_user_id: me.user_id, target_user_id: userId, modo },
  })

  // Só a TEMPORÁRIA vai por email. Padrão/custom o admin já sabe e entrega —
  // não faz sentido mandar a senha padrão da operação por email.
  let emailFlag = ''
  if (modo === 'random' && target?.email) {
    const emailResult = await sendTempPasswordEmail({
      to: target.email,
      name: target.name,
      tempPassword,
      loginUrl: await currentLoginUrl(),
    })
    emailFlag = emailResult.ok ? '&mailed=1' : emailResult.skipped ? '&mailed=skipped' : '&mailed=failed'
  }

  redirect(`/admin/${userId}?saved=password&temp=${encodeURIComponent(tempPassword)}${emailFlag}`)
}

/**
 * Define em QUAIS PROJETOS (workspaces) o usuário entra — a membership é por EMAIL
 * (workspace_members.user_email), que é o que `fetchWorkspaceIds` lê pro viewer.
 * Admin continua vendo tudo (god-mode) independente disto.
 * Projetos arquivados não entram. Preserva o `role` existente (owner não vira viewer).
 */
export async function updateWorkspacesAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const userId = (formData.get('user_id') as string) || ''
  if (!userId) return
  const escolhidos = new Set(formData.getAll('workspaces').map((v) => String(v)))

  const sb = db()
  const { data: target } = await sb
    .from('users').select('email').eq('id', userId).maybeSingle() as { data: { email: string } | null }
  if (!target?.email) redirect(`/admin/${userId}?error=sem_usuario`)
  const email = target.email.trim().toLowerCase()

  // Só projetos ativos podem ser atribuídos (arquivado nunca entra).
  const { data: ativos } = await sb
    .from('workspaces').select('id').is('arquivado_at', null) as { data: { id: string }[] | null }
  const idsAtivos = new Set((ativos ?? []).map((w) => w.id))
  const alvo = [...escolhidos].filter((id) => idsAtivos.has(id))

  const { data: atuais } = await sb
    .from('workspace_members').select('workspace_id, role').eq('user_email', email) as {
      data: { workspace_id: string; role: string }[] | null
    }
  const atuaisIds = new Set((atuais ?? []).map((m) => m.workspace_id))

  // Remove os desmarcados (só entre os ATIVOS — não mexe em membership de arquivado)
  const remover = [...atuaisIds].filter((id) => idsAtivos.has(id) && !alvo.includes(id))
  if (remover.length) {
    await sb.from('workspace_members').delete().eq('user_email', email).in('workspace_id', remover)
  }
  // Adiciona os novos como viewer (quem já existe mantém o role atual)
  const adicionar = alvo.filter((id) => !atuaisIds.has(id))
  if (adicionar.length) {
    await sb.from('workspace_members').insert(
      adicionar.map((workspace_id) => ({ workspace_id, user_email: email, role: 'viewer' })),
    )
  }

  const m = await meta()
  await audit({
    action: 'admin.user.workspaces_updated',
    actorRole: 'admin',
    actorLabel: me.user_id,
    ip: m.ip,
    userAgent: m.ua,
    resource: `/admin/users/${userId}`,
    metadata: { actor_user_id: me.user_id, target_user_id: userId, adicionados: adicionar, removidos: remover },
  })

  revalidatePath(`/admin/${userId}`)
  redirect(`/admin/${userId}?saved=workspaces`)
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const userId = (formData.get('user_id') as string) || ''
  const sessionId = (formData.get('session_id') as string) || ''
  if (!sessionId) return

  await revokeSession(sessionId)

  const m = await meta()
  await audit({
    action: 'admin.user.session_revoke',
    actorRole: 'admin',
    actorLabel: me.user_id,
    ip: m.ip,
    userAgent: m.ua,
    resource: `/admin/users/${userId}/sessions`,
    metadata: { actor_user_id: me.user_id, target_user_id: userId, session_id: sessionId },
  })

  revalidatePath(`/admin/${userId}`)
  redirect(`/admin/${userId}?saved=session_revoke`)
}
