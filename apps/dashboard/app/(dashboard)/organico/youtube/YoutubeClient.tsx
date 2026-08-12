'use client'

/**
 * Gráficos + tabela de vídeos da área YouTube (Orgânico).
 * Recharts (padrão do dash). Tudo dado real; "—" quando a API não retornou.
 */
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar,
} from 'recharts'
import { formatNumber, formatCurrency } from '@/lib/formatters'

/** Enums da API → nomes que o usuário conhece do Studio. */
const TRAFFIC_LABEL: Record<string, string> = {
  SUBSCRIBER: 'Browse (Home/Inscrições)',
  RELATED_VIDEO: 'Vídeos sugeridos',
  YT_SEARCH: 'Busca do YouTube',
  SHORTS: 'Feed de Shorts',
  EXT_URL: 'Externo (links)',
  NOTIFICATION: 'Notificações',
  PLAYLIST: 'Playlists',
  END_SCREEN: 'Telas finais',
  ADVERTISING: 'Anúncios',
  YT_CHANNEL: 'Página do canal',
  PROMOTED: 'Promovido',
  HASHTAGS: 'Hashtags',
  SOUND_PAGE: 'Página de som',
  VIDEO_REMIXES: 'Remixes',
  YT_OTHER_PAGE: 'Outras páginas',
  NO_LINK_OTHER: 'Direto/desconhecido',
}

export interface SeriePonto { date: string; views: number; horas: number; inscritos: number; receita: number | null }
export interface VideoRow {
  id: string
  titulo: string
  thumb: string | null
  permalink: string | null
  publicado: string
  formato: string | null
  views: number | null
  avd: number | null
  apv: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  subs: number | null
  impressions: number | null
  ctr: number | null
  receita: number | null
}

const n = (v: number | null, dec = 0) => (v == null ? '—' : formatNumber(v, dec))
const mmss = (s: number | null) => {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>
      <div className="h-52">{children}</div>
    </div>
  )
}

const tooltipStyle = {
  backgroundColor: '#0B1120', border: '1px solid #1F2937', borderRadius: 8,
  fontSize: 12, color: '#E5E7EB',
}

export default function YoutubeClient({ serie, trafficAgg, posts }: {
  serie: SeriePonto[]
  trafficAgg: Array<[string, number]>
  posts: VideoRow[]
}) {
  const trafficTotal = trafficAgg.reduce((s, [, v]) => s + v, 0)
  const topPosts = [...posts].sort((a, b) => (b.views ?? -1) - (a.views ?? -1))
  const temReceitaSerie = serie.some((p) => p.receita != null && p.receita > 0)
  const temReceitaVideo = posts.some((p) => p.receita != null)

  return (
    <>
      {/* Desempenho diário (yt-analytics.readonly + monetary) */}
      <div className="grid lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <ChartCard title="Views por dia">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
              <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} width={48} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="views" name="Views" stroke="#22D3EE" fill="#22D3EE22" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Watch time por dia (horas)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
              <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} width={48} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="horas" name="Horas" stroke="#A78BFA" fill="#A78BFA22" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Inscritos líquidos por dia">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
              <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} width={48} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="inscritos" name="Inscritos ±" fill="#34D399" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Receita por dia (R$)">
          {temReceitaSerie ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} width={48} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="receita" name="Receita (R$)" stroke="#34D399" fill="#34D39922" strokeWidth={2} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full grid place-items-center text-center px-4">
              <p className="text-xs text-gray-500">
                Sem receita no período — canal sem monetização ativa
                ou escopo de receita ainda não autorizado (reconecte o canal).
              </p>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Fontes de tráfego (yt-analytics.readonly) */}
      <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Fontes de tráfego (views, lifetime dos vídeos analisados)</h3>
        <p className="text-[11px] text-gray-600 mb-3">De onde vêm as views — descoberta (Browse/Sugeridos/Busca/Shorts) vs base e externos.</p>
        {trafficAgg.length === 0 ? (
          <p className="text-sm text-gray-500">Sem dados de fontes ainda — preenche após os primeiros syncs.</p>
        ) : (
          <div className="space-y-2">
            {trafficAgg.map(([key, v]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-48 shrink-0 text-xs text-gray-400 truncate">{TRAFFIC_LABEL[key] ?? key}</span>
                <div className="flex-1 h-2.5 rounded bg-white/5 overflow-hidden">
                  <div className="h-full rounded bg-cyan-400/70" style={{ width: `${Math.max(2, (v / trafficTotal) * 100)}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-xs text-gray-300">
                  {formatNumber(v)} <span className="text-gray-600">({((v / trafficTotal) * 100).toFixed(1)}%)</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vídeos (youtube.readonly + analytics por vídeo) */}
      <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Vídeos do canal — ordenados por views</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-[#1F2937]">
                <th className="text-left py-2 pr-3 font-medium">Vídeo</th>
                <th className="text-right py-2 px-3 font-medium">Publicado</th>
                <th className="text-right py-2 px-3 font-medium">Views</th>
                <th className="text-right py-2 px-3 font-medium">AVD</th>
                <th className="text-right py-2 px-3 font-medium">APV</th>
                <th className="text-right py-2 px-3 font-medium">Likes</th>
                <th className="text-right py-2 px-3 font-medium">Coment.</th>
                <th className="text-right py-2 px-3 font-medium">Shares</th>
                <th className="text-right py-2 px-3 font-medium">Receita</th>
                <th className="text-right py-2 pl-3 font-medium">Inscr. ±</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2937]">
              {topPosts.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.02]">
                  <td className="py-2 pr-3">
                    <a href={p.permalink ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 group">
                      {p.thumb
                        ? <img src={p.thumb} alt="" className="w-16 h-9 rounded object-cover shrink-0" />
                        : <div className="w-16 h-9 rounded bg-white/5 shrink-0" />}
                      <span className="max-w-[280px] truncate text-gray-200 group-hover:text-white">
                        {p.titulo}
                        {p.formato === 'short' && <span className="ml-1.5 text-[10px] rounded bg-rose-500/15 text-rose-300 px-1 py-0.5 align-middle">Short</span>}
                      </span>
                    </a>
                  </td>
                  <td className="py-2 px-3 text-right text-gray-400 whitespace-nowrap">{new Date(p.publicado).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="py-2 px-3 text-right text-gray-200">{n(p.views)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{mmss(p.avd)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{p.apv == null ? '—' : `${p.apv.toFixed(1)}%`}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{n(p.likes)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{n(p.comments)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{n(p.shares)}</td>
                  <td className="py-2 px-3 text-right text-emerald-300/90">{p.receita == null ? '—' : formatCurrency(p.receita)}</td>
                  <td className="py-2 pl-3 text-right text-gray-300">{p.subs == null ? '—' : `${p.subs >= 0 ? '+' : ''}${formatNumber(p.subs)}`}</td>
                </tr>
              ))}
              {topPosts.length === 0 && (
                <tr><td colSpan={10} className="py-6 text-center text-gray-500">Nenhum vídeo sincronizado ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
