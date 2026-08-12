'use server'

/**
 * Sync de predefinições de colunas no Supabase (Fase 3.3). Privadas por usuário
 * (sessão), com opção de compartilhar e marcar padrão. Degrada graciosamente:
 * se a tabela column_presets ainda não foi criada (migration 0017 não aplicada),
 * todas as funções retornam vazio/no-op e o seletor segue só com localStorage.
 */

import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}
async function currentSession() {
  const id = (await cookies()).get(SESSION_COOKIE)?.value
  return id ? lookupSession(id) : null
}

interface ServerPreset {
  name: string
  ids: string[]
  shared: boolean
  isDefault: boolean
  owner: boolean
}

interface PresetRow {
  name: string
  payload: { ids?: unknown } | null
  owner_user: string | null
  visibility: string
  is_default: boolean
}

/** Presets do servidor visíveis ao usuário: os DELE + os compartilhados + os padrão. */
export async function loadColumnPresets(scope: string): Promise<ServerPreset[]> {
  const s = await currentSession()
  if (!s) return []
  const { data, error } = await supa()
    .from('column_presets')
    .select('name, payload, owner_user, visibility, is_default')
    .eq('scope', scope)
  if (error) return [] // tabela ausente ou erro → degrada pra localStorage-only
  const email = s.email.toLowerCase()
  return (data ?? [])
    .map((r: PresetRow) => {
      const ids = Array.isArray(r.payload?.ids)
        ? (r.payload!.ids as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      return {
        name: r.name,
        ids,
        shared: r.visibility === 'shared',
        isDefault: !!r.is_default,
        owner: (r.owner_user ?? '').toLowerCase() === email,
      }
    })
    .filter((p) => p.ids.length > 0 && (p.shared || p.owner || p.isDefault))
}

export async function saveColumnPresetAction(
  scope: string,
  name: string,
  ids: string[],
  visibility: 'private' | 'shared' = 'private',
): Promise<{ ok: boolean; error?: string }> {
  const s = await currentSession()
  if (!s) return { ok: false, error: 'unauthorized' }
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'nome vazio' }
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'preset vazio' }
  const { error } = await supa()
    .from('column_presets')
    .upsert(
      { scope, name: trimmed, payload: { ids }, owner_user: s.email, visibility, updated_at: new Date().toISOString() },
      { onConflict: 'scope,owner_user,name' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteColumnPresetAction(scope: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const s = await currentSession()
  if (!s) return { ok: false, error: 'unauthorized' }
  const { error } = await supa()
    .from('column_presets')
    .delete()
    .eq('scope', scope)
    .eq('owner_user', s.email)
    .eq('name', name)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Marca um preset como padrão do escopo (admin). Limpa o default anterior. */
export async function setDefaultColumnPresetAction(scope: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const s = await currentSession()
  if (!s || s.role !== 'admin') return { ok: false, error: 'forbidden' }
  const client = supa()
  await client.from('column_presets').update({ is_default: false }).eq('scope', scope).eq('is_default', true)
  const { error } = await client.from('column_presets').update({ is_default: true }).eq('scope', scope).eq('name', name)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
