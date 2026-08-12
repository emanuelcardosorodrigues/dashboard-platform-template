/**
 * /organico/instagram — área dedicada do Instagram.
 * Perfil diário (warehouse próprio — a API só guarda 30d), Reels/posts pelo que
 * o algoritmo pondera (sends/saves por alcance), Stories com funil de navegação
 * e unfollows por dia (conteúdo que queima seguidor).
 */
import Link from 'next/link'
import Header from '@/components/layout/Header'
import KpiCard from '@/components/cards/KpiCard'
import AccountFilter from '@/components/organico/AccountFilter'
import FilterToggle from '@/components/filters/FilterToggle'
import { Plug, Users, Eye, MousePointerClick, Activity } from 'lucide-react'
import { formatNumber } from '@/lib/formatters'
import {
  fetchOrganicAccounts, fetchOrganicProfileDaily, fetchOrganicPosts, fetchOrganicStories,
} from '@/lib/organico/queries'
import { computeScores } from '@/lib/organico/scores'
import { resolveConta } from '@/lib/organico/conta'
import { resolveOrgRange, inRange, type OrgDateParams } from '@/lib/organico/dateFilter'
import type { OrganicCardPost } from '@/components/organico/OrganicPostCard'
import InstagramClient from './InstagramClient'

export const dynamic = 'force-dynamic'

