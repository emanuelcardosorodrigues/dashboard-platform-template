/**
 * /organico/conteudo — Análise de Conteúdo CROSS-PLATFORM (o coração do Orgânico).
 *
 * Tese do plano: plataforma é FILTRO, não aba — a unidade de análise é o
 * conteúdo. A grade normaliza YouTube/Instagram/TikTok em cards comparáveis
 * (taxas sobre alcance/views, idade normalizada, outlier vs MEDIANA do cohort)
 * pra responder "qual formato/gancho/assunto dá mais certo", não "como vai o app".
 */
import Link from 'next/link'
import { cookies } from 'next/headers'
import Header from '@/components/layout/Header'
import { Plug } from 'lucide-react'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { fetchTransacoes } from '@/lib/supabase'
import { fetchOrganicAccounts, fetchOrganicPosts, type OrganicPost, type OrganicPlatform } from '@/lib/organico/queries'
import { computeScores, CHAMPION_THRESHOLD } from '@/lib/organico/scores'
import { computeOrganicRevenue } from '@/lib/organico/atribuicao'
import { resolveConta } from '@/lib/organico/conta'
import { resolveOrgRange, inRange, type OrgDateParams } from '@/lib/organico/dateFilter'
import type { OrganicCardPost } from '@/components/organico/OrganicPostCard'
import AccountFilter from '@/components/organico/AccountFilter'
import FilterToggle from '@/components/filters/FilterToggle'
import ConteudoClient from './ConteudoClient'

export const dynamic = 'force-dynamic'

const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function toCard(p: OrganicPost, platform: string, scores: { outlier: number | null; composite: number | null }): OrganicCardPost {
  return {
    id: p.id, platform, format: p.format, title: p.title, caption: p.caption,
    thumbnail_url: p.thumbnail_url, permalink: p.permalink, published_at: p.published_at,
    duration_seconds: p.duration_seconds, views: p.views, engaged_views: p.engaged_views,
    reach: p.reach, likes: p.likes, comments_count: p.comments_count, shares: p.shares,
    saves: p.saves, apv: p.apv, avg_watch_time_s: p.avg_watch_time_s,
    completion_rate: p.completion_rate, skip_rate: p.skip_rate,
    subs_gained: p.subs_gained, impressions: p.impressions, impressions_ctr: p.impressions_ctr,
    gancho_codigo: p.gancho_codigo, estrutura: p.estrutura, tema: p.tema,
    // persistido pelo cron de insights tem precedência; live é o fallback
    outlier: p.outlier_score ?? scores.outlier,
    composite: p.composite_score ?? scores.composite,
  }
}

