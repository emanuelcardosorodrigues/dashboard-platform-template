/**
 * Cron job: sincroniza dados do Meta Ads → Supabase
 *
 * Roda via Vercel Cron + cron-job.org (hourly). Por padrão re-puxa os últimos 7
 * dias pra absorver ajustes retroativos de atribuição (janela 7d_click,1d_view
 * faz Meta corrigir compras de D-7 a D-1 ao longo da semana). Pode passar
 * `?days=N` (1-180) pra alargar a janela em runs manuais de backfill.
 *
 * Env vars necessárias:
 *   META_ACCESS_TOKEN   — token de sistema com acesso às contas
 *   META_ACCOUNT_IDS    — IDs separados por vírgula: "111111111111111,222222222222222"
 *   META_TAX_RATE       — multiplicador de imposto, default 1.1382 (13,82% imposto Meta Brasil)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CRON_SECRET         — segredo para proteger o endpoint (opcional mas recomendado)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { brazilDateStr } from '@/lib/brazilDate'
import { getMetaConfig } from '@/lib/integrations/factory'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const META_API = 'https://graph.facebook.com/v20.0'
const FIELDS = [
  'date_start',
  'ad_id',
  'ad_name',
  'campaign_id',
  'adset_id',
  'campaign_name',
  'adset_name',
  'spend',
  'impressions',
  'reach',
  'inline_link_clicks',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'actions',
  'action_values',
].join(',')

interface MetaInsightRow {
  date_start: string
  ad_id: string
  ad_name: string
  campaign_id?: string
  adset_id?: string
  campaign_name: string
  adset_name: string
  spend: string
  impressions: string
  reach: string
  inline_link_clicks?: string
  video_p75_watched_actions?: Array<{ action_type: string; value: string }>
  video_p95_watched_actions?: Array<{ action_type: string; value: string }>
  actions?: Array<{ action_type: string; value: string }>
  action_values?: Array<{ action_type: string; value: string }>
}

function getActionValue(
  arr: Array<{ action_type: string; value: string }> | undefined,
  type: string
): number {
  const item = arr?.find((a) => a.action_type === type)
  return item ? parseFloat(item.value) || 0 : 0
}

function sumActionValues(
  arr: Array<{ action_type: string; value: string }> | undefined
): number {
  return (arr ?? []).reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0)
}

async function fetchInsights(
  accountId: string,
  token: string,
  since: string,
  until: string
): Promise<MetaInsightRow[]> {
  const params = new URLSearchParams({
    fields: FIELDS,
    level: 'ad',
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',  // 1 linha por dia por anúncio (sem isso, a API agrega o período inteiro)
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),  // mesma janela do gerenciador
    limit: '500',
    access_token: token,
  })

  const all: MetaInsightRow[] = []
  let url: string | null = `${META_API}/act_${accountId}/insights?${params}`

  while (url) {
    const res = await fetch(url as string)
    const json = await res.json() as { data?: MetaInsightRow[]; paging?: { next?: string }; error?: { message: string } }

    if (json.error) {
      throw new Error(`Meta API erro (conta ${accountId}): ${json.error.message}`)
    }

    all.push(...(json.data ?? []))
    url = json.paging?.next ?? null
  }

  return all
}

function rowToSupabase(row: MetaInsightRow, taxRate: number, accountId: string) {
  // Com CAPI ativo, Meta retorna evento pixel E server (deduplicados por event_id).
  // Somar ambos duplica a métrica — o gerenciador usa apenas a variante fb_pixel_*.
  const checkouts    = getActionValue(row.actions,       'offsite_conversion.fb_pixel_initiate_checkout')
  const compras      = getActionValue(row.actions,       'offsite_conversion.fb_pixel_purchase')
  const valorCompras = getActionValue(row.action_values, 'offsite_conversion.fb_pixel_purchase')

  const views3s = getActionValue(row.actions, 'video_view')
  const views75 = sumActionValues(row.video_p75_watched_actions)
    || getActionValue(row.actions, 'video_p75_watched_actions')
  const views95 = sumActionValues(row.video_p95_watched_actions)
    || getActionValue(row.actions, 'video_p95_watched_actions')

  return {
    data: row.date_start,
    criativo: row.ad_name,
    ad_name: row.ad_name,
    ad_id: row.ad_id,
    account_id: accountId,
    campaign_id: row.campaign_id ?? null,
    adset_id: row.adset_id ?? null,
    campaign_name: row.campaign_name,
    adset_name: row.adset_name,
    investimento: Math.round(parseFloat(row.spend || '0') * taxRate * 100) / 100,
    impressoes: parseInt(row.impressions || '0'),
    alcance: parseInt(row.reach || '0'),
    views_3seg: Math.round(views3s),
    views_75pct: Math.round(views75),
    views_95pct: Math.round(views95),
    cliques_link: parseInt(row.inline_link_clicks || '0'),
    landing_views: Math.round(getActionValue(row.actions, 'landing_page_view')),
    checkouts: Math.round(checkouts),
    compras: Math.round(compras),
    valor_compras: Math.round(valorCompras * 100) / 100,
    // `comment` já vinha dentro de `actions` — nenhuma chamada nova ao Meta, nenhuma
    // permissão nova. Ausente = 0 (o Meta omite a ação nos dias sem comentário).
    comentarios: Math.round(getActionValue(row.actions, 'comment')),
  }
}

export async function GET(req: NextRequest) {
  // Aceita: chamada do Vercel Cron (x-vercel-cron: 1) ou Bearer secret manual.
  // CRON_SECRET é mandatório — sem ele o endpoint só aceita Vercel Cron.
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Range padrão = últimos 7 dias até hoje (UTC-3 Brasília) pra absorver
  // atribuição retroativa da Meta (janela 7d_click,1d_view). `?days=N` permite
  // backfills manuais — clamp [1, 180] pra não estourar Meta API.
  const url = new URL(req.url)
  const daysParam = parseInt(url.searchParams.get('days') ?? '7', 10)
  const days = Number.isFinite(daysParam) ? Math.min(180, Math.max(1, daysParam)) : 7
  const dateStr = brazilDateStr(days)
  const todayStr = brazilDateStr(0)

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Dispatcher por projeto: DEMO default (cron sem sessão → DEMO, cai no env) +
  // workspaces com credencial 'meta' própria. Pra DEMO-only = [DEMO] → idêntico.
  const defaultWs = await getActiveWorkspaceId()
  const credWs = await listWorkspacesWithProvider('meta')
  const workspaceIds = [...new Set([defaultWs, ...credWs])]

  const results: Record<string, unknown> = {}

  for (const workspaceId of workspaceIds) {
   const cfg = await getMetaConfig(workspaceId)
   if (!cfg || cfg.accountIds.length === 0) {
     results[workspaceId] = { skipped: 'Meta não configurado ou sem account_ids' }
     continue
   }
   const token = cfg.accessToken
   const taxRate = cfg.taxRate

   for (const accountId of cfg.accountIds) {
    const resKey = `${workspaceId}:${accountId}`
    try {
      console.log(`[sync-meta] ws=${workspaceId} conta ${accountId} para ${dateStr} e ${todayStr}`)
      const rows = await fetchInsights(accountId, token, dateStr, todayStr)
      const records = rows.map((r) => ({ ...rowToSupabase(r, taxRate, accountId), workspace_id: workspaceId }))

      if (records.length === 0) {
        results[resKey] = { inseridos: 0, msg: 'Sem dados para ontem' }
        continue
      }

      // Fetch Instagram preview links for unique ad_ids via /ads endpoint
      const adIds = [...new Set(rows.map((r) => r.ad_id).filter(Boolean))]
      const previewMap: Record<string, string> = {}
      if (adIds.length > 0) {
        try {
          // Fetch in batches of 50 (Meta API limit for batch requests)
          for (let i = 0; i < adIds.length; i += 50) {
            const batch = adIds.slice(i, i + 50)
            const batchUrl = `${META_API}/?ids=${batch.join(',')}&fields=preview_shareable_link,creative{instagram_permalink_url}&access_token=${token}`
            const batchRes = await fetch(batchUrl)
            const batchJson = await batchRes.json() as Record<string, {
              preview_shareable_link?: string
              creative?: { instagram_permalink_url?: string }
            }>
            for (const [id, ad] of Object.entries(batchJson)) {
              // Prefer Instagram permalink, fall back to shareable preview link
              const link = ad?.creative?.instagram_permalink_url || ad?.preview_shareable_link
              if (link) previewMap[id] = link
            }
          }
        } catch {
          console.warn('[sync-meta] Não foi possível buscar preview links')
        }
      }

      // Status real + orçamento das entidades (Fase 8). Leitura (ads_read basta).
      // Graceful: se uma chamada falhar, a coluna fica como está (não clobbera).
      const adsetIds = [...new Set(rows.map((r) => r.adset_id).filter(Boolean))] as string[]
      const campaignIds = [...new Set(rows.map((r) => r.campaign_id).filter(Boolean))] as string[]
      const adStatusMap: Record<string, string> = {}
      const adsetMap: Record<string, { daily?: number; lifetime?: number; status?: string }> = {}
      const campaignMap: Record<string, { daily?: number }> = {}
      async function batchGet(ids: string[], fields: string, handler: (id: string, obj: Record<string, unknown>) => void) {
        for (let i = 0; i < ids.length; i += 50) {
          try {
            const b = ids.slice(i, i + 50)
            const res = await fetch(`${META_API}/?ids=${b.join(',')}&fields=${fields}&access_token=${token}`)
            const json = await res.json() as Record<string, Record<string, unknown>>
            for (const [id, obj] of Object.entries(json)) if (obj && typeof obj === 'object') handler(id, obj)
          } catch { /* graceful */ }
        }
      }
      try {
        await batchGet(adIds, 'effective_status', (id, o) => { if (typeof o.effective_status === 'string') adStatusMap[id] = o.effective_status })
        await batchGet(adsetIds, 'daily_budget,lifetime_budget,effective_status', (id, o) => {
          adsetMap[id] = {
            daily: o.daily_budget != null ? Number(o.daily_budget) : undefined,
            lifetime: o.lifetime_budget != null ? Number(o.lifetime_budget) : undefined,
            status: typeof o.effective_status === 'string' ? o.effective_status : undefined,
          }
        })
        await batchGet(campaignIds, 'daily_budget', (id, o) => { campaignMap[id] = { daily: o.daily_budget != null ? Number(o.daily_budget) : undefined } })
      } catch { console.warn('[sync-meta] status/orçamento das entidades indisponível') }

      const recordsWithLinks = records.map((r, i) => {
        const row = rows[i]
        const adset = row.adset_id ? adsetMap[row.adset_id] : undefined
        const camp = row.campaign_id ? campaignMap[row.campaign_id] : undefined
        const status = adStatusMap[row.ad_id] ?? adset?.status
        return {
          ...r,
          ...(previewMap[row.ad_id] ? { preview_url: previewMap[row.ad_id] } : {}),
          ...(status ? { status } : {}),
          ...(adset?.daily != null ? { daily_budget_cents: adset.daily } : {}),
          ...(adset?.lifetime != null ? { lifetime_budget_cents: adset.lifetime } : {}),
          ...(camp?.daily != null ? { campaign_daily_budget_cents: camp.daily } : {}),
        }
      })

      const { error } = await supabase
        .from('meta_ads')
        .upsert(recordsWithLinks, { onConflict: 'data,ad_id', ignoreDuplicates: false })

      if (error) throw new Error(error.message)

      results[resKey] = { inseridos: records.length, preview_links: Object.keys(previewMap).length }
      console.log(`[sync-meta] ✅ Conta ${accountId}: ${records.length} registros, ${Object.keys(previewMap).length} links`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[sync-meta] ❌ ws=${workspaceId} conta ${accountId}:`, msg)
      results[resKey] = { erro: msg }
    }
   }
  }

  revalidateTag('sb-meta-ads', 'max')

  return NextResponse.json({ range: { from: dateStr, to: todayStr }, days, accounts: results })
}
