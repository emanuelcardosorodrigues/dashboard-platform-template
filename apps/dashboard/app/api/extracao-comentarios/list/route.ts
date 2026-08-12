/**
 * GET /api/extracao-comentarios/list — últimas 50 extrações do workspace
 * (sem os textos — export busca via [id]/rows). hasActive alimenta o polling.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET() {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supa()
      .from('yt_comment_extractions')
      .select('id,video_id,url,video_title,channel_title,thumbnail_url,expected_comments,status,phase,comments_count,ultimo_erro,salva,expires_at,concluida_em,created_at,lease_until')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error

    const rows = data ?? []
    const hasActive = rows.some(
      (r: { status: string }) => r.status === 'pending' || r.status === 'processing'
    )

    return NextResponse.json({ rows, hasActive })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
