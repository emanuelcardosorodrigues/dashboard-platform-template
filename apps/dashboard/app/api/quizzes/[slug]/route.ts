import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { parseBody, badRequest, quizUpdateSchema } from '@/lib/validation/schemas'
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
  if (!expected) return false // fail-closed
  return req.headers.get('x-admin-password') === expected
}

async function syncKV(slug: string, payload: { title: string; status: string; config: unknown; webhook_url: string | null }) {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const kvId = process.env.QUIZ_KV_NAMESPACE_ID
  if (!token || !accountId || !kvId) return { ok: false }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/${encodeURIComponent(`quiz:${slug}`)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => ({ ok: false } as Response))
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

// GET — single quiz config (com sessions agregadas)
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()
  const { data, error } = await db.from('quiz_quizzes').select('*').eq('workspace_id', workspaceId).eq('slug', slug).single()
  if (error || !data) return NextResponse.json({ error: 'Quiz não encontrado.' }, { status: 404 })
  return NextResponse.json(data)
}

// PUT — update quiz (title, status, config, webhook_url) + propaga para KV
export async function PUT(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: 'Senha de admin incorreta.' }, { status: 401 })
  }

  const { slug } = await ctx.params
  const parsed = await parseBody(req, quizUpdateSchema)
  if (!parsed.ok) {
    const r = badRequest(parsed)
    return NextResponse.json(r.body, { status: r.status })
  }
  const { title, status, config, webhook_url } = parsed.data

  const updates: Record<string, unknown> = {}
  if (title !== undefined) updates.title = title
  if (status !== undefined) updates.status = status
  if (config !== undefined) updates.config = config
  if (webhook_url !== undefined) updates.webhook_url = webhook_url ?? null

  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()
  const { data, error } = await db
    .from('quiz_quizzes')
    .update(updates)
    .eq('workspace_id', workspaceId)
    .eq('slug', slug)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Quiz não encontrado.' }, { status: 404 })

  // Status archived → remove do KV. Demais → escreve config no KV (worker honra TTL 60s).
  if (data.status === 'archived') {
    await deleteKV(slug)
  } else {
    await syncKV(slug, {
      title: data.title,
      status: data.status,
      config: data.config,
      webhook_url: data.webhook_url,
    })
  }

  return NextResponse.json(data)
}

// DELETE — só permite remover quizzes em status draft ou archived (proteção)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: 'Senha de admin incorreta.' }, { status: 401 })
  }

  const { slug } = await ctx.params
  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()

  const { data: quiz, error: fetchErr } = await db
    .from('quiz_quizzes')
    .select('status')
    .eq('workspace_id', workspaceId)
    .eq('slug', slug)
    .single()

  if (fetchErr || !quiz) return NextResponse.json({ error: 'Quiz não encontrado.' }, { status: 404 })
  if (quiz.status === 'active') {
    return NextResponse.json({ error: 'Arquive ou pause o quiz antes de excluir.' }, { status: 400 })
  }

  // ON DELETE CASCADE em quiz_sessions remove sessões; events permanecem por FK não-restrita
  const { error } = await db.from('quiz_quizzes').delete().eq('workspace_id', workspaceId).eq('slug', slug)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await deleteKV(slug)

  return NextResponse.json({ ok: true })
}
