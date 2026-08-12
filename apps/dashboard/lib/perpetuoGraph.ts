/**
 * Persistência do grafo do funil perpétuo (Track B / B-P0).
 *
 * Guarda só topologia/posição + nós custom — as MÉTRICAS são reinjetadas frescas
 * a cada load no cliente (não congela dado). Um grafo por (workspace, funil_slug).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SavedGraph {
  nodes: unknown[]
  edges: unknown[]
  viewport: unknown | null
  updated_at: string | null
}

export async function loadGraph(
  client: SupabaseClient,
  workspaceId: string,
  funilSlug: string
): Promise<SavedGraph | null> {
  const { data, error } = await client
    .from('perpetuo_graphs')
    .select('nodes, edges, viewport, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('funil_slug', funilSlug)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
    viewport: data.viewport ?? null,
    updated_at: data.updated_at ?? null,
  }
}

export async function saveGraph(
  client: SupabaseClient,
  workspaceId: string,
  funilSlug: string,
  graph: { nodes: unknown[]; edges: unknown[]; viewport: unknown | null },
  updatedBy: string | null
): Promise<void> {
  const { error } = await client.from('perpetuo_graphs').upsert(
    {
      workspace_id: workspaceId,
      funil_slug: funilSlug,
      nodes: graph.nodes,
      edges: graph.edges,
      viewport: graph.viewport ?? null,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,funil_slug' }
  )
  if (error) throw new Error(error.message)
}
