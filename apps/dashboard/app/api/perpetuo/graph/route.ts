/**
 * GET /api/perpetuo/graph?funil=<slug> — carrega o layout salvo do funil (ou null).
 * PUT /api/perpetuo/graph
 *   body: { funil: string, nodes: unknown[], edges: unknown[], viewport?: unknown }
 *   → upsert do layout (topologia/posição/nós custom). Métricas NÃO vêm daqui.
 *
 * Sessão + membership via requireAuth (fecha IDOR). Só topologia é persistida.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/apiAuth'
import { loadGraph, saveGraph } from '@/lib/perpetuoGraph'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

// tetos defensivos — um funil real tem dezenas de nós, não milhares
const MAX_NODES = 300
const MAX_EDGES = 600

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(req: NextRequest) {
  const funil = req.nextUrl.searchParams.get('funil')?.trim()
  if (!funil) return NextResponse.json({ error: 'funil requerido' }, { status: 400 })
  try {
    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error
    const graph = await loadGraph(client, auth.ws.id, funil)
    return NextResponse.json({ funil, graph })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('perpetuo/graph GET failed', { funil, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface SaveBody {
  funil: string
  nodes: unknown[]
  edges: unknown[]
  viewport?: unknown
}

export async function PUT(req: NextRequest) {
  let body: SaveBody
  try {
    body = (await req.json()) as SaveBody
  } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 })
  }
  const funil = typeof body.funil === 'string' ? body.funil.trim() : ''
  if (!funil) return NextResponse.json({ error: 'funil requerido' }, { status: 400 })
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    return NextResponse.json({ error: 'nodes/edges devem ser arrays' }, { status: 400 })
  }
  if (body.nodes.length > MAX_NODES || body.edges.length > MAX_EDGES) {
    return NextResponse.json({ error: 'grafo grande demais' }, { status: 413 })
  }

  try {
    const client = supa()
    const auth = await requireAuth(req, client)
    if ('error' in auth) return auth.error
    await saveGraph(
      client,
      auth.ws.id,
      funil,
      { nodes: body.nodes, edges: body.edges, viewport: body.viewport ?? null },
      auth.session.email
    )
    return NextResponse.json({ ok: true, funil })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('perpetuo/graph PUT failed', { funil, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
