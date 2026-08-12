/**
 * GET  /api/criativos/ltv?ad_id=&limit=&order=ltv|recompra
 *   → lista LTV por ad (agregado) ou por ad+email se ad_id fornecido
 *
 * POST /api/criativos/ltv/backfill é separado em /backfill/route.ts
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceBySlug, resolveWorkspaceByAccountId } from '@/lib/criativo-pipeline'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  const adId = req.nextUrl.searchParams.get('ad_id')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 500)
  const accountId = req.nextUrl.searchParams.get('account_id')

  try {
    const client = supa()
    const { id: workspaceId } = accountId
      ? await resolveWorkspaceByAccountId(client, accountId)
      : await resolveWorkspaceBySlug(client)

    if (adId) {
      // Detalhe: todas as linhas pra esse ad
      const { data, error } = await client
        .from('criativo_ltv')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('ad_id', adId)
        .order('ltv_bruto', { ascending: false })
        .limit(limit)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      const compradores = data ?? []
      const ltv_medio_bruto = compradores.length
        ? compradores.reduce((s, r) => s + Number(r.ltv_bruto ?? 0), 0) / compradores.length
        : null
      const ltv_medio_liquido = compradores.length
        ? compradores.reduce((s, r) => s + Number(r.ltv_liquido ?? 0), 0) / compradores.length
        : null
      const taxa_recompra = compradores.length
        ? compradores.filter((r) => Number(r.total_compras ?? 0) > 1).length / compradores.length
        : null

      return NextResponse.json({
        workspaceId,
        ad_id: adId,
        total_compradores: compradores.length,
        ltv_medio_bruto,
        ltv_medio_liquido,
        taxa_recompra,
        compradores,
      })
    }

    // Agregado por ad_id (lê tudo, agrupa em memória — temos N pequeno por workspace)
    const { data, error } = await client
      .from('criativo_ltv')
      .select('ad_id, ltv_bruto, ltv_liquido, total_compras, dias_ate_recompra')
      .eq('workspace_id', workspaceId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const byAd = new Map<
      string,
      {
        ad_id: string
        compradores: number
        recompradores: number
        ltv_bruto_total: number
        ltv_liquido_total: number
        soma_dias_recompra: number
        n_com_dias: number
      }
    >()
    for (const r of data ?? []) {
      const adKey = r.ad_id as string
      const prev = byAd.get(adKey) ?? {
        ad_id: adKey,
        compradores: 0,
        recompradores: 0,
        ltv_bruto_total: 0,
        ltv_liquido_total: 0,
        soma_dias_recompra: 0,
        n_com_dias: 0,
      }
      prev.compradores += 1
      if (Number(r.total_compras ?? 0) > 1) prev.recompradores += 1
      prev.ltv_bruto_total += Number(r.ltv_bruto ?? 0)
      prev.ltv_liquido_total += Number(r.ltv_liquido ?? 0)
      if (r.dias_ate_recompra != null) {
        prev.soma_dias_recompra += Number(r.dias_ate_recompra)
        prev.n_com_dias += 1
      }
      byAd.set(adKey, prev)
    }

    const ads = [...byAd.values()].map((a) => ({
      ad_id: a.ad_id,
      compradores: a.compradores,
      taxa_recompra: a.compradores > 0 ? a.recompradores / a.compradores : null,
      ltv_medio_bruto: a.compradores > 0 ? a.ltv_bruto_total / a.compradores : null,
      ltv_medio_liquido: a.compradores > 0 ? a.ltv_liquido_total / a.compradores : null,
      ltv_total_bruto: a.ltv_bruto_total,
      dias_medios_recompra: a.n_com_dias > 0 ? a.soma_dias_recompra / a.n_com_dias : null,
    }))

    ads.sort((a, b) => (b.ltv_total_bruto ?? 0) - (a.ltv_total_bruto ?? 0))

    return NextResponse.json({
      workspaceId,
      total_ads: ads.length,
      ads: ads.slice(0, limit),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('ltv GET failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
