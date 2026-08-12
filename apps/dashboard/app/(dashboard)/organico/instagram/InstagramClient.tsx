'use client'

/**
 * Área Instagram: crescimento (com unfollows ao lado do dia — conteúdo que
 * queima seguidor) + TABELA DE POSTS (mesma dinâmica da aba Criativos: cada
 * métrica é uma coluna ordenável — clica no cabeçalho e a tabela inteira
 * ordena; botão "Colunas" adiciona/remove as métricas disponíveis) + Stories.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar,
} from 'recharts'
import { Columns3, ExternalLink } from 'lucide-react'
import { formatNumber } from '@/lib/formatters'
import DataTable from '@/components/tables/DataTable'
import type { OrganicCardPost } from '@/components/organico/OrganicPostCard'

const tooltipStyle = {
  backgroundColor: '#0B1120', border: '1px solid #1F2937', borderRadius: 8,
  fontSize: 12, color: '#E5E7EB',
}

interface StoryRow {
  id: string; thumb: string | null; publicado: string
  views: number | null; reach: number | null; replies: number | null; shares: number | null
  tapsForward: number | null; tapsBack: number | null; exits: number | null
  swipes: number | null; finalized: boolean
}

const n = (v: number | null) => (v == null ? '—' : formatNumber(v))
const pctF = (v: number | null) => (v == null ? '—' : `${v.toFixed(v < 1 ? 2 : 1)}%`)
const rate = (num: number | null, den: number | null) =>
  num == null || den == null || den <= 0 ? null : (num / den) * 100

// ─── Linha plana da tabela (DataTable ordena por row[key] numérico) ───────────
interface IgRow extends Record<string, unknown> {
  id: string
  titulo: string
  thumb: string | null
  permalink: string | null
  formato: string | null
  publicadoTs: number
  views: number | null
  reach: number | null
  likes: number | null
  comentarios: number | null
  shares: number | null
  saves: number | null
  engajamento: number | null
  savesRate: number | null
  sharesRate: number | null
  followsRate: number | null
  comentariosRate: number | null
  curtidasRate: number | null
  watch: number | null
  skip: number | null
  score: number | null
  outlier: number | null
  seguidoresEst: number | null
  profileVisits: number | null
}

function toRow(p: OrganicCardPost): IgRow {
  const base = p.reach ?? p.views
  const eng = p.views != null && p.views > 0
    ? (((p.likes ?? 0) + (p.comments_count ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / p.views) * 100
    : null
  return {
    id: p.id,
    titulo: (p.title || p.caption || p.id).slice(0, 120),
    thumb: p.thumbnail_url, permalink: p.permalink, formato: p.format,
    publicadoTs: new Date(p.published_at).getTime(),
    views: p.views, reach: p.reach, likes: p.likes, comentarios: p.comments_count,
    shares: p.shares, saves: p.saves,
    engajamento: eng,
    savesRate: rate(p.saves, base),
    sharesRate: rate(p.shares, base),
    followsRate: rate(p.subs_gained, p.views),
    comentariosRate: rate(p.comments_count, p.views),
    curtidasRate: rate(p.likes, p.views),
    watch: p.avg_watch_time_s,
    skip: p.skip_rate,
    score: p.composite,
    outlier: p.outlier,
    seguidoresEst: null, // preenchido na atribuição (rateio por alcance) no componente
    profileVisits: p.profile_visits ?? null,
  }
}

const FORMAT_LABEL: Record<string, string> = { reel: 'Reel', feed: 'Feed', carousel: 'Carrossel', live: 'Live' }

// Coluna "Post" (sempre 1ª, fixa): thumb + título + chip de formato + link "abrir".
const POST_COLUMN = {
  key: 'titulo' as const,
  label: 'Post',
  sortable: false,
  align: 'left' as const,
  width: 300,
  render: (_v: unknown, row: IgRow) => (
    <a href={row.permalink ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 group">
      {row.thumb
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={row.thumb} alt="" className="w-9 h-12 rounded object-cover shrink-0" loading="lazy" />
        : <div className="w-9 h-12 rounded bg-white/5 shrink-0" />}
      <span className="min-w-0 flex items-center gap-1.5 text-gray-200 group-hover:text-white">
        <span className="truncate">{row.titulo}</span>
        {row.formato && <span className="shrink-0 text-[10px] rounded bg-fuchsia-500/15 text-fuchsia-300 px-1 py-0.5">{FORMAT_LABEL[row.formato] ?? row.formato}</span>}
        <ExternalLink size={11} className="shrink-0 text-gray-600 group-hover:text-gray-300" />
      </span>
    </a>
  ),
}

// Métricas disponíveis como COLUNAS (todas ordenáveis). Ordem = ordem na tabela.
interface MetricCol { key: keyof IgRow; label: string; render: (v: number | null) => React.ReactNode; info?: string }
const METRIC_COLUMNS: MetricCol[] = [
  { key: 'publicadoTs', label: 'Publicado', render: (v) => v == null ? '—' : new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) },
  { key: 'views', label: 'Views', render: n },
  { key: 'reach', label: 'Alcance', render: n },
  { key: 'likes', label: 'Curtidas', render: n },
  { key: 'comentarios', label: 'Comentários', render: n },
  { key: 'shares', label: 'Shares', render: n },
  { key: 'saves', label: 'Saves', render: n },
  { key: 'profileVisits', label: 'Visitas perfil', render: n, info: 'Visitas ao perfil geradas pelo post (profile_visits) — o passo antes de seguir. Só feed/carrossel: a API do Instagram não fornece pra Reels (vem "—").' },
  { key: 'engajamento', label: 'Engaj. %', render: pctF, info: '(curtidas+comentários+shares+saves) ÷ views' },
  { key: 'savesRate', label: 'Saves/Alc. %', render: pctF, info: 'saves ÷ alcance — sinal forte pro algoritmo' },
  { key: 'sharesRate', label: 'Shares/Alc. %', render: pctF, info: 'shares ÷ alcance — o que mais pesa na distribuição' },
  // NOTE: "seguidores ganhos por post" NÃO existe na API do Instagram p/ Reels
  // (é métrica de CONTA, vista no KPI "Seguidores líquidos (28d)") → coluna removida.
  { key: 'comentariosRate', label: 'Coment/View %', render: pctF },
  { key: 'curtidasRate', label: 'Curtidas/View %', render: pctF },
  {
    key: 'seguidoresEst', label: 'Seguidores (est.)',
    render: (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${formatNumber(v)}`,
    info: 'Estimativa de seguidores ganhos POR ESTE post. A API do Instagram não fornece follows por Reel, então rateamos o líquido de seguidores da CONTA no dia (follows − unfollows) entre os posts do dia, proporcional ao melhor sinal disponível: visitas ao perfil (profile_visits — o passo antes de seguir, em feed/carrossel) e, onde o Meta não fornece (Reels), o ALCANCE. Soma do dia = líquido real. É estimativa, não número oficial do Meta.',
  },
  { key: 'watch', label: 'Watch méd.', render: (v) => v == null ? '—' : `${Math.round(v)}s` },
  { key: 'skip', label: 'Skip %', render: (v) => v == null ? '—' : `${v.toFixed(1)}%`, info: 'proxy de hook (quanto menor, melhor)' },
  { key: 'score', label: 'Score', render: (v) => v == null ? '—' : String(Math.round(v)), info: '100 = mediana do grupo (formato); ≥150 = campeão' },
  { key: 'outlier', label: 'Outlier', render: (v) => v == null ? '—' : `${v}×`, info: 'views/dia ÷ mediana do grupo (idade normalizada)' },
]
const METRIC_BY_KEY = new Map(METRIC_COLUMNS.map((c) => [String(c.key), c]))
const DEFAULT_COLS = ['publicadoTs', 'views', 'reach', 'engajamento', 'savesRate', 'sharesRate', 'seguidoresEst', 'score']
const COLS_KEY = 'ig-organico-colunas'

export default function InstagramClient({ serie, cards, netByDate, stories }: {
  serie: Array<{ date: string; views: number; liquido: number; unfollows: number }>
  cards: OrganicCardPost[]
  netByDate: Record<string, number>
  stories: StoryRow[]
}) {
  const rows = useMemo(() => {
    // Atribuição de seguidores AO POST, o mais exato que a API permite:
    // o líquido de seguidores da conta no dia é rateado entre os posts daquele dia.
    // Peso = o MELHOR sinal que TODOS os posts do dia possuem (mesma unidade, sem
    // misturar escalas): profile_visits (sinal exato pré-follow do Meta, feed/
    // carrossel) > alcance > views. Soma por dia = líquido real. Fallback: rateio igual.
    const byDate = new Map<string, OrganicCardPost[]>()
    for (const p of cards) {
      const d = p.published_at.slice(0, 10)
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(p)
    }
    const peso = (p: OrganicCardPost, f: 'pv' | 'reach' | 'views') =>
      Math.max(0, (f === 'pv' ? p.profile_visits : f === 'reach' ? p.reach : p.views) ?? 0)
    const est = new Map<string, number>()
    for (const [d, posts] of byDate) {
      const net = d in netByDate ? netByDate[d] : null
      if (net == null) continue
      const f: 'pv' | 'reach' | 'views' =
        posts.every((p) => p.profile_visits != null) ? 'pv'
          : posts.every((p) => p.reach != null) ? 'reach' : 'views'
      const total = posts.reduce((s, p) => s + peso(p, f), 0)
      for (const p of posts) {
        est.set(p.id, total > 0 ? Math.round(net * (peso(p, f) / total)) : Math.round(net / posts.length))
      }
    }
    return cards.map((p) => {
      const row = toRow(p)
      if (est.has(p.id)) row.seguidoresEst = est.get(p.id)!
      return row
    })
  }, [cards, netByDate])
  const [visiveis, setVisiveis] = useState<string[]>(DEFAULT_COLS)
  const [colsOpen, setColsOpen] = useState(false)

  // Seleção de colunas vira o padrão do usuário (persistida).
  useEffect(() => {
    try {
      const s = localStorage.getItem(COLS_KEY)
      if (s) {
        const arr = (JSON.parse(s) as string[]).filter((k) => METRIC_BY_KEY.has(k))
        if (arr.length) setVisiveis(arr)
      }
    } catch { /* ignore */ }
  }, [])
  function toggleCol(key: string) {
    setVisiveis((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      try { localStorage.setItem(COLS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Colunas finais p/ o DataTable: Post (fixa) + métricas escolhidas (na ordem da régua).
  const columns = useMemo(() => {
    const metric = METRIC_COLUMNS
      .filter((c) => visiveis.includes(String(c.key)))
      .map((c) => ({
        key: c.key, label: c.label, sortable: true, align: 'right' as const,
        width: c.key === 'publicadoTs' ? 140 : 110,
        info: c.info, render: (v: unknown) => c.render(v as number | null),
      }))
    return [POST_COLUMN, ...metric]
  }, [visiveis])

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Views da conta por dia</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} width={48} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="views" name="Views" stroke="#E879F9" fill="#E879F922" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Seguidores líquidos × unfollows por dia</h3>
          <p className="text-[11px] text-gray-600 mb-2">Pico de unfollows no dia seguinte a um post = conteúdo que queima seguidor.</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} width={48} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="liquido" name="Líquido" fill="#34D399" radius={[3, 3, 0, 0]} />
                <Bar dataKey="unfollows" name="Unfollows" fill="#FB7185" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Reels & posts em TABELA — clique no cabeçalho ordena; "Colunas" adiciona métricas */}
      <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-300">Reels &amp; posts</h3>
            <p className="text-[11px] text-gray-600">Clique no nome da coluna para ordenar a tabela · &quot;abrir&quot; vai pro post.</p>
          </div>
          <div className="relative ml-auto">
            <button
              onClick={() => setColsOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#0B1120] border border-[#1F2937] text-gray-300 hover:border-fuchsia-500/40 hover:text-white transition-colors"
            >
              <Columns3 size={13} /> Colunas
              <span className="ml-0.5 px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 text-[10px] tabular-nums">{visiveis.length}</span>
            </button>
            {colsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColsOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-60 max-h-80 overflow-y-auto rounded-md border border-[#1F2937] bg-[#0B1120] shadow-xl p-1">
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500">Métricas (colunas)</p>
                  {METRIC_COLUMNS.map((c) => {
                    const on = visiveis.includes(String(c.key))
                    return (
                      <button
                        key={String(c.key)}
                        onClick={() => toggleCol(String(c.key))}
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left rounded hover:bg-white/[0.04]"
                      >
                        <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center ${on ? 'bg-fuchsia-500 border-fuchsia-500' : 'border-gray-600'}`}>
                          {on && <span className="text-[9px] text-white">✓</span>}
                        </span>
                        <span className={on ? 'text-gray-100' : 'text-gray-400'}>{c.label}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          <span className="text-[11px] text-gray-600">{rows.length} posts</span>
        </div>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={(r) => r.id}
          storageKey="ig-organico-posts"
          pageSize={25}
        />
      </div>

      {/* Stories — funil de navegação por frame */}
      <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Stories (últimos 30 dias)</h3>
        <p className="text-[11px] text-gray-600 mb-3">
          Exit alto = frame queima audiência · Tap-back = releitura (sinal de interesse) · Coleta a cada 3h enquanto vivo + final no webhook.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-[#1F2937]">
                <th className="text-left py-2 pr-3 font-medium">Story</th>
                <th className="text-right py-2 px-3 font-medium">Views</th>
                <th className="text-right py-2 px-3 font-medium">Avançou</th>
                <th className="text-right py-2 px-3 font-medium">Voltou</th>
                <th className="text-right py-2 px-3 font-medium">Saiu</th>
                <th className="text-right py-2 px-3 font-medium">Respostas</th>
                <th className="text-right py-2 pl-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2937]">
              {stories.map((s) => (
                <tr key={s.id} className="hover:bg-white/[0.02]">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2.5">
                      {s.thumb
                        ? // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.thumb} alt="" className="w-8 h-12 rounded object-cover shrink-0" />
                        : <div className="w-8 h-12 rounded bg-white/5 shrink-0" />}
                      <span className="text-gray-300 text-xs whitespace-nowrap">{new Date(s.publicado).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right text-gray-200">{n(s.views)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{n(s.tapsForward)}</td>
                  <td className="py-2 px-3 text-right text-emerald-300/80">{n(s.tapsBack)}</td>
                  <td className="py-2 px-3 text-right text-rose-300/80">{n(s.exits)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{n(s.replies)}</td>
                  <td className="py-2 pl-3 text-right">
                    <span className={`text-[10px] rounded px-1.5 py-0.5 ${s.finalized ? 'bg-white/5 text-gray-400' : 'bg-emerald-500/15 text-emerald-300'}`}>
                      {s.finalized ? 'finalizado' : 'no ar'}
                    </span>
                  </td>
                </tr>
              ))}
              {stories.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-gray-500">Nenhum story coletado ainda — eles aparecem aqui no próximo story publicado após a conexão.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
