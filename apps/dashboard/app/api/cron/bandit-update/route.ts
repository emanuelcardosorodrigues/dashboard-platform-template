/**
 * Cron: Bandit Mode v2 update — Fase 5 do plano.
 *
 * Para cada experimento com auto_optimize=true:
 *   1. Lê impressões + conversões por variante (últimos 7 dias)
 *   2. Roda thompsonSample com guardrails (min_conv, champion lock)
 *   3. Publica pesos em KV `bandit:{exp.id}` (Worker lê na decisão)
 *   4. Append em bandit_log
 *
 * Schedule: 0 * * * * (hourly)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { thompsonSample, type VariantStats } from '@/lib/bandit'
import { sckSlug } from '@/lib/paginas'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

interface ExperimentRow {
  id: string
  name: string
  workspace_id: string
  variants: Array<{ slug: string; weight: number; enabled?: boolean }>
  auto_optimize: boolean
  champion_variant: string | null
  bandit_min_conv: number
  bandit_lock_until: string | null
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  if (!isVercelCron) {
    const secret = process.env.CRON_SECRET
    if (!secret) return NextResponse.json({ error: 'CRON_SECRET ausente' }, { status: 401 })
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // 1. Experimentos com auto_optimize ativo (e que não estão em lock manual)
  const now = new Date().toISOString()
  const { data: exps, error: expErr } = await supabase
    .from('experiments')
    .select('id, name, workspace_id, variants, auto_optimize, champion_variant, bandit_min_conv, bandit_lock_until')
    .eq('status', 'active')
    .eq('auto_optimize', true)

  if (expErr) {
    // Se colunas não existem (migration 0003 não aplicada), retorna noop em vez de quebrar
    if (/column .* does not exist/i.test(expErr.message)) {
      return NextResponse.json({ updated: 0, message: 'Migration 0003_bandit ainda não aplicada' })
    }
    return NextResponse.json({ error: expErr.message }, { status: 500 })
  }
  if (!exps || exps.length === 0) {
    return NextResponse.json({ updated: 0, message: 'Nenhum exp com auto_optimize=true' })
  }

  const updates: Array<{ exp_id: string; weights: Record<string, number>; reason: string }> = []

  // Pull UIDs confirmados como bot uma vez — bandit decide sobre tráfego humano.
  const botUids = await fetchConfirmedBotUids(supabase)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  for (const exp of exps as ExperimentRow[]) {
    // Lock manual?
    if (exp.bandit_lock_until && exp.bandit_lock_until > now) {
      continue
    }

    // 2. Stats por variante (impressões filtradas + transações).
    // Variantes desativadas (enabled === false) saem do bandit — o Worker não as
    // serve, então o Thompson Sampling não deve gastar exploração nelas.
    const variantSlugs = exp.variants.filter(v => v.enabled !== false).map(v => v.slug)
    if (variantSlugs.length === 0) continue

    // Conversões por variante: casadas pelo 1º SEGMENTO do sck (sckSlug, chave
    // canônica), NÃO por substring. O antigo LIKE '%slug%' sem escopo (a) casava
    // slug curto dentro de sck de OUTRO experimento, (b) casava o slug em qualquer
    // segmento (checkout/ob), (c) somava vendas de OUTROS tenants — e esse número
    // alimenta o Thompson Sampling que publica pesos AO VIVO no KV. Busca uma vez,
    // escopada no workspace do experimento, e conta em memória pelo 1º segmento.
    const convBySlug = new Map<string, number>()
    const { data: txRows } = await supabase
      .from('transacoes')
      .select('sck_slug')
      .eq('workspace_id', exp.workspace_id)
      .gte('created_at', cutoff)
      .not('sck_slug', 'is', null)
    for (const t of (txRows ?? []) as { sck_slug: string | null }[]) {
      const s = sckSlug(t.sck_slug || '')
      if (s) convBySlug.set(s, (convBySlug.get(s) ?? 0) + 1)
    }

    const stats: VariantStats[] = []
    for (const slug of variantSlugs) {
      const { data: impRows } = await supabase
        .from('impressions')
        .select('uid')
        .eq('experiment_id', exp.id)
        .eq('variant', slug)
        .gte('timestamp', cutoff)

      const imp = (impRows ?? []).reduce(
        (n, r: { uid: string }) => (botUids.has(r.uid) ? n : n + 1),
        0
      )

      const conv = convBySlug.get(sckSlug(slug)) ?? 0
      stats.push({ slug, conv, imp })
    }

    // 3. Thompson Sampling
    const result = thompsonSample(stats, {
      minConv: exp.bandit_min_conv ?? 30,
      championSlug: exp.champion_variant ?? undefined,
      championMinWeight: 0.6,
    })

    updates.push({ exp_id: exp.id, weights: result.weights, reason: result.reason })

    // 4. Append em bandit_log
    await supabase.from('bandit_log').insert({
      experiment_id: exp.id,
      weights: result.weights,
    })

    // 5. Publicar pesos em Cloudflare KV pra Worker consumir (key `bandit:{exp.id}`)
    await publishBanditWeights(exp.id, result.weights)
  }

  return NextResponse.json({ updated: updates.length, updates })
}

// Pull dos UIDs com status='confirmed' em bot_uids. Backward-compat: se a
// coluna `status` não existir, considera TODA linha como confirmed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchConfirmedBotUids(supabase: any): Promise<Set<string>> {
  const tried = await supabase.from('bot_uids').select('uid').eq('status', 'confirmed')
  if (tried.error && /column .* does not exist/i.test(tried.error.message)) {
    const fb = await supabase.from('bot_uids').select('uid')
    return new Set((fb.data ?? []).map((r: { uid: string }) => r.uid))
  }
  if (tried.error) return new Set()
  return new Set((tried.data ?? []).map((r: { uid: string }) => r.uid))
}

// Grava `bandit:{experimentId}` no KV da Cloudflare. Best-effort: falha
// silenciosa (nunca quebra o cron). TTL 86400s = 24h por padrão; o cron
// reescreve a cada execução então TTL longo é defesa contra perda silenciosa.
async function publishBanditWeights(experimentId: string, weights: Record<string, number>) {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const kvNamespaceId = process.env.AB_KV_NAMESPACE_ID
  if (!token || !accountId || !kvNamespaceId) return

  const key = `bandit:${experimentId}`
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvNamespaceId}/values/${encodeURIComponent(key)}?expiration_ttl=86400`
  try {
    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ weights, updated_at: new Date().toISOString() }),
    })
  } catch (_) {
    // intencional
  }
}
