/**
 * Tags personalizadas de criativos (A-F2).
 *   GET    /api/criativos/tags   — catálogo de tags do workspace
 *   POST   /api/criativos/tags   — aplica tags em LOTE (vários ad_ids × várias tags).
 *                                  body: { create?: {label,color?}, tagIds?: number[], adRefs: string[] }
 *   DELETE /api/criativos/tags   — remove atribuição ou apaga a tag do catálogo.
 *                                  body: { tagId: number, adRefs?: string[], deleteTag?: boolean }
 *
 * Auth SESSION-AUTHORITATIVE: sessão pelo cookie + workspace ativo da sessão
 * (getActiveWorkspaceId) — NÃO deriva tenant de parâmetro do cliente (evita o
 * IDOR do resolveWorkspaceFromRequest). O proxy já restringe /api/criativos/* a admin.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession, type SessionInfo } from '@/lib/sessions'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listTags, createTag, applyTags, removeTag, deleteTag } from '@/lib/creativeTags'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

async function requireSession(): Promise<SessionInfo | null> {
  const c = await cookies()
  const sid = c.get(SESSION_COOKIE)?.value
  return sid ? lookupSession(sid) : null
}

export async function GET() {
  try {
    const s = await requireSession()
    if (!s) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    const workspaceId = await getActiveWorkspaceId()
    const tags = await listTags(workspaceId)
    return NextResponse.json({ workspaceId, tags })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('tags GET failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface ApplyBody {
  create?: { label?: string; color?: string | null }
  tagIds?: number[]
  adRefs?: string[]
}

export async function POST(req: NextRequest) {
  try {
    const s = await requireSession()
    if (!s) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    const workspaceId = await getActiveWorkspaceId()

    const body = (await req.json()) as ApplyBody
    const adRefs = (body.adRefs ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    const tagIds = [...new Set((body.tagIds ?? []).filter((n) => Number.isFinite(n)))]

    let createdTag = null
    if (body.create?.label) {
      createdTag = await createTag(workspaceId, body.create.label, {
        color: body.create.color ?? null,
        namespace: 'manual',
        createdBy: s.email,
      })
      if (createdTag) tagIds.push(createdTag.id)
    }
    if (!tagIds.length) return NextResponse.json({ error: 'Nenhuma tag informada' }, { status: 400 })

    const applied = adRefs.length
      ? await applyTags(workspaceId, tagIds, adRefs, { source: 'manual', assignedBy: s.email })
      : 0
    return NextResponse.json({ ok: true, tag: createdTag, applied }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('tags POST failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface DeleteBody {
  tagId?: number
  adRefs?: string[]
  deleteTag?: boolean
}

export async function DELETE(req: NextRequest) {
  try {
    const s = await requireSession()
    if (!s) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    const workspaceId = await getActiveWorkspaceId()

    const body = (await req.json()) as DeleteBody
    if (!body.tagId || !Number.isFinite(body.tagId)) {
      return NextResponse.json({ error: 'tagId requerido' }, { status: 400 })
    }
    if (body.deleteTag) {
      await deleteTag(workspaceId, body.tagId)
      return NextResponse.json({ ok: true, deleted: 'tag' })
    }
    const adRefs = (body.adRefs ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    if (!adRefs.length) return NextResponse.json({ error: 'adRefs requerido' }, { status: 400 })
    await removeTag(workspaceId, body.tagId, adRefs)
    return NextResponse.json({ ok: true, removed: adRefs.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('tags DELETE failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
