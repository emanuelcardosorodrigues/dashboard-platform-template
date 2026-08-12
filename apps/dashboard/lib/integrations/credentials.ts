/**
 * Leitura/escrita de credenciais de integração por projeto (workspace).
 *
 * As credenciais vivem CIFRADAS em `workspace_credentials` (ver migration 0029) e
 * são decifradas sob demanda aqui, no servidor. A factory de integrações (Onda 5)
 * consome `getWorkspaceCredential` pra montar o client de cada provider por
 * projeto; o wizard de onboarding (Onda 10) usa `setWorkspaceCredential`.
 *
 * Cada provider guarda um objeto JSON próprio (ex: meta = { accessToken,
 * pageToken?, accountIds[] }). `meta` (jsonb não-secreto) guarda dicas públicas
 * (ex: ga4 property_id) que não precisam cifrar.
 */
import { createClient } from '@supabase/supabase-js'
import { cache } from 'react'
import { encryptSecret, decryptSecret, type EncryptedSecret } from '@/lib/crypto/secrets'

export type IntegrationProvider =
  | 'meta' | 'vturb' | 'ga4' | 'clarity' | 'hotmart' | 'cloudflare' | 'nfse'
  | 'youtube' | 'instagram' | 'tiktok'

function sb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface CredRow {
  ciphertext: string
  iv: string
  auth_tag: string
  meta: Record<string, unknown> | null
}

/**
 * Segredos decifrados de um provider pra um workspace, + meta público. null se
 * não houver linha (→ a factory cai pro env global, mantendo o DEMO funcionando
 * antes de migrar as creds dele pra tabela).
 */
export const getWorkspaceCredential = cache(async <T = Record<string, unknown>>(
  workspaceId: string,
  provider: IntegrationProvider,
): Promise<{ secret: T; meta: Record<string, unknown> } | null> => {
  const { data, error } = await sb()
    .from('workspace_credentials')
    .select('ciphertext, iv, auth_tag, meta')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .maybeSingle()
  if (error || !data) return null
  const row = data as CredRow
  const enc: EncryptedSecret = { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }
  try {
    return { secret: decryptSecret<T>(enc), meta: row.meta ?? {} }
  } catch (e) {
    console.error(`[credentials] decrypt falhou (${provider}/${workspaceId}):`, (e as Error).message)
    return null
  }
})

/** Workspaces (ids distintos) que têm credencial própria de um provider.
 *  Usado pelos crons-dispatcher: alvos = [DEMO default] ∪ estes. */
export async function listWorkspacesWithProvider(provider: IntegrationProvider): Promise<string[]> {
  const { data, error } = await sb().from('workspace_credentials').select('workspace_id').eq('provider', provider)
  if (error || !data) return []
  return [...new Set((data as { workspace_id: string }[]).map((r) => r.workspace_id))]
}

/** Providers configurados de um workspace (só status, SEM decifrar segredos). */
export async function listConfiguredProviders(
  workspaceId: string,
): Promise<{ provider: IntegrationProvider; updated_at: string; meta: Record<string, unknown> }[]> {
  const { data, error } = await sb()
    .from('workspace_credentials')
    .select('provider, updated_at, meta')
    .eq('workspace_id', workspaceId)
  if (error || !data) return []
  return data as { provider: IntegrationProvider; updated_at: string; meta: Record<string, unknown> }[]
}

/** Remove a credencial de um provider de um workspace. */
export async function deleteWorkspaceCredential(workspaceId: string, provider: IntegrationProvider): Promise<void> {
  await sb().from('workspace_credentials').delete().eq('workspace_id', workspaceId).eq('provider', provider)
}

/** Grava (cifrando) as credenciais de um provider pra um workspace. */
export async function setWorkspaceCredential(
  workspaceId: string,
  provider: IntegrationProvider,
  secret: Record<string, unknown>,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const enc = encryptSecret(secret)
  const { error } = await sb().from('workspace_credentials').upsert(
    {
      workspace_id: workspaceId,
      provider,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      auth_tag: enc.authTag,
      meta,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,provider' },
  )
  if (error) throw new Error(`setWorkspaceCredential falhou: ${error.message}`)
}
