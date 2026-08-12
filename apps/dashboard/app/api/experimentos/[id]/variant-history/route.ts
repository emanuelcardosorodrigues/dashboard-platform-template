/**
 * GET /api/experimentos/[id]/variant-history?variant=A — histórico de UMA variante.
 *
 * Duas abas, e elas têm naturezas MUITO diferentes:
 *  - `desempenho`: dia a dia (views, connect rate, cliques, vendas). Derivado de
 *    impressions/route_clicks/checkout_hits/transacoes → tem passado RETROATIVO inteiro.
 *  - `alteracoes`: o que mudou na variante (peso, ativa/inativa, url…). Isso nunca foi
 *    gravado antes da migration 0055, então começa VAZIO e só enche daqui pra frente.
 *    Junta a edição manual (experiment_variant_events) com a decisão automática do
 *    Thompson Sampling (bandit_log) — senão o peso muda "do nada" e ninguém sabe quem mexeu.
 *
 * `desde` = 1ª impressão da variante (view `variant_first_seen`). É o único sinal honesto e
 * retroativo de quando ela entrou no ar, e pega certo as variantes ADICIONADAS depois.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { buildVariantTimeline, type LinhasCruas } from '@/lib/variantHistory'
import { descreverEvento, type VariantEventKind } from '@/lib/variantEvents'
import { matchSaleToVariant, buildAllowedPageSegments } from '@/lib/abAttribution'
import { pageSlug } from '@/lib/paginas'
import { tipoDaTransacao } from '@/lib/supabase'
import type { SbExperiment, SbVariant } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

/** Data BR (YYYY-MM-DD) a partir de um timestamp ISO. */
function diaBR(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const variantName = req.nextUrl.searchParams.get('variant') ?? ''
  if (!id || !variantName) {
    return NextResponse.json({ error: 'id e variant são obrigatórios' }, { status: 400 })
  }

  const db = supa()
  const workspaceId = await getActiveWorkspaceId()

  // Experimento + a variante pedida
  const { data: expRow, error: expErr } = await db
    .from('experiments').select('*')
    .eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
  if (expErr || !expRow) return NextResponse.json({ error: 'Experimento não encontrado.' }, { status: 404 })

  const exp = expRow as SbExperiment
  const variant = (exp.variants ?? []).find((v) => v.name === variantName) as SbVariant | undefined
  if (!variant) return NextResponse.json({ error: 'Variante não encontrada.' }, { status: 404 })

  // Slugs pelos quais a tag GTM pode ter gravado o clique: o rótulo do sck E o último
  // segmento da URL (nem sempre são iguais — ex: slug col-pvia04-2906 pra url /p/col-pvia04/).
  const slugs = [...new Set([(variant.slug || '').toLowerCase(), pageSlug(variant.url || '')].filter(Boolean))]

  const [impRes, rcRes, chRes, txRes, fsRes, evRes, blRes, allExpsRes] = await Promise.all([
    db.from('impressions').select('uid, timestamp').eq('workspace_id', workspaceId).eq('experiment_id', id).eq('variant', variantName),
    db.from('route_clicks').select('uid, dia').eq('workspace_id', workspaceId).eq('experiment_id', id).eq('variant', variantName),
    slugs.length
      ? db.from('checkout_hits').select('uid, dia').eq('workspace_id', workspaceId).in('slug', slugs)
      : Promise.resolve({ data: [], error: null }),
    // produto_id vai junto: sem ele `tipoDaTransacao` não consegue casar as regras
    // de funil configuradas `por:'id'` e toda venda cairia no fallback frontEnd.
    db.from('transacoes').select('sck_slug, produto, produto_id, criativo, valor_bruto, data, created_at').eq('workspace_id', workspaceId),
    db.from('variant_first_seen').select('first_seen').eq('workspace_id', workspaceId).eq('experiment_id', id).eq('variant', variantName).maybeSingle(),
    db.from('experiment_variant_events').select('occurred_at, kind, de, para, origem, ator').eq('workspace_id', workspaceId).eq('experiment_id', id).eq('variant', variantName).order('occurred_at', { ascending: false }),
    db.from('bandit_log').select('weights, decided_at').eq('experiment_id', id).order('decided_at', { ascending: false }).limit(200),
    db.from('experiments').select('*').eq('workspace_id', workspaceId),
  ])

  // Vendas da variante: mesma regra de atribuição do resto do sistema (sck → variante),
  // não um "like" solto que contaminaria com venda de outro slug.
  const allExps = ((allExpsRes.data ?? []) as SbExperiment[])
  const allowed = buildAllowedPageSegments(allExps).get(exp.id)
  const expStart = exp.started_at ?? exp.created_at ?? null
  const vendas: LinhasCruas['vendas'] = []
  for (const t of (txRes.data ?? []) as { sck_slug: string | null; produto: string | null; criativo: string | null; valor_bruto: number | null; data: string | null; created_at: string | null }[]) {
    if (!t.sck_slug) continue
    if (tipoDaTransacao(t) !== 'frontEnd') continue
    const quando = t.created_at ?? t.data
    if (expStart && quando && quando < expStart) continue // não atribui venda anterior ao teste
    if (!matchSaleToVariant(t.sck_slug, exp, variant, allowed)) continue
    vendas.push({ dia: (t.created_at ? diaBR(t.created_at) : (t.data || '')).slice(0, 10), valor: t.valor_bruto || 0 })
  }

  const linhas: LinhasCruas = {
    impressoes: ((impRes.data ?? []) as { uid: string; timestamp: string }[]).map((r) => ({ uid: r.uid, dia: diaBR(r.timestamp) })),
    routeClicks: ((rcRes.data ?? []) as { uid: string; dia: string }[]).map((r) => ({ uid: r.uid, dia: r.dia })),
    checkoutHits: ((chRes.data ?? []) as { uid: string | null; dia: string }[]).map((r) => ({ uid: r.uid, dia: r.dia })),
    vendas,
  }

  const desempenho = buildVariantTimeline(linhas)

  // Alterações: edição manual + decisão do bandit, numa linha do tempo só.
  type Alt = { occurred_at: string; texto: string; origem: string; ator: string | null }
  const alteracoes: Alt[] = ((evRes.data ?? []) as { occurred_at: string; kind: VariantEventKind; de: string | null; para: string | null; origem: string; ator: string | null }[])
    .map((e) => ({ occurred_at: e.occurred_at, texto: descreverEvento(e), origem: e.origem, ator: e.ator }))

  // bandit_log guarda os pesos por SLUG. Só vira evento quando o peso DESTA variante muda —
  // senão cada rodada do cron viraria uma linha inútil repetindo o mesmo número.
  const slugVar = (variant.slug || '').toLowerCase()
  const bl = ((blRes.data ?? []) as { weights: Record<string, number>; decided_at: string }[])
    .slice().reverse() // cronológico pra detectar a mudança
  let anterior: number | null = null
  for (const linha of bl) {
    const w = linha.weights?.[slugVar]
    if (typeof w !== 'number') continue
    if (anterior !== null && Math.abs(w - anterior) > 1e-6) {
      alteracoes.push({
        occurred_at: linha.decided_at,
        texto: `Peso ${anterior} → ${w}`,
        origem: 'bandit',
        ator: 'Thompson Sampling',
      })
    }
    anterior = w
  }
  alteracoes.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))

  return NextResponse.json({
    experimento: exp.name,
    variant: variantName,
    slug: variant.slug,
    url: variant.url ?? null,
    desde: (fsRes.data as { first_seen?: string } | null)?.first_seen ?? null,
    desempenho,
    alteracoes,
  })
}
