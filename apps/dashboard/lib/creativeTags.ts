/**
 * Tags personalizadas de criativos (A-F2). Catálogo (`creative_tags`) +
 * atribuições por ad_id (`creative_tag_assignments`), ambos por workspace.
 *
 * Namespace/source separam a tag MANUAL (usuário) da do ODIN (taxonomia IA já
 * existente em criativo_analise, importável) e da do EQUIPE (auto-tag agêntica
 * via chat). O card une as três; o filtro casa por qualquer uma.
 *
 * SEMPRE escopado por workspace_id — ad_id vem do Meta e pode colidir entre
 * tenants (mesma regra de criativo_analise).
 */
import { createClient } from '@supabase/supabase-js'
import type { CriativoTag, TagNamespace } from '@/types/criativos'

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export interface TagRow {
  id: number
  namespace: TagNamespace
  slug: string
  label: string
  color: string | null
}

/** Catálogo de tags do workspace. */
export async function listTags(workspaceId: string): Promise<TagRow[]> {
  const { data } = await sb()
    .from('creative_tags')
    .select('id,namespace,slug,label,color')
    .eq('workspace_id', workspaceId)
    .order('label')
  return (data as TagRow[] | null) ?? []
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'tag'
  )
}

/** Cria (ou reusa, via upsert no slug) uma tag do catálogo. */
export async function createTag(
  workspaceId: string,
  label: string,
  opts?: { color?: string | null; namespace?: TagNamespace; createdBy?: string | null; slug?: string },
): Promise<TagRow | null> {
  const namespace = opts?.namespace ?? 'manual'
  const slug = slugify(opts?.slug ?? label)
  const { data, error } = await sb()
    .from('creative_tags')
    .upsert(
      { workspace_id: workspaceId, namespace, slug, label, color: opts?.color ?? null, created_by: opts?.createdBy ?? null },
      { onConflict: 'workspace_id,namespace,slug' },
    )
    .select('id,namespace,slug,label,color')
    .single()
  if (error) return null
  return data as TagRow
}

/**
 * Aplica um conjunto de tags a um conjunto de ad_ids (LOTE — vários × vários).
 * Idempotente (upsert on conflict do nothing). Retorna nº de linhas afetadas.
 */
export async function applyTags(
  workspaceId: string,
  tagIds: number[],
  adRefs: string[],
  opts?: { source?: TagNamespace; assignedBy?: string | null; confidence?: number | null },
): Promise<number> {
  const ids = [...new Set(tagIds)].filter((n) => Number.isFinite(n))
  const refs = [...new Set(adRefs)].filter((s) => typeof s === 'string' && s.trim() !== '')
  if (!ids.length || !refs.length) return 0
  const source = opts?.source ?? 'manual'
  const rows = ids.flatMap((tag_id) =>
    refs.map((ad_ref) => ({
      workspace_id: workspaceId,
      tag_id,
      ad_ref,
      source,
      assigned_by: opts?.assignedBy ?? null,
      confidence: opts?.confidence ?? null,
    })),
  )
  const { error } = await sb()
    .from('creative_tag_assignments')
    .upsert(rows, { onConflict: 'workspace_id,tag_id,ad_ref', ignoreDuplicates: true })
  return error ? 0 : rows.length
}

/** Remove uma tag de um conjunto de ad_ids. */
export async function removeTag(workspaceId: string, tagId: number, adRefs: string[]): Promise<void> {
  const refs = [...new Set(adRefs)].filter((s) => typeof s === 'string' && s.trim() !== '')
  if (!refs.length) return
  await sb()
    .from('creative_tag_assignments')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('tag_id', tagId)
    .in('ad_ref', refs)
}

/** Apaga uma tag do catálogo (assignments caem por ON DELETE CASCADE). */
export async function deleteTag(workspaceId: string, tagId: number): Promise<void> {
  await sb().from('creative_tags').delete().eq('workspace_id', workspaceId).eq('id', tagId)
}

/**
 * Mapa ad_id → tags atribuídas, pra anexar aos cards. Faz 2 queries (assignments
 * + catálogo) e junta em JS — evita depender do embedding de FK do PostgREST.
 */
export async function assignmentsByAdRef(workspaceId: string): Promise<Map<string, CriativoTag[]>> {
  const client = sb()
  const [aRes, tRes] = await Promise.all([
    client.from('creative_tag_assignments').select('ad_ref,tag_id,source').eq('workspace_id', workspaceId),
    client.from('creative_tags').select('id,namespace,slug,label,color').eq('workspace_id', workspaceId),
  ])
  const tagById = new Map<number, TagRow>()
  for (const t of (tRes.data as TagRow[] | null) ?? []) tagById.set(t.id, t)

  const map = new Map<string, CriativoTag[]>()
  const assigns = (aRes.data as { ad_ref: string; tag_id: number; source: TagNamespace }[] | null) ?? []
  for (const a of assigns) {
    const t = tagById.get(a.tag_id)
    if (!t) continue
    const arr = map.get(a.ad_ref) ?? []
    arr.push({ id: t.id, slug: t.slug, label: t.label, color: t.color, namespace: t.namespace, source: a.source })
    map.set(a.ad_ref, arr)
  }
  return map
}
