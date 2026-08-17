export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchCheckoutHits, fetchExperiments, fetchImpressionStats, fetchImpressionUids, fetchRouteClickUids, fetchTransacoes, fetchVariantFirstSeen, tipoDaTransacao } from '@/lib/supabase'
import { matchSaleToVariant, findOrphanSales, classifyOrphanSlugs, buildAllowedPageSegments } from '@/lib/abAttribution'
import { fetchGa4TopPages } from '@/lib/ga4'
import { todayBR, daysAgoBR } from '@/lib/formatters'
import { buildHitCidsBySlug, buildHitUidsBySlug, buildGaUsersBySlug, buildUidsByExpVariant, variantHitCids, variantGaUsers, resolveVariantCheckout, resolveConnectRate, type CheckoutFonte } from '@/lib/experimentPassthrough'
import ExperimentosClient from './ExperimentosClient'
import type { SbExperiment } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { entryBaseForWorkspace } from '@/lib/abEntryLink'

export default async function ExperimentosPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const { de = '', ate = '' } = await searchParams
  const workspaceId = await getActiveWorkspaceId()
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: workspace } = await db.from('workspaces').select('ab_entry_base').eq('id', workspaceId).maybeSingle()
  const entryBase = entryBaseForWorkspace(
    (workspace as { ab_entry_base?: string | null } | null)?.ab_entry_base,
    process.env.NEXT_PUBLIC_ENTRY_BASE,
  )
  return (
    <div className="flex flex-col h-full">
      <Header title="Experimentos" subtitle={`Motor A/B testing — ${entryBase}`} />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-64 animate-pulse" />}>
          <ExperimentosContent de={de} ate={ate} entryBase={entryBase} />
        </Suspense>
      </div>
    </div>
  )
}

