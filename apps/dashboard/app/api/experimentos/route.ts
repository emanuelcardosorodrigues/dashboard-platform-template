import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  parseBody,
  badRequest,
  experimentoCreateSchema,
  experimentoDeleteSchema,
  experimentoPatchSchema,
} from '@/lib/validation/schemas'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { edgeForWorkspace } from '@/lib/abEdge'
import { diffVariants } from '@/lib/variantEvents'
import { registrarEventos, variantesAtuais } from '@/lib/variantEventsDb'

export const dynamic = 'force-dynamic'

function getClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// KV key: experiment:{workspaceId}:{type}:{entry_path}
// A borda é resolvida POR WORKSPACE (conta Cloudflare própria) — nunca escreve
// no KV de outro projeto. Sem conta configurada, pula: o Worker converge pelo TTL.
async function invalidateKV(workspaceId: string, entryPath: string, type: string) {
  const edge = edgeForWorkspace(workspaceId)
  if (!edge) return

  const base = `https://api.cloudflare.com/client/v4/accounts/${edge.accountId}/storage/kv/namespaces/${edge.kvNamespaceId}/values`
  const headers = { Authorization: `Bearer ${edge.apiToken}` }

  await fetch(`${base}/${encodeURIComponent(`experiment:${workspaceId}:${type}:${entryPath}`)}`, { method: 'DELETE', headers }).catch(() => {})
}

// Sincroniza fallback_url no D1 local (redundância de borda), na conta DO workspace.
// Executado em background — nunca bloqueia a resposta ao cliente.
async function syncD1Fallback(workspaceId: string, entryPath: string, type: string, fallbackUrl: string | null | undefined) {
  if (!fallbackUrl) return
  const edge = edgeForWorkspace(workspaceId)
  if (!edge || !edge.d1DatabaseId) return

  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${edge.accountId}/d1/database/${edge.d1DatabaseId}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${edge.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: 'INSERT OR REPLACE INTO rotas (path, type, fallback_url) VALUES (?, ?, ?)',
        params: [`${workspaceId}:${entryPath}`, type, fallbackUrl],
      }),
    }
  ).catch(() => {})
}

// Verifica se já existe outro experimento ativo no mesmo (type, entry_path).
// O KV só guarda a última gravação, então duplicatas viram "fantasmas" no banco
// que nunca são servidas em produção.
async function checkPathConflict(
  db: ReturnType<typeof getClient>,
  args: { id?: string; type: string; entry_path: string; workspaceId: string }
): Promise<string | null> {
  let q = db
    .from('experiments')
    .select('id, name')
    .eq('workspace_id', args.workspaceId)
    .eq('status', 'active')
    .eq('type', args.type)
    .eq('entry_path', args.entry_path)
    .limit(1)
  if (args.id) q = q.neq('id', args.id)
  const { data, error } = await q
  if (error) return error.message
  if (data && data.length > 0) {
    return `Já existe um experimento ativo de ${args.type} em "${args.entry_path}" (${data[0].name}). Encerre antes de ativar outro.`
  }
  return null
}

// Para checkout/ob, o chtml lê ?ck= / ?ob= da URL (parâmetros globais sem
// namespace por entry_path). Slugs duplicados entre exps ativos do mesmo tipo
// fazem o sckSlug colidir e a atribuição vira ambígua.
async function checkSlugConflict(
  db: ReturnType<typeof getClient>,
  args: { id?: string; type: string; variants: { slug: string }[]; workspaceId: string }
): Promise<string | null> {
  if (args.type !== 'checkout' && args.type !== 'ob' && args.type !== 'page') return null
  const incoming = new Set(
    args.variants.map((v) => v.slug?.trim()).filter((s): s is string => !!s)
  )
  if (incoming.size === 0) return null

  let q = db
    .from('experiments')
    .select('id, name, variants')
    .eq('workspace_id', args.workspaceId)
    .eq('status', 'active')
    .eq('type', args.type)
  if (args.id) q = q.neq('id', args.id)
  const { data, error } = await q
  if (error) return error.message

  for (const other of data ?? []) {
    const otherVariants = (other.variants ?? []) as { slug: string }[]
    for (const v of otherVariants) {
      const slug = v.slug?.trim()
      if (slug && incoming.has(slug)) {
        return `Slug "${slug}" já é usado pelo experimento ativo "${other.name}". Use slugs únicos por tipo.`
      }
    }
  }
  return null
}

