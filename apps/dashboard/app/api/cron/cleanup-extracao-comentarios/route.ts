/**
 * Cron (pg_cron 03:10 UTC): apaga extrações expiradas e não salvas.
 * Cascade apaga os comentários. Clone do cleanup-transcricao-links.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

function authOk(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  if (!s) return false
  // Só Bearer: o pg_cron (job 16) usa Authorization: Bearer. O ramo ?k= vazava o
  // segredo em access logs (query string) — removido após confirmar o caller.
  return req.headers.get('authorization') === `Bearer ${s}`
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { count, error } = await supa()
      .from('yt_comment_extractions')
      .delete({ count: 'exact' })
      .lt('expires_at', new Date().toISOString())
      .eq('salva', false)
    if (error) throw error

    log.info('cleanup-extracao-comentarios', { deleted: count ?? 0 })
    return NextResponse.json({ ok: true, deleted: count ?? 0 })
  } catch (err) {
    log.error('cleanup-extracao-comentarios', { err: String(err) })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
