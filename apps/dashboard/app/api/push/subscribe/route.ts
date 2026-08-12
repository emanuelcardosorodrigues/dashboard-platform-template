/**
 * POST   /api/push/subscribe  — salva a inscrição de push do browser (upsert por endpoint)
 * DELETE /api/push/subscribe  — remove a inscrição (ao desativar)
 * Sessão + membership via requireAuth (mesmo fecho de IDOR das outras rotas).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/apiAuth'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

interface SubBody {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
}

export async function POST(req: NextRequest) {
  let body: SubBody
  try {
    body = (await req.json()) as SubBody
  } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 })
  }
  const endpoint = body.endpoint?.trim()
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'inscrição incompleta' }, { status: 400 })
  }
  try {
    const client = supa()
    const a = await requireAuth(req, client)
    if ('error' in a) return a.error
    const { error } = await client.from('push_subscriptions').upsert(
      { workspace_id: a.ws.id, user_email: a.session.email, endpoint, p256dh, auth },
      { onConflict: 'endpoint' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('push/subscribe POST failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  let body: SubBody
  try {
    body = (await req.json()) as SubBody
  } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 })
  }
  const endpoint = body.endpoint?.trim()
  if (!endpoint) return NextResponse.json({ error: 'endpoint requerido' }, { status: 400 })
  try {
    const client = supa()
    const a = await requireAuth(req, client)
    if ('error' in a) return a.error
    await client.from('push_subscriptions').delete().eq('workspace_id', a.ws.id).eq('endpoint', endpoint)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
