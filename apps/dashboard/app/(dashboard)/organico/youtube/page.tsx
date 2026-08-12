/**
 * /organico/youtube — área dedicada do YouTube (Orgânico).
 *
 * Tudo aqui é dado REAL do canal conectado via OAuth (somente leitura):
 *  - youtube.readonly      → identidade do canal + lista de vídeos (Data API)
 *  - yt-analytics.readonly → views/watch time/inscritos por dia, AVD/APV,
 *                            fontes de tráfego, curva de retenção (Analytics API)
 * Lag oficial do Analytics: 48-72h. Métrica ausente = "—" (nunca zero falso).
 */
import Link from 'next/link'
import Header from '@/components/layout/Header'
import KpiCard from '@/components/cards/KpiCard'
import AccountFilter from '@/components/organico/AccountFilter'
import FilterToggle from '@/components/filters/FilterToggle'
import { Eye, Clock, UserPlus, Film, Plug, DollarSign } from 'lucide-react'
import { formatNumber, formatCurrency } from '@/lib/formatters'
import {
  fetchOrganicAccounts, fetchOrganicProfileDaily, fetchOrganicPosts,
} from '@/lib/organico/queries'
import { resolveConta } from '@/lib/organico/conta'
import { resolveOrgRange, inRange, type OrgDateParams } from '@/lib/organico/dateFilter'
import YoutubeClient from './YoutubeClient'

export const dynamic = 'force-dynamic'

