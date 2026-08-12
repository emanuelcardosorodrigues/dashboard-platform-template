/**
 * GET /api/extracao-comentarios/[id]/rows?after_id=0&limit=2000
 * Keyset pagination (id crescente) pro export CSV/XLSX no client.
 * Valida que a extração pertence ao workspace ANTES de devolver comentários.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { parseQuery, badRequest, extracaoRowsQuerySchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = parseQuery(req.url, extracaoRowsQuerySchema)
    if (!parsed.ok) {
      const { status, body } = badRequest(parsed)
      return NextResponse.json(body, { status })
    }
    const { after_id, limit } = parsed.data

    const db = supa()

    // Escopo de tenant: a extração tem que ser deste workspace
    const { data: extr, error: extrErr } = await db
      .from('yt_comment_extractions')
      .select('id')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (extrErr) throw extrErr
    if (!extr) return NextResponse.json({ error: 'Extração não encontrada' }, { status: 404 })

    const { data, error } = await db
      .from('yt_extracted_comments')
      .select('id,external_id,parent_external_id,author,author_channel_url,text,like_count,reply_count,published_at')
      .eq('extraction_id', id)
      .gt('id', after_id)
      .order('id', { ascending: true })
      .limit(limit)
    if (error) throw error

    const rows = data ?? []
    const nextAfterId = rows.length === limit ? rows[rows.length - 1].id : null

    return NextResponse.json({ rows, nextAfterId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
