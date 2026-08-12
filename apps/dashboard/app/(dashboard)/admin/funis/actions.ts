'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidateTag, revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { CAMPOS_TOKEN, type ProdutoRegra, type CampanhaRegra } from '@/lib/funisConfig'

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

async function requireAdmin() {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session || session.role !== 'admin') redirect('/visao-geral')
  return session
}

// slug interno: minúsculas, só a-z0-9 (acentos/espaços caem fora). Ex.: "Imersão" → "imerso".
const slugify = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)

export interface FunilInput {
  id?: string
  nome: string
  cor: string | null
  ativo: boolean
  ordem: number
  produtos: ProdutoRegra[]
  campanhas: CampanhaRegra
}

function sanitizeProdutos(produtos: ProdutoRegra[]): ProdutoRegra[] {
  return (produtos || [])
    .filter((p) => p && typeof p.match === 'string' && p.match.trim())
    .map((p) => ({
      match: p.match.trim(),
      por: p.por === 'id' ? 'id' : 'nome',
      papel: (['front', 'ob', 'upsell', 'downsell'] as const).includes(p.papel) ? p.papel : 'front',
      ...(p.papel === 'ob' && p.ordemOb ? { ordemOb: Math.min(4, Math.max(1, Number(p.ordemOb) || 1)) } : {}),
    }))
}

function sanitizeCampanhas(c: CampanhaRegra): CampanhaRegra {
  // Allowlist = CAMPOS_TOKEN do engine. Manter as duas listas em sincronia é o
  // ponto sensível: campo novo que não entre aqui é aceito na tela e descartado
  // no salvamento, em silêncio.
  const campos = CAMPOS_TOKEN.filter((k) => c?.campos?.includes(k))
  return {
    habilitado: c?.habilitado !== false,
    tokens: (c?.tokens || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
    campos: campos.length ? campos : ['ad_name', 'sck', 'campaign_name'],
  }
}

/** Cria ou atualiza um funil. Retorna { ok, error? }. */
export async function salvarFunil(input: FunilInput): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  const ws = await getActiveWorkspaceId()
  const sb = db()
  const nome = (input.nome || '').trim()
  if (!nome) return { ok: false, error: 'Nome obrigatório.' }

  const row = {
    workspace_id: ws,
    nome,
    cor: input.cor || null,
    ativo: input.ativo !== false,
    ordem: Number(input.ordem) || 0,
    produtos: sanitizeProdutos(input.produtos),
    campanhas: sanitizeCampanhas(input.campanhas),
    updated_at: new Date().toISOString(),
  }

  if (input.id) {
    const { error } = await sb.from('funis').update(row).eq('id', input.id).eq('workspace_id', ws)
    if (error) return { ok: false, error: error.message }
  } else {
    // slug único por workspace a partir do nome.
    let base = slugify(nome) || 'funil'
    const { data: existentes } = await sb.from('funis').select('slug').eq('workspace_id', ws)
    const usados = new Set((existentes ?? []).map((r: { slug: string }) => r.slug))
    let slug = base, i = 2
    while (usados.has(slug)) { slug = `${base}${i}`; i++ }
    const { error } = await sb.from('funis').insert({ ...row, slug })
    if (error) return { ok: false, error: error.message }
  }
  revalidateTag('sb-funis', 'max')
  revalidatePath('/admin/funis')
  return { ok: true }
}

export async function deletarFunil(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  const ws = await getActiveWorkspaceId()
  const { error } = await db().from('funis').delete().eq('id', id).eq('workspace_id', ws)
  if (error) return { ok: false, error: error.message }
  revalidateTag('sb-funis', 'max')
  revalidatePath('/admin/funis')
  return { ok: true }
}
