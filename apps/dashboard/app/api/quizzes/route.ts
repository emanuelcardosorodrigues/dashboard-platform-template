import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { parseBody, badRequest, quizCreateSchema } from '@/lib/validation/schemas'
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
  if (!expected) return false // fail-closed: sem senha configurada, não libera
  return req.headers.get('x-admin-password') === expected
}

// Propaga config para o KV do Worker (chave quiz:{slug}).
// Falha não bloqueia: o Worker faz fallback para Supabase se KV vazio.
async function syncKV(slug: string, payload: { title: string; status: string; config: unknown; webhook_url: string | null }) {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const kvId = process.env.QUIZ_KV_NAMESPACE_ID
  if (!token || !accountId || !kvId) return { ok: false, reason: 'missing-cf-env' }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/${encodeURIComponent(`quiz:${slug}`)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => ({ ok: false, statusText: String(e) } as Response))

  return { ok: res.ok }
}

async function deleteKV(slug: string) {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const kvId = process.env.QUIZ_KV_NAMESPACE_ID
  if (!token || !accountId || !kvId) return
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/${encodeURIComponent(`quiz:${slug}`)}`
  await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
}

// GET — lista os quizzes DO WORKSPACE ATIVO (slug pode colidir entre tenants)
export async function GET() {
  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()
  const { data, error } = await db
    .from('quiz_quizzes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST — create new quiz
export async function POST(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: 'Senha de admin incorreta.' }, { status: 401 })
  }

  const parsed = await parseBody(req, quizCreateSchema)
  if (!parsed.ok) {
    const r = badRequest(parsed)
    return NextResponse.json(r.body, { status: r.status })
  }
  const { slug, title, status, config, webhook_url } = parsed.data

  const finalStatus = status ?? 'draft'
  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()

  const { data, error } = await db
    .from('quiz_quizzes')
    .insert({
      workspace_id: workspaceId, // senão cai no DEFAULT (DEMO), nunca no tenant real
      slug,
      title,
      status: finalStatus,
      config,
      webhook_url: webhook_url ?? null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `Slug "${slug}" já existe.` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (finalStatus === 'active') {
    await syncKV(slug, { title: data.title, status: data.status, config: data.config, webhook_url: data.webhook_url })
  }

  return NextResponse.json(data, { status: 201 })
}
