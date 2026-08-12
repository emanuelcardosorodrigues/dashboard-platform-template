/**
 * GET   /api/planejamento/config — config financeira do workspace (impostos + despesas)
 * PATCH /api/planejamento/config — atualiza (upsert) a config do workspace
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}
const clamp = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : undefined
}

export async function GET() {
  try {
    const ws = await getActiveWorkspaceId()
    const { data } = await supa().from('workspace_planejamento_config').select('*').eq('workspace_id', ws).maybeSingle()
    return NextResponse.json({ config: data ?? null })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ws = await getActiveWorkspaceId()
    const b = (await req.json()) as Record<string, unknown>
    const row: Record<string, unknown> = { workspace_id: ws, updated_at: new Date().toISOString() }
    const ifp = clamp(b.imposto_faturamento_pct, 0, 1); if (ifp !== undefined) row.imposto_faturamento_pct = ifp
    const hpf = clamp(b.hotmart_pct_fee, 0, 1); if (hpf !== undefined) row.hotmart_pct_fee = hpf
    const hff = clamp(b.hotmart_fixed_fee, 0, 1000); if (hff !== undefined) row.hotmart_fixed_fee = hff
    const pv = clamp(b.pct_variavel, 0, 1); if (pv !== undefined) row.pct_variavel = pv
    if (Array.isArray(b.despesas_fixas)) {
      row.despesas_fixas = b.despesas_fixas
        .filter((x): x is { nome: string; valor: number } => !!x && typeof x === 'object')
        .map((x) => ({ nome: String((x as { nome?: unknown }).nome ?? ''), valor: Number((x as { valor?: unknown }).valor) || 0 }))
    }
    if (b.checklist_kpis_default && typeof b.checklist_kpis_default === 'object') row.checklist_kpis_default = b.checklist_kpis_default

    const { error } = await supa().from('workspace_planejamento_config').upsert(row, { onConflict: 'workspace_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