async function ExperimentosContent({ de, ate, entryBase }: { de: string; ate: string; entryBase: string }) {
  // Filtro de data único pra toda a aba (params de/ate do header). Vazio = tudo.
  // Janela dos cliques de checkout (tag GTM) e dos usuários GA4 que os denominam.
  // Precisa ser a MESMA nos dois — senão a passagem divide populações de períodos
  // diferentes. Filtro vazio = últimos 30 dias (o GA4 exige um range explícito).
  const hitsDe = de || daysAgoBR(30)
  const hitsAte = ate || todayBR()

  const [experiments, impressionStats, transacoes, impressionUids, impressionUidsJanela, checkoutHits, gaPages, routeClickUids, firstSeen] = await Promise.all([
    fetchExperiments(),
    fetchImpressionStats(de || undefined, ate || undefined),
    fetchTransacoes(),
    fetchImpressionUids(de || undefined, ate || undefined),
    // Views na MESMA janela dos cliques de checkout. Sem filtro, as impressões são
    // "tudo" (= desde o início do experimento, que é o certo pra um A/B) mas os hits
    // são 30d — dividir um pelo outro encolheria a passagem de experimento com mais de
    // 30 dias (o COL-TP-0406 já roda desde 03/06). Cada razão divide dentro da sua janela.
    // Com filtro de data, hitsDe/hitsAte == de/ate → é a MESMA busca (cache dedup, custo 0).
    fetchImpressionUids(hitsDe, hitsAte),
    fetchCheckoutHits(hitsDe, hitsAte),
    fetchGa4TopPages(hitsDe, hitsAte, 1000).catch(() => []), // GA4 não configurado → passagem por hits vira "—"
    fetchRouteClickUids(de || undefined, ate || undefined), // cliques roteados (302) → connect rate
    fetchVariantFirstSeen(), // "rodando desde" por variante — SEM janela (é a 1ª impressão de sempre)
  ])

  // Filtro de data das conversões (mesma janela do header que escopa as impressões).
  // Vendas órfãs / classificação de slugs ficam all-time de propósito (higiene de atribuição).
  const convInRange = (t: { created_at?: string | null; data?: string | null }) => {
    if (!de && !ate) return true
    const tDay = (t.created_at
      ? new Date(t.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      : (t.data || '')
    ).slice(0, 10)
    return (!de || tDay >= de) && (!ate || tDay <= ate)
  }

  // Apenas produtos de front-end contam como Vendas (conversão principal)
  const frontEndTransacoes = transacoes.filter(
    (t) => tipoDaTransacao(t) === 'frontEnd'
  )

  // convMap: sck_slug → { count (frontEnd), receita (frontEnd) }
  // Usado por page/checkout para conversões e receita
  const convMap: Record<string, { count: number; receita: number }> = {}
  for (const t of frontEndTransacoes) {
    const sckSlug = t.sck_slug
    if (!sckSlug) continue
    if (!convMap[sckSlug]) convMap[sckSlug] = { count: 0, receita: 0 }
    convMap[sckSlug].count++
    convMap[sckSlug].receita += t.valor_bruto || 0
  }

  // allRevenueMap: sck_slug → receita total (frontEnd + OB products)
  // Usado por experimentos OB para mostrar faturamento real gerado pela variante
  const allRevenueMap: Record<string, number> = {}
  for (const t of transacoes) {
    const sckSlug = t.sck_slug
    if (!sckSlug) continue
    allRevenueMap[sckSlug] = (allRevenueMap[sckSlug] ?? 0) + (t.valor_bruto || 0)
  }

  // Build UID sets per (experiment_id, variant) — for checkoutViews cross-reference
  const uidsByExpVariant: Record<string, Set<string>> = {}
  const uidsByExp: Record<string, Set<string>> = {}
  for (const imp of impressionUids) {
    const varKey = `${imp.experiment_id}|${imp.variant}`
    if (!uidsByExpVariant[varKey]) uidsByExpVariant[varKey] = new Set()
    uidsByExpVariant[varKey].add(imp.uid)
    if (!uidsByExp[imp.experiment_id]) uidsByExp[imp.experiment_id] = new Set()
    uidsByExp[imp.experiment_id].add(imp.uid)
  }

  // Map entry_path → all UIDs that saw any variant of that experiment
  const checkoutUidsByPath: Record<string, Set<string>> = {}
  for (const exp of experiments) {
    if (exp.type === 'checkout') {
      checkoutUidsByPath[exp.entry_path] = uidsByExp[exp.id] ?? new Set()
    }
  }

  // Aggregate stats per experiment
  const statsMap: Record<string, {
    variants: {
      name: string; slug: string; url?: string; weight: number
      impressions: number; conversions: number; receita: number
      desde?: string | null
      checkoutViews?: number; checkoutFonte?: CheckoutFonte; checkoutDenom?: number
      routeClicks?: number; connectRate?: number | null
    }[]
    totalImpressions: number
  }> = {}

  // Cliques no CTA de checkout (tag GTM server-side). Fallback de passagem pra
  // experimento de página SEM checkout A/B vinculado — antes disso a UI mostrava "—".
  const hitCidsBySlug = buildHitCidsBySlug(checkoutHits)
  const hitUidsBySlug = buildHitUidsBySlug(checkoutHits)
  const gaUsersBySlug = buildGaUsersBySlug(gaPages)
  // Cliques roteados (302) por variante → denominador do connect rate (views ÷ clicks).
  const clickUidsByExpVariant = buildUidsByExpVariant(routeClickUids)
  // Views restritas à janela dos hits — denominador do tier 'uid' (mesma janela do numerador).
  const uidsByExpVariantJanela = buildUidsByExpVariant(impressionUidsJanela)


  // For OB experiments: find the co-located checkout experiment (same entry_path)
  // and use its total impressions as denominator, distributed evenly across OB variants.
  // Rationale: OB and checkout are shown on the same page load; before the Worker
  // started logging OB impressions, checkout impressions are the only proxy we have.
  const checkoutImpsByPath: Record<string, number> = {}
  for (const exp of experiments) {
    if (exp.type === 'checkout') {
      checkoutImpsByPath[exp.entry_path] = impressionStats
        .filter(s => s.experiment_id === exp.id)
        .reduce((sum, s) => sum + s.count, 0)
    }
  }

  // Mapa por exp.id de slugs de página legítimos (evita atribuição cruzada
  // quando dois checkout/ob exps compartilham o mesmo variant.slug)
  const allowedPageSegmentsByExp = buildAllowedPageSegments(experiments)

  for (const exp of experiments) {
    // For page experiments: UIDs from linked checkout experiment (to compute passthrough)
    const linkedCheckoutUids = exp.type === 'page' && exp.checkout_slug
      ? checkoutUidsByPath[exp.checkout_slug] ?? null
      : null

    // For OB experiments: total checkout impressions at same entry_path
    const obCheckoutTotal = exp.type === 'ob'
      ? (checkoutImpsByPath[exp.entry_path] ?? 0)
      : 0

    const allowedSegments = allowedPageSegmentsByExp.get(exp.id)

    const variantStats = exp.variants.map((v) => {
      const impStat = impressionStats.find(
        (s) => s.experiment_id === exp.id && s.variant === v.name
      )
      const loggedImps = impStat?.count ?? 0

      // For OB: use checkout total / num_variants when logged impressions are far below
      // what's expected (i.e. before Worker started logging OB impressions).
      const impressions = exp.type === 'ob' && obCheckoutTotal > loggedImps * 2
        ? Math.round(obCheckoutTotal / exp.variants.length)
        : loggedImps

      // convCount: frontEnd sales (Vendas do produto principal) — igual para todos os tipos
      // convReceita: total de receita da variante (frontEnd + OBs) — para ticket médio real
      // Filtra transações por created_at >= exp.started_at (defensive — evita ghost
      // attribution de vendas anteriores ao experimento que casem por coincidência).
      const expStart = exp.started_at ?? exp.created_at ?? null
      let convCount = 0
      let convReceita = 0
      for (const t of frontEndTransacoes) {
        if (!t.sck_slug) continue
        const tWhen = t.created_at ?? t.data
        if (expStart && tWhen && tWhen < expStart) continue
        if (!convInRange(t)) continue
        if (matchSaleToVariant(t.sck_slug, exp, v, allowedSegments)) {
          convCount++
        }
      }
      for (const t of transacoes) {
        if (!t.sck_slug) continue
        const tWhen = t.created_at ?? t.data
        if (expStart && tWhen && tWhen < expStart) continue
        if (!convInRange(t)) continue
        if (matchSaleToVariant(t.sck_slug, exp, v, allowedSegments)) {
          convReceita += t.valor_bruto || 0
        }
      }

      // checkoutViews + uniqueVisitors: para experimentos de página
      let checkoutViews: number | undefined = undefined
      let checkoutFonte: CheckoutFonte = null
      let checkoutDenom = 0
      let uniqueVisitors: number | undefined = undefined
      let routeClicks: number | undefined = undefined
      let connectLanded: number | undefined = undefined
      let connectRate: number | null | undefined = undefined
      if (exp.type === 'page') {
        const pageUids = uidsByExpVariant[`${exp.id}|${v.name}`] ?? new Set<string>()
        uniqueVisitors = pageUids.size
        ;({ checkoutViews, checkoutFonte, checkoutDenom } = resolveVariantCheckout({
          pageUids,
          // denominador do tier 'uid': views na MESMA janela dos hits (senão a passagem
          // de experimento com mais de 30 dias sai menor que a real)
          pageUidsJanela: uidsByExpVariantJanela.get(`${exp.id}|${v.name}`) ?? new Set<string>(),
          linkedCheckoutUids,
          hitUids: variantHitCids(v, hitUidsBySlug), // mesma resolução de slug (url ou variant.slug)
          hitCids: variantHitCids(v, hitCidsBySlug),
          gaUsers: variantGaUsers(v, gaUsersBySlug),
        }))
        // connect rate = uids roteados (302) que TAMBÉM viram a página (beacon) ÷ roteados.
        // Interseção na mesma identidade (uid do Worker): exato, ≤100% por construção, e
        // views históricas sem clique roteado (anteriores ao deploy) não inflam nada.
        const clickUids = clickUidsByExpVariant.get(`${exp.id}|${v.name}`) ?? new Set<string>()
        const cr = resolveConnectRate(pageUids, clickUids)
        routeClicks = cr.routed
        connectLanded = cr.landed
        connectRate = cr.rate
      }

      return {
        ...v,
        impressions,
        conversions: convCount,
        receita: convReceita,
        // "rodando desde" = 1ª impressão. Ausente = variante ainda sem tráfego (não inventa data).
        desde: firstSeen.get(`${exp.id}|${v.name}`) ?? null,
        checkoutViews,
        checkoutFonte,
        checkoutDenom,
        uniqueVisitors,
        routeClicks,
        connectLanded,
        connectRate,
      }
    })
    statsMap[exp.id] = {
      variants: variantStats,
      totalImpressions: variantStats.reduce((s, v) => s + v.impressions, 0),
    }
  }

  // Vendas órfãs: sck_slugs que não casam com nenhuma variante de page ativo
  const activePageExps = experiments.filter(e => e.type === 'page' && e.status === 'active')
  const orphanSales = findOrphanSales(convMap, activePageExps)

  // Classificação de slugs com vendas fora de testes ativos
  const pageExps = experiments.filter(e => e.type === 'page')
  const { inactive: inactiveSlugs, neverTested: neverTestedSlugs } =
    classifyOrphanSlugs(convMap, pageExps)

  return (
    <ExperimentosClient
      experiments={experiments}
      statsMap={statsMap}
      orphanSales={orphanSales}
      inactiveSlugs={inactiveSlugs}
      neverTestedSlugs={neverTestedSlugs}
      entryBase={entryBase}
    />
  )
}