export default async function OrganicoInstagramPage({ searchParams }: { searchParams: Promise<{ conta?: string } & OrgDateParams> }) {
  const accounts = await fetchOrganicAccounts('instagram')
  const sp = await searchParams
  const contaSel = await resolveConta(sp.conta, accounts.map((a) => a.external_id))
  const { de, ate } = resolveOrgRange(sp)
  const rangeActive = !!(de || ate)

  const [profile, posts, stories] = await Promise.all([
    fetchOrganicProfileDaily('instagram', 90, contaSel),
    fetchOrganicPosts('instagram', contaSel),
    fetchOrganicStories(30, contaSel),
  ])

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Instagram — Orgânico" subtitle="Perfil, Reels/posts e Stories da conta conectada" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 max-w-xl mx-auto mt-10 text-center">
            <Plug size={28} className="mx-auto text-gray-500 mb-3" />
            <h2 className="text-white font-semibold mb-1">Nenhuma conta Instagram conectada</h2>
            <p className="text-sm text-gray-400 mb-4">
              Conecte em Admin → Projetos (a conta precisa ser profissional e vinculada a uma Página do Facebook).
            </p>
            <Link href="/admin/projetos" className="inline-flex rounded-md bg-fuchsia-600 hover:bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white">
              Conectar em Admin → Projetos
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Contas em escopo: a selecionada (se houver) ou todas as do projeto.
  const escopo = contaSel ? accounts.filter((a) => a.external_id === contaSel) : accounts
  const contaUnica = escopo.length === 1 ? escopo[0] : null
  const ultimoSync = escopo
    .map((a) => a.last_sync_at).filter((v): v is string => v != null)
    .sort().at(-1) ?? null

  // Janela das métricas: período do filtro (se ativo) OU padrão 28d.
  const cut28 = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10)
  const last28 = profile.filter((d) => rangeActive ? inRange(d.date, de, ate) : d.date >= cut28)
  const janelaLabel = rangeActive ? 'período' : '28d'

  // Seguidores = soma do último valor conhecido POR conta (não some datas distintas).
  const followersPorConta = new Map<string, number>()
  for (const d of profile) {
    if (d.followers != null) followersPorConta.set(d.account_id, d.followers)
  }
  const followersHoje = followersPorConta.size > 0
    ? [...followersPorConta.values()].reduce((s, v) => s + v, 0)
    : null
  const alcance28 = last28.reduce((s, d) => s + (d.reach ?? 0), 0)
  const linkTaps28 = last28.reduce((s, d) => s + (d.link_taps ?? 0), 0)
  const engaged28 = last28.reduce((s, d) => s + (d.accounts_engaged ?? 0), 0)
  const liquido28 = last28.reduce((s, d) => s + (d.follows ?? 0) - (d.unfollows ?? 0), 0)
  // % audiência ativa: alcançados no período ÷ seguidores (base inflada = entrega morta)
  const audienciaAtiva = followersHoje != null && followersHoje > 0 && alcance28 > 0
    ? Math.min(999, (alcance28 / followersHoje) * 100)
    : null

  // Gráfico diário: período do filtro (se ativo) OU os 90d carregados.
  const serieProfile = rangeActive ? profile.filter((d) => inRange(d.date, de, ate)) : profile
  const serie = serieProfile.reduce((map, d) => {
    const cur = map.get(d.date) ?? { views: 0, liquido: 0, unfollows: 0 }
    cur.views += d.views ?? 0
    cur.liquido += (d.follows ?? 0) - (d.unfollows ?? 0)
    cur.unfollows += d.unfollows ?? 0
    map.set(d.date, cur)
    return map
  }, new Map<string, { views: number; liquido: number; unfollows: number }>())
  const serieArr = [...serie.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date: date.slice(5).split('-').reverse().join('/'), ...v }))

  // Seguidores líquidos da CONTA por dia. A API do IG não dá follows por Reel, então
  // o cliente RATEIA esse líquido entre os posts do dia proporcional ao alcance.
  const netByDate: Record<string, number> = {}
  for (const d of profile) netByDate[d.date] = (netByDate[d.date] ?? 0) + (d.follows ?? 0) - (d.unfollows ?? 0)

  // split seguidor × não-seguidor (nível CONTA — a API não dá por post)
  const vf = last28.reduce((s, d) => s + (d.views_followers ?? 0), 0)
  const vnf = last28.reduce((s, d) => s + (d.views_non_followers ?? 0), 0)

  // Posts dentro do período do filtro (publicados em [de, ate]).
  const postsF = posts.filter((p) => inRange(p.published_at, de, ate))

  // Cards dos posts (igual à Análise de Criativos): score/outlier vs MEDIANA do cohort.
  const scores = computeScores(
    postsF.map((p) => ({
      id: p.id, platform: 'instagram', format: p.format, published_at: p.published_at,
      duration_seconds: p.duration_seconds, views: p.views, likes: p.likes,
      comments_count: p.comments_count, shares: p.shares, saves: p.saves,
      apv: p.apv, completion_rate: p.completion_rate, avg_watch_time_s: p.avg_watch_time_s,
    })),
    Date.now(),
  )
  const cards: OrganicCardPost[] = postsF.map((p) => {
    const sc = scores.get(p.id) ?? { outlier: null, composite: null }
    return {
      id: p.id, platform: 'instagram', format: p.format, title: p.title, caption: p.caption,
      thumbnail_url: p.thumbnail_url, permalink: p.permalink, published_at: p.published_at,
      duration_seconds: p.duration_seconds, views: p.views, engaged_views: p.engaged_views,
      reach: p.reach, likes: p.likes, comments_count: p.comments_count, shares: p.shares,
      saves: p.saves, apv: p.apv, avg_watch_time_s: p.avg_watch_time_s,
      completion_rate: p.completion_rate, skip_rate: p.skip_rate,
      subs_gained: p.subs_gained, profile_visits: p.profile_visits,
      impressions: p.impressions, impressions_ctr: p.impressions_ctr,
      gancho_codigo: p.gancho_codigo, estrutura: p.estrutura, tema: p.tema,
      outlier: p.outlier_score ?? sc.outlier,
      composite: p.composite_score ?? sc.composite,
    }
  })

  return (
    <div className="flex flex-col h-full">
      <Header title="Instagram — Orgânico" subtitle="Dados da conta conectada via OAuth (somente leitura)" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        <AccountFilter accounts={accounts} />
        <FilterToggle prefix="org" showFunil={false} />

        <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-5 flex flex-wrap items-center gap-4">
          {contaUnica
            ? (contaUnica.avatar_url
                ? // eslint-disable-next-line @next/next/no-img-element
                  <img src={contaUnica.avatar_url} alt="" className="w-14 h-14 rounded-full" />
                : <div className="w-14 h-14 rounded-full bg-white/10" />)
            : <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold text-gray-300">{escopo.length}</div>}
          <div className="min-w-0 flex-1">
            <h2 className="text-white font-semibold text-lg truncate">
              {contaUnica ? `@${contaUnica.handle}` : `${escopo.length} contas agregadas`}
            </h2>
            <p className="text-xs text-gray-500">
              {contaUnica
                ? <>Conta conectada pelo titular · sincronizada {ultimoSync ? new Date(ultimoSync).toLocaleString('pt-BR') : '—'}</>
                : <>Soma de {escopo.length} contas conectadas neste projeto · último sync {ultimoSync ? new Date(ultimoSync).toLocaleString('pt-BR') : '—'}</>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-white">{followersHoje != null ? formatNumber(followersHoje) : '—'}</p>
            <p className="text-[11px] text-gray-500 uppercase tracking-wider">Seguidores</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label={`Seguidores líquidos (${janelaLabel})`} value={`${liquido28 >= 0 ? '+' : ''}${formatNumber(liquido28)}`} icon={<Users size={16} />} subtext="follows − unfollows" />
          <KpiCard label={`Alcance (${janelaLabel})`} value={alcance28 > 0 ? formatNumber(alcance28) : '—'} icon={<Eye size={16} />} subtext="contas alcançadas" />
          <KpiCard label={`% audiência ativa (${janelaLabel})`} value={audienciaAtiva != null ? `${audienciaAtiva.toFixed(0)}%` : '—'} icon={<Activity size={16} />} subtext="alcançados ÷ seguidores" />
          <KpiCard label={`Cliques no link (${janelaLabel})`} value={linkTaps28 > 0 ? formatNumber(linkTaps28) : '—'} icon={<MousePointerClick size={16} />} subtext={engaged28 > 0 ? `${formatNumber(engaged28)} contas engajadas` : 'profile_links_taps'} />
        </div>

        {(vf > 0 || vnf > 0) && (
          <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-1">Views: seguidores × não-seguidores ({janelaLabel}, nível conta)</h3>
            <p className="text-[11px] text-gray-600 mb-3">Não-seguidores alto = descoberta funcionando. A API só fornece este split no nível da conta, não por post.</p>
            <div className="flex h-3 rounded overflow-hidden border border-white/5">
              <div className="bg-fuchsia-400/80" style={{ width: `${(vnf / (vf + vnf)) * 100}%` }} />
              <div className="bg-blue-400/70" style={{ width: `${(vf / (vf + vnf)) * 100}%` }} />
            </div>
            <div className="flex gap-4 mt-2 text-[11px]">
              <span className="text-fuchsia-300">● Não-seguidores {((vnf / (vf + vnf)) * 100).toFixed(1)}%</span>
              <span className="text-blue-300">● Seguidores {((vf / (vf + vnf)) * 100).toFixed(1)}%</span>
            </div>
          </div>
        )}

        <InstagramClient
          serie={serieArr}
          cards={cards}
          netByDate={netByDate}
          stories={stories.filter((s) => inRange(s.published_at, de, ate)).map((s) => ({
            id: s.id, thumb: s.thumbnail_url, publicado: s.published_at,
            views: s.views, reach: s.reach, replies: s.replies, shares: s.shares,
            tapsForward: s.taps_forward, tapsBack: s.taps_back, exits: s.exits,
            swipes: s.swipes_forward, finalized: s.finalized,
          }))}
        />

        <p className="text-[11px] text-gray-600">
          Fonte: Instagram Graph API (somente leitura). Seguidores são arquivados diariamente (a API só retém 30 dias).
          Stories só têm métricas enquanto vivos (24h) — coletamos a cada 3h + números finais no webhook de expiração.
          Métricas com menos de 5 views são suprimidas pela API (&quot;—&quot;).
        </p>
      </div>
    </div>
  )
}
