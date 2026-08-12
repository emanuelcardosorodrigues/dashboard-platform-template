/**
 * PATCH  /api/planejamento/[id] — edita campos do planejamento (whitelist + validação)
 * DELETE /api/planejamento/[id] — remove o planejamento (cascata leva cenários/notas)
 * Multi-tenant: toda operação é escopada por workspace_id.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { log } from '@/lib/log'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { ACAO_STATUS_VALIDOS } from '@/lib/acoesVendas'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const numClamp = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined
}

/** Sanitiza config_impostos (bounds) — evita lucro absurdo por input inválido. */
function cleanImpostos(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: Record<string, number> = {}
  const ifp = numClamp(o.imposto_faturamento_pct, 0, 1); if (ifp !== undefined) out.imposto_faturamento_pct = ifp
  const hpf = numClamp(o.hotmart_pct_fee, 0, 1); if (hpf !== undefined) out.hotmart_pct_fee = hpf
  const hff = numClamp(o.hotmart_fixed_fee, 0, 1000); if (hff !== undefined) out.hotmart_fixed_fee = hff
  return out
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ws = await getActiveWorkspaceId()
    const b = (await req.json()) as Record<string, unknown>
    const patch: Record<string, unknown> = {}

    if (typeof b.nome === 'string' && b.nome.trim()) patch.nome = b.nome.trim()
    if (typeof b.descricao === 'string') patch.descricao = b.descricao
    if ('sigla' in b) {
      const s = typeof b.sigla === 'string' ? b.sigla.trim().toUpperCase() : ''
      if (s === '' || /^[A-Z0-9]{3,}$/.test(s)) patch.sigla = s || null
      else return NextResponse.json({ error: 'sigla inválida (≥3 chars, A-Z 0-9)' }, { status: 400 })
    }
    if ('thumbnail_url' in b) patch.thumbnail_url = typeof b.thumbnail_url === 'string' && b.thumbnail_url.trim() ? b.thumbnail_url.trim() : null
    if (typeof b.status === 'string') {
      if (!ACAO_STATUS_VALIDOS.includes(b.status as never)) return NextResponse.json({ error: 'status inválido' }, { status: 400 })
      patch.status = b.status
    }
    if ('perpetuo' in b) patch.perpetuo = b.perpetuo === true
    if ('data_inicio' in b) patch.data_inicio = (b.data_inicio as string) || null
    if ('data_fim' in b) patch.data_fim = (b.data_fim as string) || null
    if ('produtos_front' in b) patch.produtos_front = arr(b.produtos_front)
    if ('produtos_ob' in b) patch.produtos_ob = arr(b.produtos_ob)
    if ('produtos_upsell' in b) patch.produtos_upsell = arr(b.produtos_upsell)
    if ('produtos_downsell' in b) patch.produtos_downsell = arr(b.produtos_downsell)
    if ('metas' in b && b.metas && typeof b.metas === 'object') patch.metas = b.metas
    if ('comparacao_kpis' in b && b.comparacao_kpis && typeof b.comparacao_kpis === 'object') patch.comparacao_kpis = b.comparacao_kpis
    if ('config_impostos' in b) { const c = cleanImpostos(b.config_impostos); if (c) patch.config_impostos = c }
    if ('arquivada_em' in b) patch.arquivada_em = b.arquivada_em ? new Date(String(b.arquivada_em)).toISOString() : null

    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nada a atualizar' }, { status: 400 })

    const { error } = await supa().from('acoes_vendas').update(patch).eq('id', id).eq('workspace_id', ws)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('planejamento PATCH failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ws = await getActiveWorkspaceId()
    const { error } = await supa().from('acoes_vendas').delete().eq('id', id).eq('workspace_id', ws)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
