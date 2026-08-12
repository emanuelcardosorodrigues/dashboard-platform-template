/**
 * /organico/visao-geral — termômetro do Orgânico (3 plataformas agregadas).
 * KPIs 28d + origem do alcance (descoberta × base × anúncio — o diagnóstico
 * mais subestimado) + série diária + saúde dos dados.
 */
import Link from 'next/link'
import Header from '@/components/layout/Header'
import KpiCard from '@/components/cards/KpiCard'
import OrganicDataHealth from '@/components/organico/OrganicDataHealth'
import AccountFilter from '@/components/organico/AccountFilter'
import FilterToggle from '@/components/filters/FilterToggle'
import { Plug, Users, Eye, Heart, Film } from 'lucide-react'
import { formatNumber } from '@/lib/formatters'
import {
  fetchOrganicAccounts, fetchOrganicProfileDaily, fetchOrganicPosts, type OrganicPlatform,
} from '@/lib/organico/queries'
import { resolveConta } from '@/lib/organico/conta'
import { resolveOrgRange, inRange, type OrgDateParams } from '@/lib/organico/dateFilter'
import VisaoGeralClient from './VisaoGeralClient'

export const dynamic = 'force-dynamic'

/** Fontes YT por intenção: descoberta (algoritmo distribuindo) vs base vs pago. */
const DESCOBERTA = new Set(['RELATED_VIDEO', 'YT_SEARCH', 'SHORTS', 'SUBSCRIBER', 'HASHTAGS', 'SOUND_PAGE'])
const PAGO = new Set(['ADVERTISING', 'PROMOTED'])

