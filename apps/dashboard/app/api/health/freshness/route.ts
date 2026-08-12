/**
 * GET /api/health/freshness — carimbo de frescor LEVE para o Header (mobile, F3).
 *
 * O Header é 'use client' e só recebe title/subtitle/accountOptions; ele não tem
 * como ler os timestamps de sync no servidor. Este endpoint devolve, por fonte,
 * o HH:MM (America/Sao_Paulo) da última atualização + um flag `stale` quando
 * estoura o mesmo SLA que /api/cron/health-freshness já usa (vTurb 30h, orgânico
 * 30h; Meta > META_MAX_LAG_DAYS via a última `data` coberta, igual ao DataHealthBanner).
 *
 * Best-effort por construção: o Header engole qualquer erro e simplesmente não
 * mostra o carimbo — nunca quebra o cabeçalho. Auth via requireAuth (sessão +
 * membership, mesmo fecho de IDOR das outras rotas /api).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/apiAuth'
import { fetchDataFreshness, fetchDataStaleness } from '@/lib/supabase'
import { todayBR } from '@/lib/formatters'

export const dynamic = 'force-dynamic'

// Mesmos limiares do cron /api/cron/health-freshness (fonte da verdade do SLA).
// vTurb/orgânico rodam ~diariamente → 30h tolera a cadência + folga; Meta cobre
// dia a dia → mais de 1 dia sem a data de ontem = atrasado.
const VTURB_SLA_H = 30
const ORGANIC_SLA_H = 30
const META_MAX_LAG_DAYS = 1 // 1 dia = já sinaliza; o banner do layout só grita a partir de 2

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / 3_600_000
}

/** HH:MM no fuso BR (idêntico ao rótulo "atualizado às HH:MM" do Sidebar). */
function hhmm(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  return t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

interface Stamp {
  label: string // HH:MM
  stale: boolean
}

export async function GET(req: NextRequest) {
  const client = supa()
  const a = await requireAuth(req, client)
  if ('error' in a) return a.error
  const wsId = a.ws.id

  // Meta: usa o MESMO fetchedAt que o Sidebar ("atualizado às HH:MM") + a última
  // `data` coberta pra decidir stale (mesma régua do DataHealthBanner).
  const [freshness, staleness, vturbRes, organicRes] = await Promise.all([
    fetchDataFreshness().catch(() => null),
    fetchDataStaleness().catch(() => ({ metaAds: null as string | null })),
    client
      .from('vturb_creative_daily')
      .select('synced_at')
      .eq('workspace_id', wsId)
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('organic_posts')
      .select('updated_at')
      .eq('workspace_id', wsId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  let meta: Stamp | null = null
  {
    const label = hhmm(freshness)
    if (label) {
      const metaData = staleness?.metaAds ?? null
      const dias = metaData
        ? Math.round((Date.parse(todayBR()) - Date.parse(metaData)) / 86_400_000)
        : null
      meta = { label, stale: dias !== null && dias > META_MAX_LAG_DAYS }
    }
  }

  let vturb: Stamp | null = null
  {
    const last = (vturbRes.data as { synced_at?: string } | null)?.synced_at ?? null
    const label = hhmm(last)
    const h = hoursSince(last)
    if (label) vturb = { label, stale: h === null || h > VTURB_SLA_H }
  }

  let organico: Stamp | null = null
  {
    const last = (organicRes.data as { updated_at?: string } | null)?.updated_at ?? null
    const label = hhmm(last)
    const h = hoursSince(last)
    if (label) organico = { label, stale: h === null || h > ORGANIC_SLA_H }
  }

  return NextResponse.json({ ok: true, meta, vturb, organico })
}
