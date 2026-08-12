/**
 * Cron: backfill do CREATIVE do Meta → meta_ads.tipo_criativo + child_attachments.
 *
 * Por quê separado do sync-meta: sync-meta fala /insights (métricas por dia). Aqui
 * lemos o `creative` ad-a-ad (dado que NÃO muda dia a dia) só pra classificar o
 * criativo e extrair os cards do carrossel — camada de dados do preview de
 * carrossel no popup (a UI é follow-up). Não toca nenhuma métrica.
 *
 * O que faz:
 *   1. Seleciona ad_ids DISTINTOS de meta_ads ainda sem tipo_criativo (por workspace).
 *   2. GET /{ad_id}?fields=creative{object_story_spec,asset_feed_spec,effective_object_story_id}
 *      (em lote via ?ids=, ver lib/meta-graph.fetchAdCreativeTypes).
 *   3. Deriva tipo_criativo ('carousel'|'video'|'image'|'dynamic') e, se carrossel,
 *      child_attachments [{title,image_url,link}].
 *   4. UPDATE meta_ads SET tipo_criativo, child_attachments WHERE workspace_id AND ad_id
 *      — escreve em TODAS as linhas-dia daquele ad (o unique é (data, ad_id), não
 *      (workspace_id, ad_id)); só essas 2 colunas, métricas intactas.
 *
 * Best-effort: um ad que falha não derruba o lote. Teto de BATCH_CAP ad_ids/run
 * (?cap=N pra ajustar) — o resto é logado e cai no próximo run.
 *
 * Auth: x-vercel-cron:1 ou Bearer CRON_SECRET (igual aos outros crons).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { getMetaConfig } from '@/lib/integrations/factory'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { listWorkspacesWithProvider } from '@/lib/integrations/credentials'
import { fetchAdCreativeTypes } from '@/lib/meta-graph'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Teto de ad_ids por run pra não estourar o timeout (300s). Cada ad ≈ 1 UPDATE +
// ~1/50 de chamada Graph (batch de 50). 150 é folgado; o resto fica pro próximo run.
const BATCH_CAP = 150

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const url = new URL(req.url)
  const capParam = parseInt(url.searchParams.get('cap') ?? '', 10)
  const cap = Number.isFinite(capParam) ? Math.min(1000, Math.max(1, capParam)) : BATCH_CAP

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // Mesmo dispatcher do sync-meta: DEMO default + workspaces com credencial 'meta'.
  const defaultWs = await getActiveWorkspaceId()
  const credWs = await listWorkspacesWithProvider('meta')
  const workspaceIds = [...new Set([defaultWs, ...credWs])]

  const results: Record<string, unknown> = {}
  let budget = cap // teto GLOBAL do run, compartilhado entre workspaces

  for (const workspaceId of workspaceIds) {
    if (budget <= 0) {
      results[workspaceId] = { skipped: 'cap do run esgotado' }
      continue
    }

    const cfg = await getMetaConfig(workspaceId)
    if (!cfg?.accessToken) {
      results[workspaceId] = { skipped: 'Meta não configurado' }
      continue
    }

    // ad_ids DISTINTOS ainda sem classificação — SEMPRE por workspace (tenant isolation).
    const { data: pend, error: selErr } = await supabase
      .from('meta_ads')
      .select('ad_id')
      .eq('workspace_id', workspaceId)
      .is('tipo_criativo', null)
      .not('ad_id', 'is', null)
    if (selErr) {
      results[workspaceId] = { erro: selErr.message }
      continue
    }

    const pendingIds = [...new Set((pend ?? []).map((r) => r.ad_id as string).filter(Boolean))]
    const totalPending = pendingIds.length
    if (totalPending === 0) {
      results[workspaceId] = { pendentes: 0, processados: 0 }
      continue
    }

    const take = pendingIds.slice(0, budget)
    let creativeMap: Awaited<ReturnType<typeof fetchAdCreativeTypes>>
    try {
      creativeMap = await fetchAdCreativeTypes(take, { accessToken: cfg.accessToken })
    } catch (err) {
      // Falha global do fetch (token/rede) — não derruba os outros workspaces.
      results[workspaceId] = {
        erro: err instanceof Error ? err.message : String(err),
        pendentes: totalPending,
      }
      continue
    }

    let atualizados = 0
    let carrosseis = 0
    let falhas = 0
    for (const adId of take) {
      const c = creativeMap.get(adId)
      // Sem classificação (creative ilegível/ausente) → deixa NULL, re-tenta no próximo run.
      if (!c?.tipoCriativo) {
        falhas++
        continue
      }
      const { error: upErr } = await supabase
        .from('meta_ads')
        .update({ tipo_criativo: c.tipoCriativo, child_attachments: c.childAttachments ?? null })
        .eq('workspace_id', workspaceId)
        .eq('ad_id', adId)
      if (upErr) {
        falhas++
        continue
      }
      atualizados++
      if (c.tipoCriativo === 'carousel') carrosseis++
    }

    budget -= take.length
    const restantes = totalPending - take.length
    results[workspaceId] = {
      pendentes: totalPending,
      processados: take.length,
      atualizados,
      carrosseis,
      falhas,
      restantes, // o que sobrou pro próximo run
    }
    if (restantes > 0) {
      console.log(`[backfill-creatives] ws=${workspaceId}: ${restantes} ad_ids sobraram pro próximo run (cap=${cap})`)
    }
  }

  revalidateTag('sb-meta-ads', 'max')
  return NextResponse.json({ cap, results })
}
