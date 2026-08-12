import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import Header from '@/components/layout/Header'
import ExtrairComentariosClient from './ExtrairComentariosClient'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export default async function ExtrairComentariosPage() {
  const workspaceId = await getActiveWorkspaceId()

  let initialRows: ExtracaoRow[] = []
  if (workspaceId) {
    const { data } = await supa()
      .from('yt_comment_extractions')
      .select('id,video_id,url,video_title,channel_title,thumbnail_url,expected_comments,status,phase,comments_count,ultimo_erro,salva,expires_at,concluida_em,created_at,lease_until')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50)
    initialRows = (data ?? []) as ExtracaoRow[]
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Extrair Comentários" />
      <ExtrairComentariosClient initialRows={initialRows} />
    </div>
  )
}

export interface ExtracaoRow {
  id: string
  video_id: string
  url: string
  video_title: string | null
  channel_title: string | null
  thumbnail_url: string | null
  expected_comments: number | null
  status: 'pending' | 'processing' | 'done' | 'failed' | 'comments_disabled' | 'quota'
  phase: 'threads' | 'replies'
  comments_count: number
  ultimo_erro: string | null
  salva: boolean
  expires_at: string
  concluida_em: string | null
  created_at: string
  lease_until: string | null
}
