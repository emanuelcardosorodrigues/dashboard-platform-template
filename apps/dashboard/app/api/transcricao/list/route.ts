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

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supa()
      .from('transcricao_links')
      .select('id,url,source,status,transcricao,thumbnail_url,duracao_s,salva,expires_at,ultimo_erro,created_at,processado_em')
      .eq('workspace_id', workspaceId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error

    const rows = data ?? []
    const hasPending = rows.some(
      (r: { status: string }) => r.status === 'pending' || r.status === 'processing'
    )

    return NextResponse.json({ rows, hasPending })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
