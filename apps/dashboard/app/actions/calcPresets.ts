'use server'

/**
 * Predefinições da Calculadora Estratégica (S8). Um preset guarda o cenário inteiro:
 * funil, janela, posição dos sliders, métrica-objetivo, VSL on/off e backend.
 *
 * ISOLAMENTO — leia antes de mexer: RLS não isola usuário neste app. O servidor fala
 * com o Supabase via service_role, que bypassa policy por design do Postgres (a
 * migration 0066 liga RLS deny-all só pra barrar a chave anon). Quem isola é o filtro
 * OBRIGATÓRIO por `workspace_id` + `owner_user` em TODA query daqui. Toda função abaixo
 * aplica os dois. Tirar um deles vaza preset entre usuários ou entre projetos.
 *
 * Degrada graciosamente: se a migration 0066 não foi aplicada, listar devolve vazio e
 * salvar devolve erro legível — a aba continua funcionando sem presets (mesmo padrão
 * de app/actions/columnPresets.ts).
 */

import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function currentSession() {
  const id = (await cookies()).get(SESSION_COOKIE)?.value
  return id ? lookupSession(id) : null
}

/** Escopo de toda operação: workspace ativo + dono. Sem os dois, não opera. */
async function escopo(): Promise<{ workspaceId: string; owner: string } | null> {
  const s = await currentSession()
  if (!s) return null
  const workspaceId = await getActiveWorkspaceId()
  if (!workspaceId) return null
  return { workspaceId, owner: s.email.toLowerCase() }
}

export interface CalcPreset {
  nome: string
  funil: string | null
  config: Record<string, unknown>
  criadoEm: string
}

interface PresetRow {
  nome: string
  funil: string | null
  config: Record<string, unknown> | null
  created_at: string
}

/** Presets do usuário logado, no workspace ativo. Nunca devolve preset de outro dono. */
export async function listCalcPresets(): Promise<CalcPreset[]> {
  const e = await escopo()
  if (!e) return []
  const { data, error } = await supa()
    .from('calc_presets')
    .select('nome, funil, config, created_at')
    .eq('workspace_id', e.workspaceId)
    .eq('owner_user', e.owner)
    .order('created_at', { ascending: false })
  if (error) return [] // tabela ausente (0066 não aplicada) ou erro → degrada pra sem-presets
  return (data ?? []).map((r: PresetRow) => ({
    nome: r.nome,
    funil: r.funil,
    config: r.config ?? {},
    criadoEm: r.created_at,
  }))
}

export async function saveCalcPresetAction(
  nome: string,
  funil: string | null,
  config: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const e = await escopo()
  if (!e) return { ok: false, error: 'unauthorized' }
  const trimmed = (nome ?? '').trim()
  if (!trimmed) return { ok: false, error: 'nome vazio' }
  if (trimmed.length > 60) return { ok: false, error: 'nome muito longo (máx. 60)' }
  if (!config || typeof config !== 'object') return { ok: false, error: 'cenário vazio' }

  const { error } = await supa()
    .from('calc_presets')
    .upsert(
      {
        workspace_id: e.workspaceId,
        owner_user: e.owner,
        funil: funil || null,
        nome: trimmed,
        config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,owner_user,nome' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteCalcPresetAction(nome: string): Promise<{ ok: boolean; error?: string }> {
  const e = await escopo()
  if (!e) return { ok: false, error: 'unauthorized' }
  const { error } = await supa()
    .from('calc_presets')
    .delete()
    .eq('workspace_id', e.workspaceId)
    .eq('owner_user', e.owner)
    .eq('nome', nome)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
