'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { audit } from '@/lib/audit'
import {
  setWorkspaceCredential,
  deleteWorkspaceCredential,
  getWorkspaceCredential,
  type IntegrationProvider,
} from '@/lib/integrations/credentials'
import { PROVIDER_FIELDS } from '@/lib/integrations/providers'
import { credentialsEncryptionReady } from '@/lib/crypto/secrets'
import { createClient } from '@supabase/supabase-js'

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function requireAdmin() {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session || session.role !== 'admin') redirect('/visao-geral')
  return session
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/

/** Cria um projeto novo (workspace) + torna o admin atual owner. */
export async function createWorkspaceAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const nome = String(formData.get('nome') || '').trim().slice(0, 120)
  const slug = String(formData.get('slug') || '').trim().toLowerCase()
  const logoUrl = String(formData.get('logo_url') || '').trim().slice(0, 500)
  if (!nome || !SLUG_RE.test(slug)) {
    redirect('/admin/projetos/novo?erro=invalido')
  }

  const client = db()
  const row: Record<string, unknown> = { slug, nome }
  if (logoUrl) row.logo_url = logoUrl
  const { data, error } = await client.from('workspaces').insert(row).select('id').single()
  if (error) {
    const dup = /duplicate|unique/i.test(error.message)
    redirect(`/admin/projetos/novo?erro=${dup ? 'slug_existe' : 'falha'}`)
  }
  const workspaceId = (data as { id: string }).id

  // Admin vira owner (god-mode já vê todos, mas registra a autoria).
  await client.from('workspace_members')
    .upsert({ workspace_id: workspaceId, user_email: me.email, role: 'owner' }, { onConflict: 'workspace_id,user_email' })
  await audit({ action: 'admin.workspace.create', actorRole: 'admin', actorLabel: me.user_id, resource: workspaceId, metadata: { slug, nome } }).catch(() => {})

  revalidatePath('/admin/projetos')
  redirect(`/admin/projetos/${workspaceId}?novo=1`)
}

/** Atualiza nome/logo de um projeto. */
export async function updateWorkspaceAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const nome = String(formData.get('nome') || '').trim().slice(0, 120)
  const logoUrl = String(formData.get('logo_url') || '').trim().slice(0, 500)
  if (!workspaceId || !nome) redirect('/admin/projetos')
  const patch: Record<string, unknown> = { nome, updated_at: new Date().toISOString() }
  patch.logo_url = logoUrl || null
  const { error } = await db().from('workspaces').update(patch).eq('id', workspaceId)
  if (error && /column .* logo_url/i.test(error.message)) {
    await db().from('workspaces').update({ nome }).eq('id', workspaceId) // logo_url ainda não migrado
  }
  await audit({ action: 'admin.workspace.update', actorRole: 'admin', actorLabel: me.user_id, resource: workspaceId }).catch(() => {})
  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?ok=projeto`)
}

/** Adiciona/remove um usuário (por email) na membership de um projeto. */
export async function setMembershipAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const email = String(formData.get('user_email') || '').trim().toLowerCase()
  const op = String(formData.get('op') || '')
  if (!workspaceId || !email) redirect(`/admin/projetos/${workspaceId}`)
  const client = db()
  if (op === 'remove') {
    await client.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_email', email)
  } else {
    await client.from('workspace_members')
      .upsert({ workspace_id: workspaceId, user_email: email, role: 'viewer' }, { onConflict: 'workspace_id,user_email' })
  }
  await audit({ action: `admin.workspace.member.${op === 'remove' ? 'remove' : 'add'}`, actorRole: 'admin', actorLabel: me.user_id, resource: `${workspaceId}/${email}` }).catch(() => {})
  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?membro=1`)
}

const PROVIDERS = new Set<IntegrationProvider>(Object.keys(PROVIDER_FIELDS) as IntegrationProvider[])

/**
 * Salva (cifrando) as credenciais de UM provider de UM projeto. Os campos
 * `secret` que vierem VAZIOS são ignorados (não apagam o que já estava — permite
 * editar só o que mudou sem reexpor o token). Campos não-secretos sempre gravam.
 */