export default async function VisaoGeralOrganicaPage({ searchParams }: { searchParams: Promise<{ conta?: string } & OrgDateParams> }) {
  const [ytAcc, igAcc, ttAcc] = await Promise.all([
    fetchOrganicAccounts('youtube'),
    fetchOrganicAccounts('instagram'),
    fetchOrganicAccounts('tiktok'),
  ])
  const accounts = [...ytAcc, ...igAcc, ...ttAcc]
  const sp = await searchParams
  // Filtro cross-platform: a conta selecionada (URL ou cookie global) vive em UMA plataforma.
  const contaExt = await resolveConta(sp.conta, accounts.map((a) => a.external_id))
  const contaAcc = contaExt ? accounts.find((a) => a.external_id === contaExt) : undefined
  const contaSel = contaAcc?.external_id
  const { de, ate } = resolveOrgRange(sp)
  const rangeActive = !!(de || ate)
  const janelaLabel = rangeActive ? 'período' : '28d'
  const platOf = (p: OrganicPlatform) =>
    !contaSel ? undefined : contaAcc!.platform === p ? contaSel : '__none__'

  const [ytDaily, igDaily, ytPosts, igPosts] = await Promise.all([
    fetchOrganicProfileDaily('youtube', 90, platOf('youtube')),
    fetchOrganicProfileDaily('instagram', 90, platOf('instagram')),
    fetchOrganicPosts('youtube', platOf('youtube')),
    fetchOrganicPosts('instagram', platOf('instagram')),
  ])

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Visão Geral — Orgânico" subtitle="O segundo motor de tráfego do projeto" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 max-w-xl mx-auto mt-10 text-center">
            <Plug size={28} className="mx-auto text-gray-500 mb-3" />
            <h2 className="text-white font-semibold mb-1">Nenhuma conta conectada</h2>
            <p className="text-sm text-gray-400 mb-4">Conecte YouTube e Instagram em Admin → Projetos.</p>
            <Link href="/admin/projetos" className="inline-flex rounded-md bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium text-white">Admin → Projetos</Link>
          </div>
        </div>
      </div>
    )
  }

  const daily = [...ytDaily, ...igDaily]
  const cut28 = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10)
  // Janela: período do filtro (se ativo) OU padrão 28d.
  const last28 = daily.filter((d) => rangeActive ? inRange(d.date, de, ate) : d.date >= cut28)
  const postsJanela = [...ytPosts, ...igPosts].filter((p) =>
    rangeActive ? inRange(p.published_at, de, ate) : p.published_at.slice(0, 10) >= cut28)

  const views28 = last28.reduce((s, d) => s + (d.views ?? 0), 0)
  const seguidores28 = last28.reduce((s, d) =>
    s + (d.subs_gained ?? 0) - (d.subs_lost ?? 0) + (d.follows ?? 0) - (d.unfollows ?? 0), 0)
  const alcance28 = last28.reduce((s, d) => s + (d.reach ?? 0), 0)
  const posts28 = postsJanela.length
  const eng28 = postsJanela
    .reduce((s, p) => s + (p.likes ?? 0) + (p.comments_count ?? 0) + (p.shares ?? 0) + (p.saves ?? 0), 0)

  // Origem do alcance (YT traffic_sources agregado)
  let descoberta = 0, pago = 0, outros = 0
  for (const p of ytPosts) {
    for (const [k, v] of Object.entries(p.traffic_sources ?? {})) {
      if (DESCOBERTA.has(k)) descoberta += v
      else if (PAGO.has(k)) pago += v
      else outros += v
    }
  }
  const origemTotal = descoberta + pago + outros

  // série diária agregada pro gráfico — período do filtro (se ativo) OU 90d
  const serieDaily = rangeActive ? daily.filter((d) => inRange(d.date, de, ate)) : daily
  const byDate = new Map<string, { views: number; seguidores: number }>()
  for (const d of serieDaily) {
    const cur = byDate.get(d.date) ?? { views: 0, seguidores: 0 }
    cur.views += d.views ?? 0
    cur.seguidores += (d.subs_gained ?? 0) - (d.subs_lost ?? 0) + (d.follows ?? 0) - (d.unfollows ?? 0)
    byDate.set(d.date, cur)
  }
  const serie = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date: date.slice(5).split('-').reverse().join('/'), ...v }))

  return (
    <div className="flex flex-col h-full">
      <Header title="Visão Geral — Orgânico" subtitle="YouTube + Instagram agregados (TikTok em aprovação)" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <AccountFilter accounts={accounts} />
        <FilterToggle prefix="org" showFunil={false} />
        <OrganicDataHealth accounts={accounts} />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label={`Seguidores líquidos (${janelaLabel})`} value={`${seguidores28 >= 0 ? '+' : ''}${formatNumber(seguidores28)}`} icon={<Users size={16} />} subtext="inscritos + seguidores, ganho − perda" />
          <KpiCard label={`Views (${janelaLabel})`} value={formatNumber(views28)} icon={<Eye size={16} />} subtext="todas as plataformas" />
          <KpiCard label={`Engajamento (${janelaLabel})`} value={formatNumber(eng28)} icon={<Heart size={16} />} subtext="likes + comentários + shares + saves" />
          <KpiCard label={`Conteúdos publicados (${janelaLabel})`} value={formatNumber(posts28)} icon={<Film size={16} />} subtext={alcance28 > 0 ? `alcance ${formatNumber(alcance28)}` : 'cadência de publicação'} />
        </div>

        {/* Origem do alcance — descoberta vs base vs anúncio */}
        {origemTotal > 0 && (
          <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-1">Origem das views (YouTube, lifetime)</h3>
            <p className="text-[11px] text-gray-600 mb-3">
              Descoberta alta = o algoritmo está distribuindo. Anúncio alto = o &quot;orgânico&quot; está sendo carregado por mídia paga.
            </p>
            <div className="flex h-3 rounded overflow-hidden border border-white/5">
              <div className="bg-emerald-400/80" style={{ width: `${(descoberta / origemTotal) * 100}%` }} title="Descoberta" />
              <div className="bg-rose-400/70" style={{ width: `${(pago / origemTotal) * 100}%` }} title="Anúncio" />
              <div className="bg-gray-500/60" style={{ width: `${(outros / origemTotal) * 100}%` }} title="Outros" />
            </div>
            <div className="flex gap-4 mt-2 text-[11px]">
              <span className="text-emerald-300">● Descoberta {((descoberta / origemTotal) * 100).toFixed(1)}%</span>
              <span className="text-rose-300">● Anúncio {((pago / origemTotal) * 100).toFixed(1)}%</span>
              <span className="text-gray-400">● Outros {((outros / origemTotal) * 100).toFixed(1)}%</span>
            </div>
          </div>
        )}

        <VisaoGeralClient serie={serie} />

        <div className="flex gap-2 text-[11px]">
          <Link href="/organico/conteudo" className="text-blue-400 hover:underline">→ Análise de Conteúdo</Link>
          <Link href="/organico/youtube" className="text-blue-400 hover:underline">→ YouTube</Link>
          <Link href="/organico/instagram" className="text-blue-400 hover:underline">→ Instagram</Link>
        </div>
      </div>
    </div>
  )
}
