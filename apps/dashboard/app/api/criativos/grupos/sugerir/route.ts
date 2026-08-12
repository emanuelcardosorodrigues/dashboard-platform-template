/**
 * GET /api/criativos/grupos/sugerir?threshold=0.25&max=30
 *
 * Sugere clusters de criativos similares usando embeddings (vector 768d) +
 * cosine distance. NÃO persiste — apenas devolve clusters sugeridos.
 * Frontend pode chamar POST /api/criativos/grupos com filtro={ad_ids:[...]}
 * pra materializar um cluster como grupo persistente.
 *
 * Algoritmo: greedy single-link
 *  1. Pega top `max` criativos analisados ordenados por created_at desc.
 *  2. Para cada criativo, vê se cabe em algum cluster existente (distância
 *     cosine ao centróide < threshold). Se sim, junta; senão cria cluster novo.
 *  3. Centróide = média componente a componente dos embeddings do cluster.
 *
 * Não usa ivfflat index (já existe na tabela) porque com N pequeno (≤30) o
 * full scan é mais rápido que setup do índice. Threshold default 0.25
 * ≈ "razoavelmente similar" — semelhante a tópico/ângulo, não duplicado.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceFromRequest } from '@/lib/criativo-pipeline'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function parseEmbedding(s: string | null): number[] | null {
  if (!s) return null
  // Postgres vector vem como string "[0.1,0.2,...]"
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('dim mismatch')
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  if (denom === 0) return 1
  return 1 - dot / denom
}

function centroid(vectors: number[][]): number[] {
  const dim = vectors[0].length
  const out = new Array<number>(dim).fill(0)
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i]
  for (let i = 0; i < dim; i++) out[i] /= vectors.length
  return out
}

interface AdEmbedded {
  ad_id: string
  ad_name: string | null
  hook_descricao: string | null
  hook_tipo: string[] | null
  angulo_copy: string[] | null
  one_belief_score: number | null
  embedding: number[]
}

export async function GET(req: NextRequest) {
  const threshold = parseFloat(req.nextUrl.searchParams.get('threshold') ?? '0.25')
  const max = Math.min(parseInt(req.nextUrl.searchParams.get('max') ?? '30'), 100)

  try {
    const client = supa()
    const { id: workspaceId } = await resolveWorkspaceFromRequest(client, req)

    const { data, error } = await client
      .from('criativo_analise')
      .select('ad_id, ad_name, hook_descricao, hook_tipo, angulo_copy, one_belief_score, embedding')
      .eq('workspace_id', workspaceId)
      .eq('status', 'ok')
      .not('embedding', 'is', null)
      .order('gerado_at', { ascending: false })
      .limit(max)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const ads: AdEmbedded[] = []
    for (const r of data ?? []) {
      const emb = parseEmbedding(r.embedding as unknown as string)
      if (!emb || emb.length !== 768) continue
      ads.push({
        ad_id: r.ad_id,
        ad_name: r.ad_name,
        hook_descricao: r.hook_descricao,
        hook_tipo: r.hook_tipo,
        angulo_copy: r.angulo_copy,
        one_belief_score: r.one_belief_score,
        embedding: emb,
      })
    }

    if (ads.length === 0) {
      return NextResponse.json({ workspaceId, total: 0, threshold, clusters: [] })
    }

    interface Cluster {
      centroid: number[]
      members: AdEmbedded[]
    }

    const clusters: Cluster[] = []
    for (const ad of ads) {
      let bestIdx = -1
      let bestDist = Infinity
      for (let i = 0; i < clusters.length; i++) {
        const d = cosineDistance(ad.embedding, clusters[i].centroid)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }
      if (bestIdx >= 0 && bestDist < threshold) {
        clusters[bestIdx].members.push(ad)
        clusters[bestIdx].centroid = centroid(clusters[bestIdx].members.map((m) => m.embedding))
      } else {
        clusters.push({ centroid: ad.embedding.slice(), members: [ad] })
      }
    }

    const out = clusters
      .filter((c) => c.members.length >= 2) // singletons não são cluster
      .map((c, i) => ({
        cluster_id: `derivado-${i}`,
        size: c.members.length,
        nome_sugerido: c.members[0].hook_descricao?.slice(0, 60) ?? `Cluster ${i + 1}`,
        hooks_dominantes: dominantTags(c.members.map((m) => m.hook_tipo ?? [])),
        angulos_dominantes: dominantTags(c.members.map((m) => m.angulo_copy ?? [])),
        ad_ids: c.members.map((m) => m.ad_id),
        ad_names: c.members.map((m) => m.ad_name).filter(Boolean),
        one_belief_score_avg:
          c.members
            .map((m) => m.one_belief_score)
            .filter((s): s is number => typeof s === 'number')
            .reduce((a, b) => a + b, 0) / Math.max(1, c.members.length),
      }))
      .sort((a, b) => b.size - a.size)

    return NextResponse.json({
      workspaceId,
      total: ads.length,
      threshold,
      clusters: out,
      singletons: clusters.filter((c) => c.members.length === 1).length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('grupos sugerir failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function dominantTags(rows: string[][]): string[] {
  const count = new Map<string, number>()
  for (const tags of rows) for (const t of tags) count.set(t, (count.get(t) ?? 0) + 1)
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t)
}