export async function saveCredentialAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const provider = String(formData.get('provider') || '') as IntegrationProvider
  if (!workspaceId || !PROVIDERS.has(provider)) redirect('/admin/projetos')

  if (!credentialsEncryptionReady()) {
    redirect(`/admin/projetos/${workspaceId}?erro=sem_master_key`)
  }

  const fields = PROVIDER_FIELDS[provider]
  const secret: Record<string, unknown> = {}
  for (const f of fields) {
    const raw = String(formData.get(f.key) ?? '').trim()
    if (!raw) continue // vazio = não mexe nesse campo
    secret[f.key] = raw
  }
  if (Object.keys(secret).length === 0) {
    redirect(`/admin/projetos/${workspaceId}?erro=vazio`)
  }

  // meta não-secreto pra exibir status sem decifrar (quais campos têm valor).
  const metaHint = { fields: Object.keys(secret), saved_by: me.email }
  await setWorkspaceCredential(workspaceId, provider, secret, metaHint)
  await audit({
    action: 'admin.workspace_credential.set',
    actorRole: 'admin',
    actorLabel: me.user_id,
    resource: `${workspaceId}/${provider}`,
    metadata: { fields: Object.keys(secret) },
  }).catch(() => {})

  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?ok=${provider}`)
}

/**
 * Desconecta uma conta orgânica (YouTube/Instagram/TikTok): marca a conta como
 * 'disconnected' (dados históricos PRESERVADOS) e remove o refresh token dela
 * do mapa cifrado — se for o último, apaga a credencial do provider inteira.
 */
export async function disconnectOrganicAccountAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const accountId = String(formData.get('account_id') || '')
  if (!workspaceId || !accountId) redirect('/admin/projetos')

  const client = db()
  const { data: acc } = await client.from('organic_accounts')
    .select('external_id, platform')
    .eq('id', accountId).eq('workspace_id', workspaceId).maybeSingle()
  if (!acc) redirect(`/admin/projetos/${workspaceId}`)
  const { external_id, platform } = acc as { external_id: string; platform: IntegrationProvider }

  const upd = await client.from('organic_accounts')
    .update({ status: 'disconnected', last_error: null })
    .eq('id', accountId).eq('workspace_id', workspaceId)
  if (upd.error) {
    console.error('[disconnect] update falhou:', upd.error.message)
    redirect(`/admin/projetos/${workspaceId}?org_off_erro=1`)
  }

  const cred = await getWorkspaceCredential<{ tokens?: Record<string, string> }>(workspaceId, platform)
  if (cred?.secret?.tokens) {
    const tokens = { ...cred.secret.tokens }
    const revokedToken = tokens[external_id]
    delete tokens[external_id]

    // Revogação REAL no provedor (não só apagar do cofre): o Google testa isso
    // na verificação OAuth — desconectar tem que invalidar o grant de verdade.
    if (platform === 'youtube' && revokedToken) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: revokedToken }),
          signal: AbortSignal.timeout(5000),
        })
      } catch (e) {
        console.warn('[disconnect] revogação Google falhou (token apagado do cofre mesmo assim):', (e as Error).message)
      }
    }

    if (Object.keys(tokens).filter((k) => k !== '__user').length === 0) {
      await deleteWorkspaceCredential(workspaceId, platform)
    } else {
      await setWorkspaceCredential(workspaceId, platform, { tokens }, {
        channels: Object.keys(tokens).filter((k) => k !== '*' && k !== '__user'),
      })
    }
  }

  await audit({
    action: 'admin.organico.disconnect',
    actorRole: 'admin',
    actorLabel: me.user_id,
    resource: `${workspaceId}/${platform}/${external_id}`,
  }).catch(() => {})

  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?org_off=1`)
}

/**
 * Dispara o sync orgânico de UM projeto agora (botão do admin). Chama o próprio
 * cron com Bearer CRON_SECRET e timeout curto: se o sync demorar mais que isso,
 * a invocação do cron CONTINUA rodando no servidor — o admin só volta pra
 * página com o aviso "disparado" e acompanha pelo "último sync" da conta.
 */
