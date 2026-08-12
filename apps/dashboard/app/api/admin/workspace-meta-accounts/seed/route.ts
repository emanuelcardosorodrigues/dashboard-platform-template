/**
 * POST /api/admin/workspace-meta-accounts/seed?workspace_slug=demo
 *   → popula a tabela workspace_meta_accounts (migration 0013) com os
 *     account_ids lidos de META_ACCOUNT_IDS (CSV), ligando ao workspace
 *     do slug informado (default 'demo').
 *
 * Idempotente: ON CONFLICT (account_id) DO NOTHING via upsert
 * { ignoreDuplicates: true }. Reportar separadamente quais foram
 * inseridos agora vs quais já existiam (consulta prévia).
 *
 * Auth: cookie de sessão com role='admin' OU Bearer CRON_SECRET (pra
 * disparar via curl one-shot sem precisar logar). Pelo menos um precisa
 * ser válido.
 *
 * Existe pra cobrir o "seed da 0013 vazio em prod" — antes o resolver
 * de workspace por account_id sempre caía no fallback slug='demo',
 * mascarando a ausência de seed quando um segundo tenant chegasse.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const bearerOk =
    !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`

  if (!bearerOk) {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value
    const session = sessionId ? await lookupSession(sessionId) : null
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'admin only' }, { status: 403 })
    }
  }

  const workspaceSlug = (req.nextUrl.searchParams.get('workspace_slug') ?? 'demo').trim() || 'demo'

  const accountIdsFromEnv = (process.env.META_ACCOUNT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (accountIdsFromEnv.length === 0) {
    return NextResponse.json({ error: 'META_ACCOUNT_IDS vazio no env' }, { status: 400 })
  }

  const client = supa()

  const { data: ws, error: wsErr } = await client
    .from('workspaces')
    .select('id')
    .eq('slug', workspaceSlug)
    .maybeSingle()
  if (wsErr) {
    return NextResponse.json({ error: `workspace lookup: ${wsErr.message}` }, { status: 500 })
  }
  if (!ws) {
    return NextResponse.json({ error: `workspace slug='${workspaceSlug}' não encontrado` }, { status: 404 })
  }
  const workspaceId = ws.id as string

  // Detecta quem já existe ANTES do upsert pra reportar inserted vs alreadyExisted.
  const { data: existingRows, error: existErr } = await client
    .from('workspace_meta_accounts')
    .select('account_id')
    .in('account_id', accountIdsFromEnv)
  if (existErr) {
    return NextResponse.json({ error: `existing lookup: ${existErr.message}` }, { status: 500 })
  }
  const alreadyExisted = new Set<string>((existingRows ?? []).map((r: { account_id: string }) => r.account_id))

  const inserted: string[] = []
  const errors: Array<{ accountId: string; error: string }> = []

  for (const accountId of accountIdsFromEnv) {
    if (alreadyExisted.has(accountId)) continue
    const { error: upErr } = await client
      .from('workspace_meta_accounts')
      .upsert(
        { account_id: accountId, workspace_id: workspaceId, rotulo: 'auto-seed' },
        { onConflict: 'account_id', ignoreDuplicates: true },
      )
    if (upErr) {
      errors.push({ accountId, error: upErr.message })
      continue
    }
    inserted.push(accountId)
  }

  return NextResponse.json({
    workspaceSlug,
    workspaceId,
    accountIdsFromEnv,
    inserted,
    alreadyExisted: [...alreadyExisted],
    errors,
  })
}