// GET — lista os experimentos DO PROJETO ATIVO
export async function GET() {
  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()
  const { data, error } = await db
    .from('experiments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

function checkAdminPassword(req: NextRequest): boolean {
  const expected = process.env.ADMIN_ACTION_PASSWORD
  if (!expected) return false // fail-closed
  return req.headers.get('x-admin-password') === expected
}

// POST — create experiment
export async function POST(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: 'Senha de admin incorreta.' }, { status: 401 })
  }

  const parsed = await parseBody(req, experimentoCreateSchema)
  if (!parsed.ok) {
    const r = badRequest(parsed)
    return NextResponse.json(r.body, { status: r.status })
  }
  const { name, entry_path, type, variants, fallback_url, scheduled_start, scheduled_end, status: reqStatus, matrix, checkout_slug, vturb_enabled, auto_optimize, champion_variant, bandit_min_conv } = parsed.data

  // Regras cruzadas que o Zod não cobre (envolvem combinação de campos).
  if (type !== 'ob' && !fallback_url?.trim()) {
    return NextResponse.json({ error: 'fallback_url é obrigatória para experimentos de página e checkout.' }, { status: 400 })
  }

  // Variantes desativadas (enabled === false) saem do sorteio; o Worker
  // renormaliza os pesos das ATIVAS. Por isso a validação é sobre as ativas.
  const enabledVariants = variants.filter((v) => v.enabled !== false)
  if (enabledVariants.length === 0) {
    return NextResponse.json({ error: 'Ao menos uma variante deve estar ativa.' }, { status: 400 })
  }
  if (enabledVariants.reduce((s, v) => s + v.weight, 0) <= 0) {
    return NextResponse.json({ error: 'As variantes ativas devem ter peso total maior que zero.' }, { status: 400 })
  }

  if (scheduled_start && scheduled_end && new Date(scheduled_start) >= new Date(scheduled_end)) {
    return NextResponse.json({ error: 'scheduled_start deve ser anterior a scheduled_end.' }, { status: 400 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const status = reqStatus === 'active' ? 'active' : 'draft'
  const row: Record<string, unknown> = { workspace_id: workspaceId, name, entry_path, type, variants, status }
  if (status === 'active') row.started_at = new Date().toISOString()
  if (type !== 'ob' && fallback_url) row.fallback_url = fallback_url.trim()
  if (scheduled_start) row.scheduled_start = scheduled_start
  if (scheduled_end) row.scheduled_end = scheduled_end
  if (type === 'ob' && matrix) row.matrix = matrix
  if (type === 'page' && checkout_slug?.trim()) row.checkout_slug = checkout_slug.trim()
  if (vturb_enabled !== undefined) row.vturb_enabled = vturb_enabled
  if (auto_optimize !== undefined) row.auto_optimize = auto_optimize
  if (champion_variant !== undefined) row.champion_variant = champion_variant
  if (bandit_min_conv !== undefined) row.bandit_min_conv = bandit_min_conv

  const db = getClient()

  if (status === 'active') {
    const pathErr = await checkPathConflict(db, { type, entry_path, workspaceId })
    if (pathErr) return NextResponse.json({ error: pathErr }, { status: 409 })
    const slugErr = await checkSlugConflict(db, { type, variants, workspaceId })
    if (slugErr) return NextResponse.json({ error: slugErr }, { status: 409 })
  }

  const { data, error } = await db
    .from('experiments')
    .insert(row)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Histórico: as variantes iniciais nascem como "criada" (diff de [] → variants).
  await registrarEventos(db, data.id, workspaceId, diffVariants([], variants, 'manual'))

  if (status === 'active') {
    await Promise.all([
      invalidateKV(workspaceId, entry_path, type),
      syncD1Fallback(workspaceId, entry_path, type, fallback_url),
    ])
  }

  return NextResponse.json(data, { status: 201 })
}

// DELETE — remove draft ou pausado (requer senha de admin)
export async function DELETE(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: 'Senha de admin incorreta.' }, { status: 401 })
  }

  const parsed = await parseBody(req, experimentoDeleteSchema)
  if (!parsed.ok) {
    const r = badRequest(parsed)
    return NextResponse.json(r.body, { status: r.status })
  }
  const { id } = parsed.data

  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()

  const { data: exp, error: fetchError } = await db
    .from('experiments')
    .select('status')
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .single()

  if (fetchError || !exp) return NextResponse.json({ error: 'Experimento não encontrado.' }, { status: 404 })
  if (exp.status === 'active') {
    return NextResponse.json({ error: 'Encerre o experimento antes de excluir.' }, { status: 400 })
  }

  await db.from('impressions').delete().eq('workspace_id', workspaceId).eq('experiment_id', id)

  const { error } = await db.from('experiments').delete().eq('workspace_id', workspaceId).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

