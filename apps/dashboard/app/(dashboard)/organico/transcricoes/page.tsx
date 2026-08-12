import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import Header from '@/components/layout/Header'
import TranscricoesClient from './TranscricoesClient'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export default async function TranscricoesPage() {
  const workspaceId = await getActiveWorkspaceId()
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  let initialRows: TranscricaoLink[] = []
  if (workspaceId) {
    const { data } = await supa()
      .from('transcricao_links')
      .select('id,url,source,status,transcricao,thumbnail_url,duracao_s,salva,expires_at,ultimo_erro,created_at,processado_em')
      .eq('workspace_id', workspaceId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(50)
    initialRows = (data ?? []) as TranscricaoLink[]
  }

  const hasPending = initialRows.some((r) => r.status === 'pending' || r.status === 'processing')

  return (
    <div className="flex flex-col h-full">
      <Header title="Transcrições de Links" />
      <TranscricoesClient initialRows={initialRows} hasPendingInitially={hasPending} />
    </div>
  )
}

export interface TranscricaoLink {
  id: string
  url: string
  source: 'instagram' | 'youtube'
  status: 'pending' | 'processing' | 'ok' | 'failed' | 'no_audio'
  transcricao: string | null
  thumbnail_url: string | null
  duracao_s: number | null
  salva: boolean
  expires_at: string
  ultimo_erro: string | null
  created_at: string
  processado_em: string | null
}