export async function syncOrganicNowAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  if (!workspaceId) redirect('/admin/projetos')

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) redirect(`/admin/projetos/${workspaceId}?sync=sem_secret`)

  const host = (await headers()).get('host')
  const base = process.env.NEXT_PUBLIC_APP_URL || (host ? `https://${host}` : '')
  if (!base) redirect(`/admin/projetos/${workspaceId}?sync=erro`)

  // Dispara TODOS os syncs orgânicos do projeto em paralelo (YouTube + IG +
  // stories). Timeout de fetch ≠ falha do sync: a invocação do cron segue.
  const endpoints = [
    `/api/cron/sync-youtube?days=7&ws=${workspaceId}`,
    `/api/cron/sync-instagram?ws=${workspaceId}`,
    `/api/cron/sync-instagram-stories?ws=${workspaceId}`,
  ]
  let resultado = 'disparado'
  try {
    type CronConta = { videos?: number; medias?: number; erro?: string; skipped?: string }
    const settled = await Promise.allSettled(endpoints.map((p) =>
      fetch(`${base}${p}`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(50_000),
        cache: 'no-store',
      }).then(async (res) => res.ok ? await res.json() as { contas?: Record<string, CronConta> } : null),
    ))
    const contas: CronConta[] = []
    let anyTimeout = false
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) contas.push(...Object.values(r.value.contas ?? {}))
      else anyTimeout = true
    }
    const itens = contas.reduce((s, c) => s + (c.videos ?? 0) + (c.medias ?? 0), 0)
    const erros = contas.filter((c) => c.erro).length
    if (anyTimeout) resultado = 'disparado'
    else if (contas.length > 0 && contas.every((c) => c.skipped)) resultado = 'sem_conta'
    else if (erros > 0) resultado = `parcial_${itens}`
    else resultado = `ok_${itens}`
  } catch {
    resultado = 'disparado'
  }

  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?sync=${resultado}`)
}

const LINK_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/

/**
 * Cria um link rastreável do orgânico: insere em organic_links e publica no KV
 * do Worker do cliente (best-effort — sem credencial CF, o admin copia o JSON
 * manualmente e o banner avisa).
 */
export async function createOrganicLinkAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const slug = String(formData.get('slug') || '').trim().toLowerCase()
  const destination = String(formData.get('destination_url') || '').trim()
  const platform = String(formData.get('platform') || '') || null
  const postExternalId = String(formData.get('post_external_id') || '').trim() || null
  if (!workspaceId) redirect('/admin/projetos')
  if (!LINK_SLUG_RE.test(slug)) redirect(`/admin/projetos/${workspaceId}?link=slug_invalido`)
  let destUrl: URL
  try {
    destUrl = new URL(destination)
    if (destUrl.protocol !== 'https:') throw new Error('https only')
  } catch {
    redirect(`/admin/projetos/${workspaceId}?link=url_invalida`)
    return
  }

  const utmContent = postExternalId ?? slug
  const sck = `org_${platform ?? 'link'}_${utmContent}`
  const client = db()
  const { error } = await client.from('organic_links').insert({
    workspace_id: workspaceId, slug, destination_url: destUrl.toString(),
    platform, post_external_id: postExternalId, utm_content: utmContent, sck,
  })
  if (error) {
    const dup = /duplicate|unique/i.test(error.message)
    redirect(`/admin/projetos/${workspaceId}?link=${dup ? 'slug_existe' : 'erro'}`)
  }

  // Publica no KV do cliente (Worker organic-links)
  let kv = 'manual'
  try {
    const { getCloudflareConfig } = await import('@/lib/integrations/factory')
    const cf = await getCloudflareConfig(workspaceId)
    if (cf?.linksKvNamespaceId) {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/storage/kv/namespaces/${cf.linksKvNamespaceId}/values/${encodeURIComponent(slug)}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${cf.apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ dest: destUrl.toString(), platform, post: postExternalId }),
          signal: AbortSignal.timeout(8000),
        },
      )
      kv = res.ok ? 'ok' : 'falhou'
    }
  } catch {
    kv = 'falhou'
  }

  await audit({
    action: 'admin.organico.link.create', actorRole: 'admin', actorLabel: me.user_id,
    resource: `${workspaceId}/${slug}`, metadata: { kv },
  }).catch(() => {})
  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?link=${kv === 'ok' ? 'ok' : `criado_kv_${kv}`}`)
}