/** Padrões Campeões: o que os posts com composite ≥150 têm em comum (determinístico). */
function championCuts(cards: OrganicCardPost[]) {
  const champs = cards.filter((c) => (c.composite ?? 0) >= CHAMPION_THRESHOLD)
  if (champs.length < 3) return null
  const cut = (label: string, keyFn: (c: OrganicCardPost) => string | null) => {
    const counts = new Map<string, number>()
    for (const c of champs) {
      const k = keyFn(c)
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (!top) return null
    return { label, valor: top[0], pct: Math.round((top[1] / champs.length) * 100) }
  }
  const cortes = [
    cut('Plataforma', (c) => c.platform),
    cut('Formato', (c) => c.format),
    cut('Duração', (c) => c.duration_seconds == null ? null : c.duration_seconds <= 35 ? '≤35s' : c.duration_seconds <= 90 ? '36-90s' : c.duration_seconds <= 300 ? '90s-5min' : '>5min'),
    cut('Dia de publicação', (c) => DOW[new Date(c.published_at).getDay()]),
    cut('Gancho', (c) => c.gancho_codigo ?? null),
    cut('Estrutura', (c) => c.estrutura ?? null),
  ].filter((x): x is NonNullable<typeof x> => x != null)
  return { total: champs.length, cortes }
}

export default async function ConteudoPage({ searchParams }: { searchParams: Promise<{ conta?: string } & OrgDateParams> }) {
  const [ytAcc, igAcc, ttAcc] = await Promise.all([
    fetchOrganicAccounts('youtube'),
    fetchOrganicAccounts('instagram'),
    fetchOrganicAccounts('tiktok'),
  ])
  const allAccounts = [...ytAcc, ...igAcc, ...ttAcc]
  const sp = await searchParams
  // Filtro cross-platform: a conta selecionada (URL ou cookie global) vive em UMA
  // plataforma; só ela recebe o filtro e as demais não trazem nada (isolamento à conta).
  const contaExt = await resolveConta(sp.conta, allAccounts.map((a) => a.external_id))
  const contaAcc = contaExt ? allAccounts.find((a) => a.external_id === contaExt) : undefined
  const contaSel = contaAcc?.external_id
  const { de, ate } = resolveOrgRange(sp)
  const platOf = (p: OrganicPlatform) =>
    !contaSel ? undefined : contaAcc!.platform === p ? contaSel : '__none__'

  const [yt, ig, tt] = await Promise.all([
    fetchOrganicPosts('youtube', platOf('youtube')),
    fetchOrganicPosts('instagram', platOf('instagram')),
    fetchOrganicPosts('tiktok', platOf('tiktok')),
  ])
  const hasAccounts = allAccounts.length > 0

  if (!hasAccounts) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Análise de Conteúdo — Orgânico" subtitle="Todos os posts das plataformas conectadas, comparáveis" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 max-w-xl mx-auto mt-10 text-center">
            <Plug size={28} className="mx-auto text-gray-500 mb-3" />
            <h2 className="text-white font-semibold mb-1">Nenhuma conta conectada</h2>
            <p className="text-sm text-gray-400 mb-4">Conecte YouTube e Instagram em Admin → Projetos para os conteúdos aparecerem aqui.</p>
            <Link href="/admin/projetos" className="inline-flex rounded-md bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium text-white">Ir para Admin → Projetos</Link>
          </div>
        </div>
      </div>
    )
  }

  const all = [
    ...yt.map((p) => ({ p, platform: 'youtube' as const })),
    ...ig.map((p) => ({ p, platform: 'instagram' as const })),
    ...tt.map((p) => ({ p, platform: 'tiktok' as const })),
  ].filter(({ p }) => inRange(p.published_at, de, ate)) // período do filtro de data
  const scorable = all.map(({ p, platform }) => ({
    id: p.id, platform, format: p.format, published_at: p.published_at,
    duration_seconds: p.duration_seconds, views: p.views, likes: p.likes,
    comments_count: p.comments_count, shares: p.shares, saves: p.saves,
    apv: p.apv, completion_rate: p.completion_rate, avg_watch_time_s: p.avg_watch_time_s,
  }))
  const scores = computeScores(scorable, Date.now())
  const cards = all.map(({ p, platform }) =>
    toCard(p, platform, scores.get(p.id) ?? { outlier: null, composite: null }))
  const campeoes = championCuts(cards)

  // Receita atribuída via sck/utm_content — minRole admin (regra do plano:
  // financeiro do orgânico é visão interna; viewer não recebe nem o campo)
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId).catch(() => null) : null
  if (session?.role === 'admin') {
    const transacoes = await fetchTransacoes()
    const revMap = computeOrganicRevenue(
      transacoes,
      all.map(({ p, platform }) => ({ id: p.id, platform, external_id: p.external_id })),
    )
    for (const c of cards) c.receita = revMap.get(c.id) ?? null
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Análise de Conteúdo — Orgânico" subtitle="Plataforma é filtro; a unidade de análise é o conteúdo" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <AccountFilter accounts={allAccounts} />
        <FilterToggle prefix="org" showFunil={false} />
        <ConteudoClient cards={cards} campeoes={campeoes} />
      </div>
    </div>
  )
}
