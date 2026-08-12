/**
 * Descobre e registra contas Instagram via token de System User dedicado
 * (META_SYSTEM_USER_CRM), protegido por CRON_SECRET — permite (re)conectar o IG
 * server-to-server, sem expor o token no navegador. Os page tokens derivados
 * herdam os escopos do System User (instagram_basic + manage_insights).
 * `?ws=<uuid>` obrigatório.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encryptSecret } from '@/lib/crypto/secrets'
import { listIgAccounts } from '@/lib/organico/instagram'
import { getMetaConfig } from '@/lib/integrations/factory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const secret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  const ws = new URL(req.url).searchParams.get('ws')
  if (!ws || !/^[0-9a-f-]{36}$/i.test(ws)) return NextResponse.json({ error: 'ws inválido' }, { status: 400 })

  const suToken = process.env.META_SYSTEM_USER_CRM || ''
  const meta = await getMetaConfig(ws)
  const token = suToken || meta?.accessToken || ''
  if (!token) return NextResponse.json({ error: 'sem token (META_SYSTEM_USER_CRM ausente)' }, { status: 400 })

  let discovered: Awaited<ReturnType<typeof listIgAccounts>>
  try {
    discovered = await listIgAccounts(token)
  } catch (e) {
    return NextResponse.json({ error: `descoberta falhou: ${(e as Error).message}` }, { status: 502 })
  }
  if (discovered.length === 0) {
    return NextResponse.json({ ok: true, contas: 0, hint: 'token não enxerga contas IG — confira atribuição da Página + escopos instagram_manage_insights' })
  }

  // MULTI-TENANT: um System User enxerga contas de VÁRIOS clientes. Só anexamos
  // ao workspace as contas EXPLICITAMENTE escolhidas via ?ig=<id1,id2>. Sem o
  // filtro, apenas LISTAMOS (nenhuma escrita) pra escolher — evita misturar
  // conta de um cliente no projeto de outro.
  const igFilter = (new URL(req.url).searchParams.get('ig') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (igFilter.length === 0) {
    return NextResponse.json({
      ok: true, modo: 'listagem',
      hint: 'Reenvie com &ig=<external_id> (vírgula p/ várias) pra anexar SÓ a(s) conta(s) deste projeto.',
      disponiveis: discovered.map((a) => ({ handle: a.username, id: a.igUserId, followers: a.followersCount })),
    })
  }
  const accounts = discovered.filter((a) => igFilter.includes(a.igUserId))
  if (accounts.length === 0) {
    return NextResponse.json({ error: 'nenhuma das contas do ?ig= foi encontrada no token', disponiveis: discovered.map((a) => a.igUserId) }, { status: 400 })
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  // preserva tokens de contas já anexadas a este workspace (merge, não substitui)
  const { getWorkspaceCredential } = await import('@/lib/integrations/credentials')
  const existing = await getWorkspaceCredential<{ tokens?: Record<string, string> }>(ws, 'instagram')
  const tokens: Record<string, string> = { ...(existing?.secret?.tokens ?? {}) }
  for (const a of accounts) tokens[a.igUserId] = a.pageToken
  const enc = encryptSecret({ tokens })
  await supabase.from('workspace_credentials').upsert({
    workspace_id: ws, provider: 'instagram',
    ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag,
    meta: { accounts: Object.keys(tokens), source: 'system_user_crm' },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,provider' })

  for (const a of accounts) {
    await supabase.from('organic_accounts').upsert({
      workspace_id: ws, platform: 'instagram', external_id: a.igUserId,
      handle: a.username, display_name: a.name ?? a.username, avatar_url: a.avatarUrl,
      status: 'active', last_error: null,
      meta: { page_id: a.pageId, followers_at_connect: a.followersCount, source: 'system_user_crm' },
    }, { onConflict: 'workspace_id,platform,external_id' })
  }

  return NextResponse.json({ ok: true, contas: accounts.map((a) => ({ handle: a.username, id: a.igUserId, followers: a.followersCount })) })
}
