/**
 * PATCH /api/extracao-comentarios/[id] — action 'salvar' (não expira) | 'excluir'
 * (cascade apaga os comentários). Mesmo contrato de /api/transcricao/[id].
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const action = body?.action as string | undefined

    const db = supa()

    if (action === 'salvar') {
      const { error } = await db
        .from('yt_comment_extractions')
        .update({ salva: true, expires_at: '9999-12-31T00:00:00Z' })
        .eq('id', id)
        .eq('workspace_id', workspaceId)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (action === 'excluir') {
      const { error } = await db
        .from('yt_comment_extractions')
        .delete()
        .eq('id', id)
        .eq('workspace_id', workspaceId)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'action inválido — use "salvar" ou "excluir"' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