export default async function OrganicoYoutubePage({ searchParams }: { searchParams: Promise<{ conta?: string } & OrgDateParams> }) {
  const accounts = await fetchOrganicAccounts('youtube')
  const sp = await searchParams
  // `?conta=` (URL) ou o cookie global; senão "Todas" (agrega todas as contas).
  const contaSel = await resolveConta(sp.conta, accounts.map((a) => a.external_id))
  const { de, ate } = resolveOrgRange(sp)
  const rangeActive = !!(de || ate)

  const [profile, posts] = await Promise.all([
    fetchOrganicProfileDaily('youtube', 90, contaSel),
    fetchOrganicPosts('youtube', contaSel),
  ])

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header title="YouTube — Orgânico" subtitle="Desempenho do canal conectado" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 max-w-xl mx-auto mt-10 text-center">
            <Plug size={28} className="mx-auto text-gray-500 mb-3" />
            <h2 className="text-white font-semibold mb-1">Nenhum canal conectado neste projeto</h2>
            <p className="text-sm text-gray-400 mb-4">
              Conecte o canal do YouTube via OAuth — o dono autoriza no Google e os
              dados (somente leitura) passam a sincronizar diariamente.
            </p>
            <Link href="/admin/projetos" className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 hover:bg-rose-500 px-4 py-2 text-sm font-medium text-white">
              Conectar em Admin → Projetos
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Posts no período do filtro (publicados em [de, ate]) — tabela + agregados.
  const postsF = posts.filter((p) => inRange(p.published_at, de, ate))
  // Série diária agregada (multi-canal soma por data) — período do filtro OU 90d.
  const serieProfile = rangeActive ? profile.filter((d) => inRange(d.date, de, ate)) : profile
  const byDate = new Map<string, { views: number; watch_h: number; subs: number; subsLost: number; receita: number; temReceita: boolean }>()
  for (const d of serieProfile) {
    const cur = byDate.get(d.date) ?? { views: 0, watch_h: 0, subs: 0, subsLost: 0, receita: 0, temReceita: false }
    cur.views += d.views ?? 0
    cur.watch_h += (d.watch_time_s ?? 0) / 3600
    cur.subs += d.subs_gained ?? 0
    cur.subsLost += d.subs_lost ?? 0
    if (d.revenue != null) { cur.receita += d.revenue; cur.temReceita = true }
    byDate.set(d.date, cur)
  }
  const serie = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date: date.slice(5).split('-').reverse().join('/'),
      views: v.views,
      horas: Math.round(v.watch_h * 10) / 10,
      inscritos: v.subs - v.subsLost,
      receita: v.temReceita ? Math.round(v.receita * 100) / 100 : null,
    }))

  // KPIs: período do filtro (se ativo) OU padrão 28d.
  const cut28 = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10)
  const janelaLabel = rangeActive ? 'período' : '28d'
  const last28 = profile.filter((d) => rangeActive ? inRange(d.date, de, ate) : d.date >= cut28)
  const views28 = last28.reduce((s, d) => s + (d.views ?? 0), 0)
  const watchH28 = last28.reduce((s, d) => s + (d.watch_time_s ?? 0), 0) / 3600
  const subs28 = last28.reduce((s, d) => s + (d.subs_gained ?? 0) - (d.subs_lost ?? 0), 0)
  const videos28 = rangeActive ? postsF.length : posts.filter((p) => p.published_at.slice(0, 10) >= cut28).length

  // Receita (yt-analytics-monetary.readonly) — null = escopo não concedido /
  // canal sem monetização → painel mostra "—" com explicação (nunca zero falso)
  const hasRevenue = profile.some((d) => d.revenue != null)
  const receita28 = hasRevenue ? last28.reduce((s, d) => s + (d.revenue ?? 0), 0) : null
  const rpm28 = hasRevenue && views28 > 0 ? (receita28! / (views28 / 1000)) : null
  const cpms = last28.map((d) => d.cpm).filter((v): v is number => v != null)
  const cpm28 = cpms.length > 0 ? cpms.reduce((s, v) => s + v, 0) / cpms.length : null

  // Fontes de tráfego agregadas (lifetime, dos vídeos com detalhe)
  const traffic = new Map<string, number>()
  for (const p of postsF) {
    for (const [k, v] of Object.entries(p.traffic_sources ?? {})) {
      traffic.set(k, (traffic.get(k) ?? 0) + v)
    }
  }
  const trafficAgg = [...traffic.entries()].sort((a, b) => b[1] - a[1])

  // Contas em escopo: a selecionada (se houver) ou todas as do projeto.
  const escopo = contaSel ? accounts.filter((a) => a.external_id === contaSel) : accounts
  const contaUnica = escopo.length === 1 ? escopo[0] : null
  // Stats do canal: soma channel_stats das contas em escopo (cada conta tem o seu).
  const sumStat = (k: 'subscribers' | 'total_views' | 'videos') => {
    const vals = escopo.map((a) => a.meta?.channel_stats?.[k]).filter((v): v is number => v != null)
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) : null
  }
  const subsTotal = sumStat('subscribers')
  const viewsTotal = sumStat('total_views')
  const videosTotal = sumStat('videos')
  const ultimoSync = escopo
    .map((a) => a.last_sync_at).filter((v): v is string => v != null)
    .sort().at(-1) ?? null

  return (
    <div className="flex flex-col h-full">
      <Header title="YouTube — Orgânico" subtitle="Dados do canal conectado via OAuth (somente leitura)" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        <AccountFilter accounts={accounts} />
        <FilterToggle prefix="org" showFunil={false} />

        {/* Identidade do canal autorizado (exigência: deixar claro de QUEM é o dado) */}
        <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-5 flex flex-wrap items-center gap-4">
          {contaUnica
            ? (contaUnica.avatar_url
                ? <img src={contaUnica.avatar_url} alt="" className="w-14 h-14 rounded-full" />
                : <div className="w-14 h-14 rounded-full bg-white/10" />)
            : <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold text-gray-300">{escopo.length}</div>}
          <div className="min-w-0 flex-1">
            <h2 className="text-white font-semibold text-lg truncate">
              {contaUnica ? (contaUnica.display_name || contaUnica.handle) : `${escopo.length} canais agregados`}
            </h2>
            <p className="text-xs text-gray-500">
              {contaUnica
                ? <>Canal conectado pelo titular via Google OAuth · sincronizado {ultimoSync ? new Date(ultimoSync).toLocaleString('pt-BR') : '—'}</>
                : <>Soma de {escopo.length} canais conectados neste projeto · último sync {ultimoSync ? new Date(ultimoSync).toLocaleString('pt-BR') : '—'}</>}
            </p>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-lg font-bold text-white">{subsTotal != null ? formatNumber(subsTotal) : '—'}</p>
              <p className="text-[11px] text-gray-500 uppercase tracking-wider">Inscritos</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white">{viewsTotal != null ? formatNumber(viewsTotal) : '—'}</p>
              <p className="text-[11px] text-gray-500 uppercase tracking-wider">Views totais</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white">{videosTotal != null ? formatNumber(videosTotal) : formatNumber(posts.length)}</p>
              <p className="text-[11px] text-gray-500 uppercase tracking-wider">Vídeos</p>
            </div>
          </div>
        </div>

        {/* KPIs 28 dias (Analytics API) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label={`Views (${janelaLabel})`} value={formatNumber(views28)} icon={<Eye size={16} />} subtext="YouTube Analytics API" />
          <KpiCard label={`Watch time (${janelaLabel})`} value={`${formatNumber(watchH28, 1)} h`} icon={<Clock size={16} />} subtext="Tempo de exibição" />
          <KpiCard label={`Inscritos líquidos (${janelaLabel})`} value={`${subs28 >= 0 ? '+' : ''}${formatNumber(subs28)}`} icon={<UserPlus size={16} />} subtext="ganhos − perdidos" />
          <KpiCard label={`Vídeos publicados (${janelaLabel})`} value={formatNumber(videos28)} icon={<Film size={16} />} subtext="Data API" />
        </div>

        {/* Financeiro (yt-analytics-monetary.readonly) */}
        <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign size={15} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-gray-300">Receita do canal (YouTube Analytics — escopo monetário, somente leitura)</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard label={`Receita estimada (${janelaLabel})`} value={receita28 != null ? formatCurrency(receita28) : '—'} subtext="estimatedRevenue · BRL" />
            <KpiCard label={`RPM (${janelaLabel})`} value={rpm28 != null ? formatCurrency(rpm28) : '—'} subtext="receita ÷ views ×1.000" />
            <KpiCard label={`CPM médio (${janelaLabel})`} value={cpm28 != null ? formatCurrency(cpm28) : '—'} subtext="custo por mil exibições de anúncio" />
          </div>
          {!hasRevenue && (
            <p className="text-[11px] text-amber-400/80 mt-3">
              Sem dados de receita: o canal ainda não tem monetização ativa no YouTube Partner Program,
              ou a conexão foi feita antes da autorização do escopo de receita — reconecte o canal para conceder.
            </p>
          )}
        </div>

        <YoutubeClient serie={serie} trafficAgg={trafficAgg} posts={postsF.map((p) => ({
          id: p.id,
          titulo: p.title ?? p.external_id,
          thumb: p.thumbnail_url,
          permalink: p.permalink,
          publicado: p.published_at,
          formato: p.format,
          views: p.views,
          avd: p.avg_watch_time_s,
          apv: p.apv,
          likes: p.likes,
          comments: p.comments_count,
          shares: p.shares,
          subs: p.subs_gained != null || p.subs_lost != null ? (p.subs_gained ?? 0) - (p.subs_lost ?? 0) : null,
          impressions: p.impressions,
          ctr: p.impressions_ctr,
          receita: p.revenue,
        }))} />

        <p className="text-[11px] text-gray-600">
          Fontes: YouTube Data API v3 (metadados) e YouTube Analytics API (desempenho), acesso somente leitura
          autorizado pelo dono do canal. Dados do Analytics têm defasagem oficial de 48–72h. &quot;—&quot; = a API
          ainda não retornou o dado (nunca exibimos zero no lugar).
        </p>
      </div>
    </div>
  )
}
