'use server'

/**
 * Ações da aba Análises de Comentários:
 *  - confirmar/remover palavra-gatilho de automação (organic_comment_triggers);
 *  - atualizar a síntese de IA (dispara o endpoint analyze-comment-insights server-side,
 *    mantendo o CRON_SECRET fora do cliente).
 */
import { createClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { normalizeTrigger } from '@/lib/organico/comentarios'

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export async function confirmarGatilho(word: string): Promise<void> {
  const w = normalizeTrigger(word)
  if (w.length < 2 || w.length > 24) return
  const ws = await getActiveWorkspaceId()
  await sb().from('organic_comment_triggers').upsert({ workspace_id: ws, word: w }, { onConflict: 'workspace_id,word' })
  revalidateTag('sb-organico-triggers', 'max')
  revalidateTag('sb-organico', 'max')
}

export async function removerGatilho(word: string): Promise<void> {
  const w = normalizeTrigger(word)
  const ws = await getActiveWorkspaceId()
  await sb().from('organic_comment_triggers').delete().eq('workspace_id', ws).eq('word', w)
  revalidateTag('sb-organico-triggers', 'max')
  revalidateTag('sb-organico', 'max')
}

export async function atualizarAnaliseComentarios(): Promise<{ ok: boolean; erro?: string }> {
  const ws = await getActiveWorkspaceId()
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: false, erro: 'CRON_SECRET ausente' }
  const base = process.env.DASHBOARD_PUBLIC_URL || 'https://dashboard.example.com'
  try {
    const r = await fetch(`${base}/api/cron/analyze-comment-insights?ws=${ws}`, {
      headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store',
    })
    revalidateTag('sb-organico-cinsights', 'max')
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: String((e as Error)?.message ?? e).slice(0, 120) }
  }
}