/** Apaga um link rastreável (linha + chave no KV, best-effort). */
export async function deleteOrganicLinkAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const linkId = String(formData.get('link_id') || '')
  if (!workspaceId || !linkId) redirect('/admin/projetos')
  const client = db()
  const { data } = await client.from('organic_links')
    .select('slug').eq('id', linkId).eq('workspace_id', workspaceId).maybeSingle()
  await client.from('organic_links').delete().eq('id', linkId).eq('workspace_id', workspaceId)
  try {
    const slug = (data as { slug?: string } | null)?.slug
    if (slug) {
      const { getCloudflareConfig } = await import('@/lib/integrations/factory')
      const cf = await getCloudflareConfig(workspaceId)
      if (cf?.linksKvNamespaceId) {
        await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/storage/kv/namespaces/${cf.linksKvNamespaceId}/values/${encodeURIComponent(slug)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${cf.apiToken}` }, signal: AbortSignal.timeout(8000) },
        )
      }
    }
  } catch { /* best-effort */ }
  await audit({
    action: 'admin.organico.link.delete', actorRole: 'admin', actorLabel: me.user_id,
    resource: `${workspaceId}/${linkId}`,
  }).catch(() => {})
  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?link=removido`)
}

/**
 * Conecta as contas Instagram via TOKEN DO SYSTEM USER do Meta (sem OAuth).
 * Usa o token que o projeto já tem pro Meta Ads (mesmas Páginas atribuídas ao
 * system user) pra descobrir as contas IG e gravar os page tokens — que, por
 * virem de system user, NÃO expiram. Reusa todo o pipeline de sync da Onda 2.
 */
export async function connectInstagramViaSystemUserAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  if (!workspaceId) redirect('/admin/projetos')

  const { getMetaConfig } = await import('@/lib/integrations/factory')
  const { listIgAccounts } = await import('@/lib/organico/instagram')
  // Token DEDICADO de System User com escopos de IG (instagram_basic +
  // instagram_manage_insights) tem prioridade; cai pro token do Meta Ads se
  // ausente. Os page tokens derivados herdam os escopos deste token.
  const suToken = process.env.META_SYSTEM_USER_CRM || ''
  const meta = await getMetaConfig(workspaceId)
  const igDiscoveryToken = suToken || meta?.accessToken || ''
  if (!igDiscoveryToken) redirect(`/admin/projetos/${workspaceId}?ig=sem_meta`)

  let igAccounts: Awaited<ReturnType<typeof listIgAccounts>>
  try {
    igAccounts = await listIgAccounts(igDiscoveryToken)
  } catch {
    redirect(`/admin/projetos/${workspaceId}?ig=erro_descoberta`)
    return
  }
  if (igAccounts.length === 0) redirect(`/admin/projetos/${workspaceId}?ig=sem_conta_su`)

  // page tokens via system user não expiram; guardamos no MESMO formato do OAuth
  const existing = await getWorkspaceCredential<{ tokens?: Record<string, string> }>(workspaceId, 'instagram')
  const tokens: Record<string, string> = { ...(existing?.secret?.tokens ?? {}) }
  for (const acc of igAccounts) tokens[acc.igUserId] = acc.pageToken
  await setWorkspaceCredential(workspaceId, 'instagram', { tokens }, {
    accounts: Object.keys(tokens).filter((k) => k !== '__user'), source: 'system_user',
  })

  const client = db()
  for (const acc of igAccounts) {
    await client.from('organic_accounts').upsert({
      workspace_id: workspaceId, platform: 'instagram', external_id: acc.igUserId,
      handle: acc.username, display_name: acc.name ?? acc.username, avatar_url: acc.avatarUrl,
      status: 'active', last_error: null,
      meta: { page_id: acc.pageId, followers_at_connect: acc.followersCount, source: 'system_user' },
    }, { onConflict: 'workspace_id,platform,external_id' })
  }

  await audit({
    action: 'admin.organico.connect_su', actorRole: 'admin', actorLabel: me.user_id,
    resource: workspaceId, metadata: { platform: 'instagram', accounts: igAccounts.map((a) => a.username) },
  }).catch(() => {})
  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?ig=su_ok&n=${igAccounts.length}`)
}

/**
 * Testa a credencial SALVA de um provider com uma chamada real (leve) à API —
 * decifra o segredo, chama o validator e volta com pass/fail + mensagem. Não
 * altera nada (somente-leitura). Clarity não é testado de verdade (cota 10/dia).
 */
export async function testCredentialAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const provider = String(formData.get('provider') || '') as IntegrationProvider
  if (!workspaceId || !PROVIDERS.has(provider)) redirect('/admin/projetos')

  const back = (ok: boolean, msg: string) =>
    redirect(`/admin/projetos/${workspaceId}?teste=${provider}&teste_ok=${ok ? 1 : 0}&teste_msg=${encodeURIComponent(msg)}`)

  const cred = await getWorkspaceCredential<Record<string, string>>(workspaceId, provider)
  if (!cred) back(false, 'Sem credencial salva pra testar — salve primeiro.')

  const { validateCredential } = await import('@/lib/integrations/validators')
  const result = await validateCredential(provider, cred!.secret)
  back(result.ok, result.message)
}

/**
 * Atribui uma conta de anúncio Meta (act_XXXX) a este projeto. Como account_id é
 * PK global (N:1), o upsert MOVE a conta pra este workspace se ela já estava em
 * outro — é a fonte da verdade que liga ad_id→projeto no pipeline de criativos.
 */
export async function addMetaAccountAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const accountId = String(formData.get('account_id') || '').trim().replace(/^act_/i, '')
  const rotulo = String(formData.get('rotulo') || '').trim().slice(0, 80) || null
  if (!workspaceId) redirect('/admin/projetos')
  if (!/^\d{6,}$/.test(accountId)) redirect(`/admin/projetos/${workspaceId}?meta_acc=invalido`)
  const { error } = await db().from('workspace_meta_accounts')
    .upsert({ account_id: accountId, workspace_id: workspaceId, rotulo }, { onConflict: 'account_id' })
  if (error) redirect(`/admin/projetos/${workspaceId}?meta_acc=erro`)
  await audit({ action: 'admin.workspace.meta_account.add', actorRole: 'admin', actorLabel: me.user_id, resource: `${workspaceId}/${accountId}` }).catch(() => {})
  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?meta_acc=ok`)
}

