/**
 * Provisionamento server-to-server de um projeto novo com Meta Ads (e opcional
 * IG) usando o token de System User (META_SYSTEM_USER_CRM) que só existe no
 * ambiente — permite criar projetos de clientes sem digitar token no navegador.
 * Bearer CRON_SECRET. Idempotente (reusa o workspace pelo slug).
 *
 * GET /api/cron/provision-org-ws?slug=lrm&nome=...&meta_accounts=id1,id2&tax=1.1382[&ig=igid1,igid2]
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encryptSecret } from '@/lib/crypto/secrets'
import { listIgAccounts } from '@/lib/organico/instagram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sp = new URL(req.url).searchParams
  const slug = (sp.get('slug') ?? '').trim().toLowerCase()
  const nome = (sp.get('nome') ?? '').trim().slice(0, 120)
  const metaAccounts = (sp.get('meta_accounts') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const tax = sp.get('tax') ?? '1.1382'
  const igFilter = (sp.get('ig') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!SLUG_RE.test(slug) || !nome) return NextResponse.json({ error: 'slug/nome inválidos' }, { status: 400 })

  const token = process.env.META_SYSTEM_USER_CRM || process.env.META_ACCESS_TOKEN || ''
  if (!token) return NextResponse.json({ error: 'sem token (META_SYSTEM_USER_CRM)' }, { status: 400 })

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  // 1) workspace (reusa pelo slug se já existir)
  let workspaceId: string
  const { data: existing } = await sb.from('workspaces').select('id').eq('slug', slug).maybeSingle()
  if (existing) {
    workspaceId = (existing as { id: string }).id
    await sb.from('workspaces').update({ nome }).eq('id', workspaceId)
  } else {
    const { data, error } = await sb.from('workspaces').insert({ slug, nome }).select('id').single()
    if (error) return NextResponse.json({ error: `criar workspace: ${error.message}` }, { status: 500 })
    workspaceId = (data as { id: string }).id
  }

  // 2) credencial Meta cifrada (token do system user + contas + imposto)
  const result: Record<string, unknown> = { workspaceId, slug, nome }
  if (metaAccounts.length > 0) {
    const enc = encryptSecret({ accessToken: token, accountIds: metaAccounts.join(','), taxRate: tax })
    const { error } = await sb.from('workspace_credentials').upsert({
      workspace_id: workspaceId, provider: 'meta',
      ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag,
      meta: { accounts: metaAccounts, source: 'system_user_crm' }, updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,provider' })
    result.meta = error ? `erro: ${error.message}` : `ok (${metaAccounts.length} contas)`
  }

  // 3) Instagram via system user (opcional; só as contas do ?ig=)
  if (igFilter.length > 0) {
    try {
      const discovered = await listIgAccounts(token)
      const accounts = discovered.filter((a) => igFilter.includes(a.igUserId))
      if (accounts.length > 0) {
        const tokens: Record<string, string> = {}
        for (const a of accounts) tokens[a.igUserId] = a.pageToken
        const enc = encryptSecret({ tokens })
        await sb.from('workspace_credentials').upsert({
          workspace_id: workspaceId, provider: 'instagram',
          ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag,
          meta: { accounts: Object.keys(tokens), source: 'system_user_crm' }, updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,provider' })
        for (const a of accounts) {
          await sb.from('organic_accounts').upsert({
            workspace_id: workspaceId, platform: 'instagram', external_id: a.igUserId,
            handle: a.username, display_name: a.name ?? a.username, avatar_url: a.avatarUrl,
            status: 'active', last_error: null,
            meta: { page_id: a.pageId, followers_at_connect: a.followersCount, source: 'system_user_crm' },
          }, { onConflict: 'workspace_id,platform,external_id' })
        }
        result.instagram = accounts.map((a) => a.username)
      } else {
        result.instagram = `nenhuma das contas ${JSON.stringify(igFilter)} visível ao token`
      }
    } catch (e) {
      result.instagram = `erro: ${(e as Error).message}`
    }
  }

  // 4) Hotmart — o webhook é roteado POR TOKEN: `resolveHotmartWorkspace` compara
  // o header que a Hotmart envia (hottok) com o `webhookToken` da cred cifrada de
  // cada projeto. Sem esta cred, a venda do cliente chega e leva 401.
  // O hottok é gerado PELA HOTMART ao criar o webhook — por isso entra por
  // parâmetro, não é sorteado aqui.
  // client_id/secret são opcionais: só precisam existir se este projeto for usar
  // pull da API (reconciliação). O roteamento do webhook depende apenas do token.
  const hotToken = (sp.get('hotmart_webhook_token') ?? '').trim()
  const hotId = (sp.get('hotmart_client_id') ?? '').trim()
  const hotSecret = (sp.get('hotmart_client_secret') ?? '').trim()
  if (hotToken || hotId) {
    // Preserva o que já existe: gravar só o token não pode apagar client/secret
    // salvos antes (e vice-versa).
    const { getWorkspaceCredential } = await import('@/lib/integrations/credentials')
    const atual = await getWorkspaceCredential<{ clientId?: string; clientSecret?: string; webhookToken?: string }>(workspaceId, 'hotmart')
    const secret = {
      clientId: hotId || atual?.secret?.clientId || '',
      clientSecret: hotSecret || atual?.secret?.clientSecret || '',
      webhookToken: hotToken || atual?.secret?.webhookToken || '',
    }
    const enc = encryptSecret(secret)
    const { error } = await sb.from('workspace_credentials').upsert({
      workspace_id: workspaceId, provider: 'hotmart',
      ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag,
      meta: { tem_webhook_token: !!secret.webhookToken, tem_client_id: !!secret.clientId },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,provider' })
    result.hotmart = error
      ? `erro: ${error.message}`
      : `ok (webhookToken=${secret.webhookToken ? 'sim' : 'nao'}, clientId=${secret.clientId ? 'sim' : 'nao'})`
  }

  return NextResponse.json({ ok: true, ...result })
}