// PATCH — update status, matrix, or experiment content
export async function PATCH(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: 'Senha de admin incorreta.' }, { status: 401 })
  }

  const parsed = await parseBody(req, experimentoPatchSchema)
  if (!parsed.ok) {
    const r = badRequest(parsed)
    return NextResponse.json(r.body, { status: r.status })
  }
  const { id, status, matrix, name, variants, fallback_url, checkout_slug, vturb_enabled, auto_optimize, champion_variant, bandit_min_conv } = parsed.data

  const db = getClient()
  const workspaceId = await getActiveWorkspaceId()

  // Salvar matriz de links do OB
  if (matrix !== undefined) {
    const { data, error } = await db
      .from('experiments')
      .update({ matrix })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await invalidateKV(workspaceId, data.entry_path, data.type ?? 'ob')
    return NextResponse.json(data)
  }

  // Editar conteúdo do experimento (nome, variantes, fallback, checkout_slug, flags 2.0)
  const editingContent = name !== undefined || variants !== undefined || fallback_url !== undefined || checkout_slug !== undefined || vturb_enabled !== undefined || auto_optimize !== undefined || champion_variant !== undefined || bandit_min_conv !== undefined
  if (editingContent) {
    if (variants !== undefined) {
      const enabledVariants = variants.filter((v) => v.enabled !== false)
      if (enabledVariants.length === 0) {
        return NextResponse.json({ error: 'Ao menos uma variante deve estar ativa.' }, { status: 400 })
      }
      if (enabledVariants.reduce((s, v) => s + v.weight, 0) <= 0) {
        return NextResponse.json({ error: 'As variantes ativas devem ter peso total maior que zero.' }, { status: 400 })
      }

      // Mudança de slug em exp ativo pode introduzir colisão com outro ativo do mesmo tipo
      const { data: current, error: fetchErr } = await db
        .from('experiments')
        .select('type, status, workspace_id')
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .single()
      if (fetchErr || !current) {
        return NextResponse.json({ error: 'Experimento não encontrado.' }, { status: 404 })
      }
      if (current.status === 'active') {
        const slugErr = await checkSlugConflict(db, { id, type: current.type, variants, workspaceId: current.workspace_id })
        if (slugErr) return NextResponse.json({ error: slugErr }, { status: 409 })
      }
    }
    // Snapshot do "antes" ANTES do update — depois dele o estado anterior some pra sempre
    // (o JSON de variants guarda só o atual).
    const antes = variants !== undefined ? await variantesAtuais(db, id, workspaceId) : []

    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (variants !== undefined) updates.variants = variants
    if (fallback_url !== undefined) updates.fallback_url = fallback_url ? fallback_url : null
    if (checkout_slug !== undefined) updates.checkout_slug = checkout_slug ? checkout_slug : null
    if (vturb_enabled !== undefined) updates.vturb_enabled = vturb_enabled
    if (auto_optimize !== undefined) updates.auto_optimize = auto_optimize
    if (champion_variant !== undefined) updates.champion_variant = champion_variant
    if (bandit_min_conv !== undefined) updates.bandit_min_conv = bandit_min_conv

    const { data, error } = await db
      .from('experiments')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (variants !== undefined) {
      await registrarEventos(db, id, workspaceId, diffVariants(antes, variants, 'manual'))
    }

    await Promise.all([
      invalidateKV(workspaceId, data.entry_path, data.type ?? 'page'),
      syncD1Fallback(workspaceId, data.entry_path, data.type ?? 'page', data.fallback_url),
    ])
    return NextResponse.json(data)
  }

  // Alterar status
  if (!status) {
    return NextResponse.json({ error: 'Campos obrigatórios: id + (status, matrix, name ou variants)' }, { status: 400 })
  }

  if (status === 'active') {
    const { data: current, error: fetchErr } = await db
      .from('experiments')
      .select('type, entry_path, variants, workspace_id')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single()
    if (fetchErr || !current) {
      return NextResponse.json({ error: 'Experimento não encontrado.' }, { status: 404 })
    }
    const pathErr = await checkPathConflict(db, {
      id,
      type: current.type,
      entry_path: current.entry_path,
      workspaceId: current.workspace_id,
    })
    if (pathErr) return NextResponse.json({ error: pathErr }, { status: 409 })
    const slugErr = await checkSlugConflict(db, {
      id,
      type: current.type,
      variants: (current.variants ?? []) as { slug: string }[],
      workspaceId: current.workspace_id,
    })
    if (slugErr) return NextResponse.json({ error: slugErr }, { status: 409 })
  }

  const updates: Record<string, unknown> = { status }
  if (status === 'active') updates.started_at = new Date().toISOString()
  if (status === 'ended') updates.ended_at = new Date().toISOString()

  const { data, error } = await db
    .from('experiments')
    .update(updates)
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await Promise.all([
    invalidateKV(workspaceId, data.entry_path, data.type ?? 'page'),
    syncD1Fallback(workspaceId, data.entry_path, data.type ?? 'page', data.fallback_url),
  ])

  return NextResponse.json(data)
}