/** Desvincula uma conta Meta deste projeto. */
export async function removeMetaAccountAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const accountId = String(formData.get('account_id') || '').trim()
  if (!workspaceId || !accountId) redirect('/admin/projetos')
  await db().from('workspace_meta_accounts').delete().eq('account_id', accountId).eq('workspace_id', workspaceId)
  await audit({ action: 'admin.workspace.meta_account.remove', actorRole: 'admin', actorLabel: me.user_id, resource: `${workspaceId}/${accountId}` }).catch(() => {})
  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?meta_acc=removido`)
}

/** Remove a credencial de um provider. */
export async function deleteCredentialAction(formData: FormData): Promise<void> {
  const me = await requireAdmin()
  const workspaceId = String(formData.get('workspace_id') || '')
  const provider = String(formData.get('provider') || '') as IntegrationProvider
  if (!workspaceId || !PROVIDERS.has(provider)) redirect('/admin/projetos')
  await deleteWorkspaceCredential(workspaceId, provider)
  await audit({
    action: 'admin.workspace_credential.delete',
    actorRole: 'admin',
    actorLabel: me.user_id,
    resource: `${workspaceId}/${provider}`,
  }).catch(() => {})
  revalidatePath(`/admin/projetos/${workspaceId}`)
  redirect(`/admin/projetos/${workspaceId}?removido=${provider}`)
}
