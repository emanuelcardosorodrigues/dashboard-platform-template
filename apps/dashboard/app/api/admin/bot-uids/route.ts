/**
 * /api/admin/bot-uids — Fase 3 do plano whimsical-seeking-lemon (UI quarentena).
 *
 * GET ?status=suspect|confirmed|cleared&limit=100 → lista bot_uids
 * PATCH { uid, status } → muda status (confirmed/cleared/suspect)
 *
 * Auth: x-admin-password (mesmo padrão dos demais admin endpoints).
 * Proxy.ts já gateia /api/admin/* exigindo session admin; o header confirma
 * intent explícito de ação destrutiva.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

export const dynamic = 'force-dynamic'

function getClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function checkAdminPassword(req: NextRequest): boolean {
  const expected = process.env.ADMIN_ACTION_PASSWORD
  // Fail-closed: sem a senha configurada, a ação NÃO é liberada (era fail-open).
  if (!expected) return false
  return req.headers.get('x-admin-password') === expected
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'suspect'
  if (!['suspect', 'confirmed', 'cleared'].includes(status)) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 })
  }
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 500)

  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()
  // Tenta query com novas colunas. Fallback graceful se migration 0002 não aplicada.
  let { data, error } = await db
    .from('bot_uids')
    .select('uid, score, signals, status, created_at')
    .eq('workspace_id', workspaceId)
    .eq('status', status)
    .order('score', { ascending: false })
    .limit(limit)

  if (error && /column .* does not exist/i.test(error.message)) {
    const fallback = await db.from('bot_uids').select('uid, created_at').eq('workspace_id', workspaceId).limit(limit)
    data = (fallback.data ?? []).map((r) => ({ ...r, score: 0, signals: {}, status: 'confirmed' }))
    error = fallback.error
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rows: data ?? [], status, limit })
}

export async function PATCH(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: 'Senha de admin incorreta.' }, { status: 401 })
  }
  let body: { uid?: string; status?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const uid = body.uid?.trim()
  const status = body.status
  if (!uid || !status || !['suspect', 'confirmed', 'cleared'].includes(status)) {
    return NextResponse.json({ error: 'uid + status (suspect|confirmed|cleared) obrigatórios' }, { status: 400 })
  }

  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()
  const { data, error } = await db
    .from('bot_uids')
    .update({ status })
    .eq('workspace_id', workspaceId)
    .eq('uid', uid)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, row: data })
}
