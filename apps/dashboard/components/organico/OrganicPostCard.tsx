'use client'

/**
 * Card de conteúdo orgânico — clone estrutural do CriativoCard do pago:
 * thumbnail + chips + 3 BARRAS SEMÁFORO por formato + grid de stats + badge de
 * outlier ("2.4× a mediana do cohort") + expansão com métricas completas.
 * Progressive disclosure: card = decisão; expand = diagnóstico.
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { getOrganicSemaforo, organicFormatKey, type OrganicFormatKey } from '@/lib/thresholds'
import type { SemaforoColor } from '@/types'
import { formatNumber, formatCurrency } from '@/lib/formatters'

export interface OrganicCardPost {
  id: string
  platform: string
  format: string | null
  title: string | null
  caption: string | null
  thumbnail_url: string | null
  permalink: string | null
  published_at: string
  duration_seconds: number | null
  views: number | null
  engaged_views: number | null
  reach: number | null
  likes: number | null
  comments_count: number | null
  shares: number | null
  saves: number | null
  apv: number | null
  avg_watch_time_s: number | null
  completion_rate: number | null
  skip_rate: number | null
  subs_gained: number | null
  profile_visits?: number | null
  impressions: number | null
  impressions_ctr: number | null
  gancho_codigo?: string | null
  estrutura?: string | null
  tema?: string | null
  outlier: number | null
  composite: number | null
  /** Receita atribuída (sck/utm_content × Hotmart). undefined = usuário sem
   *  permissão (campo nem chega ao client); null = sem venda rastreada. */
  receita?: { receita: number; vendas: number } | null
}

const PLATFORM_BADGE: Record<string, { label: string; cls: string }> = {
  youtube: { label: 'YouTube', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  instagram: { label: 'Instagram', cls: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' },
  tiktok: { label: 'TikTok', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
}
const FORMAT_LABEL: Record<string, string> = {
  long: 'Longo', short: 'Short', reel: 'Reel', feed: 'Feed', carousel: 'Carrossel', live: 'Live',
}

const BAR_COLOR: Record<SemaforoColor, string> = {
  green: 'bg-emerald-400', yellow: 'bg-amber-400', red: 'bg-rose-500',
}
const BAR_TEXT: Record<SemaforoColor, string> = {
  green: 'text-emerald-300', yellow: 'text-amber-300', red: 'text-rose-300',
}

interface BarSpec { label: string; metricId: string; value: number | null; display: string }

function pct(v: number | null, dec = 1): string { return v == null ? '—' : `${v.toFixed(dec)}%` }
function rate(num: number | null, den: number | null): number | null {
  if (num == null || den == null || den <= 0) return null
  return (num / den) * 100
}

// ─── Métricas selecionáveis (barras configuráveis + ordenação) ────────────────
// Espelha o padrão da Análise de Criativos (CriativoCard BAR/METRIC_OPTIONS):
// o usuário escolhe QUAIS métricas viram barra no card e por qual ORDENAR.
export type OrganicMetricKey =
  | 'engajamento' | 'saves' | 'shares' | 'follows' | 'comentarios' | 'curtidas'
  | 'watch' | 'skip' | 'views' | 'reach' | 'score' | 'outlier'

interface OrgMetricCfg {
  label: string
  get: (p: OrganicCardPost) => number | null
  fmt: (v: number) => string
  /** Limiares do semáforo da barra. Ausente = métrica só p/ ordenar (sem barra). */
  bar?: { scale: number; green: number; yellow: number; lowerBetter?: boolean }
}

function engRate(p: OrganicCardPost): number | null {
  if (p.views == null || p.views <= 0) return null
  return (((p.likes ?? 0) + (p.comments_count ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / p.views) * 100
}
const numFmt = (v: number) => formatNumber(v)
const pctFmt = (v: number) => `${v.toFixed(v < 1 ? 2 : 1)}%`
const secFmt = (v: number) => `${Math.round(v)}s`

export const ORGANIC_METRICS: Record<OrganicMetricKey, OrgMetricCfg> = {
  engajamento: { label: 'Engajamento', get: (p) => engRate(p), fmt: pctFmt, bar: { scale: 10, green: 6, yellow: 3 } },
  saves: { label: 'Saves / alcance', get: (p) => rate(p.saves, p.reach ?? p.views), fmt: pctFmt, bar: { scale: 1.5, green: 0.7, yellow: 0.3 } },
  shares: { label: 'Shares / alcance', get: (p) => rate(p.shares, p.reach ?? p.views), fmt: pctFmt, bar: { scale: 2, green: 1, yellow: 0.4 } },
  follows: { label: 'Follows / view', get: (p) => rate(p.subs_gained, p.views), fmt: pctFmt, bar: { scale: 0.3, green: 0.1, yellow: 0.03 } },
  comentarios: { label: 'Coment. / view', get: (p) => rate(p.comments_count, p.views), fmt: pctFmt, bar: { scale: 1, green: 0.5, yellow: 0.2 } },
  curtidas: { label: 'Curtidas / view', get: (p) => rate(p.likes, p.views), fmt: pctFmt, bar: { scale: 8, green: 4, yellow: 2 } },
  watch: { label: 'Watch médio', get: (p) => p.avg_watch_time_s, fmt: secFmt, bar: { scale: 30, green: 15, yellow: 8 } },
  skip: { label: 'Skip rate', get: (p) => p.skip_rate, fmt: pctFmt, bar: { scale: 100, green: 25, yellow: 40, lowerBetter: true } },
  views: { label: 'Views', get: (p) => p.views, fmt: numFmt },
  reach: { label: 'Alcance', get: (p) => p.reach, fmt: numFmt },
  score: { label: 'Score composto', get: (p) => p.composite, fmt: (v) => String(Math.round(v)) },
  outlier: { label: 'Outlier (×mediana)', get: (p) => p.outlier, fmt: (v) => `${v}×` },
}

/** Métricas que viram BARRA no card (têm semáforo). Usuário escolhe 1–4. */
export const ORGANIC_BAR_OPTIONS: { key: OrganicMetricKey; label: string }[] =
  (['engajamento', 'saves', 'shares', 'follows', 'comentarios', 'curtidas', 'watch', 'skip'] as OrganicMetricKey[])
    .map((k) => ({ key: k, label: ORGANIC_METRICS[k].label }))
export const DEFAULT_ORGANIC_BARS: OrganicMetricKey[] = ['engajamento', 'saves', 'shares']

/** Opções do seletor "Ordenar por" (barras + absolutos + score/outlier/recentes). */
export const ORGANIC_SORT_OPTIONS: { key: OrganicMetricKey | 'recentes'; label: string }[] = [
  { key: 'score', label: 'Score composto' },
  { key: 'outlier', label: 'Outlier (×mediana)' },
  { key: 'views', label: 'Views' },
  { key: 'reach', label: 'Alcance' },
  { key: 'engajamento', label: 'Engajamento' },
  { key: 'saves', label: 'Saves / alcance' },
  { key: 'shares', label: 'Shares / alcance' },
  { key: 'follows', label: 'Follows / view' },
  { key: 'comentarios', label: 'Comentários / view' },
  { key: 'curtidas', label: 'Curtidas / view' },
  { key: 'watch', label: 'Watch médio' },
  { key: 'recentes', label: 'Mais recentes' },
]

/** Valor numérico p/ ordenação (nulos vão pro fim). */
export function organicSortValue(p: OrganicCardPost, key: OrganicMetricKey): number {
  const v = ORGANIC_METRICS[key].get(p)
  return v == null || !Number.isFinite(v) ? Number.NEGATIVE_INFINITY : v
}

/** Barra de uma métrica escolhida pelo usuário (semáforo próprio via limiares). */
function metricBar(key: OrganicMetricKey, p: OrganicCardPost) {
  const cfg = ORGANIC_METRICS[key]
  const v = cfg.get(p)
  let color: SemaforoColor | null = null
  if (cfg.bar && v != null) {
    const { green, yellow, lowerBetter } = cfg.bar
    color = lowerBetter
      ? (v <= green ? 'green' : v <= yellow ? 'yellow' : 'red')
      : (v >= green ? 'green' : v >= yellow ? 'yellow' : 'red')
  }
  const width = cfg.bar && v != null
    ? Math.min(100, Math.max(6, (v / cfg.bar.scale) * 100))
    : (v != null ? 40 : 0)
  return (
    <div key={key}>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-gray-500">{cfg.label}</span>
        <span className={color ? BAR_TEXT[color] : 'text-gray-400'}>{v == null ? '—' : cfg.fmt(v)}</span>
      </div>
      <div className="h-1.5 rounded bg-white/5 overflow-hidden">
        <div className={`h-full rounded ${color ? BAR_COLOR[color] : 'bg-gray-600'}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

/** As 3 barras de decisão por formato (regra do plano: cada formato tem as suas). */
export function barsForPost(p: OrganicCardPost): BarSpec[] {
  const base = p.reach ?? p.views
  const fk = organicFormatKey(p.platform, p.format)
  if (fk === 'youtube_long') {
    return [
      { label: 'CTR', metricId: 'ctrImpressions', value: p.impressions_ctr, display: pct(p.impressions_ctr) },
      { label: 'APV', metricId: 'apv', value: p.apv, display: pct(p.apv) },
      { label: 'Subs/View', metricId: 'subsPerView', value: rate(p.subs_gained, p.views), display: pct(rate(p.subs_gained, p.views), 2) },
    ]
  }
  if (fk === 'youtube_short') {
    const vvs = rate(p.engaged_views, p.views)
    return [
      { label: 'Viewed×Swiped', metricId: 'viewedVsSwiped', value: vvs, display: pct(vvs) },
      { label: 'APV', metricId: 'apv', value: p.apv, display: pct(p.apv) },
      { label: 'Shares', metricId: 'sharesRate', value: rate(p.shares, p.views), display: pct(rate(p.shares, p.views), 2) },
    ]
  }
  if (fk === 'tiktok') {
    return [
      { label: 'Completion', metricId: 'completionRate', value: p.completion_rate, display: pct(p.completion_rate) },
      { label: 'Shares', metricId: 'sharesRate', value: rate(p.shares, p.views), display: pct(rate(p.shares, p.views), 2) },
      { label: 'Follows', metricId: 'followsRate', value: rate(p.subs_gained, p.views), display: pct(rate(p.subs_gained, p.views), 2) },
    ]
  }
  // reel / feed / carousel
  const eng = p.views != null && p.views > 0
    ? (((p.likes ?? 0) + (p.comments_count ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / p.views) * 100
    : null
  return [
    { label: 'Engaj.', metricId: 'engajamentoRate', value: eng, display: pct(eng) },
    { label: 'Saves', metricId: 'savesRate', value: rate(p.saves, base), display: pct(rate(p.saves, base), 2) },
    { label: 'Shares', metricId: 'sharesRate', value: rate(p.shares, base), display: pct(rate(p.shares, base), 2) },
  ]
}

function semaforoBar(spec: BarSpec, fk: OrganicFormatKey) {
  const color = getOrganicSemaforo(spec.metricId, fk, spec.value)
  const width = spec.value == null ? 0 : Math.min(100, Math.max(6, spec.value * (spec.metricId.includes('Rate') || spec.metricId === 'sharesRate' || spec.metricId === 'savesRate' || spec.metricId === 'subsPerView' || spec.metricId === 'followsRate' ? 40 : 1)))
  return (
    <div key={spec.label}>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-gray-500">{spec.label}</span>
        <span className={color ? BAR_TEXT[color] : 'text-gray-500'}>{spec.display}</span>
      </div>
      <div className="h-1.5 rounded bg-white/5 overflow-hidden">
        <div className={`h-full rounded ${color ? BAR_COLOR[color] : 'bg-gray-600'}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function idade(publishedAt: string): string {
  const dias = Math.floor((Date.now() - new Date(publishedAt).getTime()) / 86400_000)
  if (dias < 1) return 'hoje'
  if (dias < 30) return `há ${dias}d`
  return `há ${Math.floor(dias / 30)}m`
}

export default function OrganicPostCard({ post, bars }: { post: OrganicCardPost; bars?: OrganicMetricKey[] }) {
  const [open, setOpen] = useState(true) // análise aberta por padrão
  const badge = PLATFORM_BADGE[post.platform] ?? PLATFORM_BADGE.youtube
  const fk = organicFormatKey(post.platform, post.format)
  // bars escolhidas pelo usuário (Instagram) têm precedência; senão, as padrão por formato.
  const defaultBars = barsForPost(post)
  const vertical = fk !== 'youtube_long'

  return (
    <div className="rounded-xl border border-[#1F2937] bg-[#111827] overflow-hidden flex flex-col hover:border-[#2b3a52] transition-colors">
      <div className={`relative bg-black/40 ${vertical ? 'aspect-[4/5]' : 'aspect-video'} overflow-hidden`}>
        {post.thumbnail_url
          ? // eslint-disable-next-line @next/next/no-img-element
            <img src={post.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full grid place-items-center text-gray-600 text-xs">sem thumbnail</div>}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
          {post.format && <span className="rounded border border-white/15 bg-black/50 px-1.5 py-0.5 text-[10px] text-gray-200">{FORMAT_LABEL[post.format] ?? post.format}</span>}
        </div>
        {post.outlier != null && (
          <span className={`absolute top-2 right-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
            post.outlier >= 1.5 ? 'bg-emerald-500/90 text-emerald-950' : post.outlier >= 0.7 ? 'bg-black/60 text-gray-200 border border-white/15' : 'bg-rose-500/80 text-rose-50'
          }`} title={`${post.outlier}× a mediana do grupo (views/dia, idade normalizada)`}>
            {post.outlier}×
          </span>
        )}
        <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-gray-300">{idade(post.published_at)}</span>
      </div>

      <div className="p-3 flex flex-col gap-2.5 flex-1">
        <p className="text-xs text-gray-200 leading-snug line-clamp-2 min-h-[2rem]">
          {post.title || post.caption || post.id}
        </p>

        {((post.gancho_codigo && post.gancho_codigo !== 'g00') || post.estrutura || post.tema) && (
          <div className="flex flex-wrap gap-1">
            {post.gancho_codigo && post.gancho_codigo !== 'g00' && <span className="rounded bg-violet-500/15 text-violet-300 border border-violet-500/30 px-1.5 py-0.5 text-[10px]">{post.gancho_codigo}</span>}
            {post.estrutura && <span className="rounded bg-white/5 text-gray-300 border border-white/10 px-1.5 py-0.5 text-[10px]">{post.estrutura}</span>}
            {post.tema && <span className="rounded bg-white/5 text-gray-400 border border-white/10 px-1.5 py-0.5 text-[10px]">{post.tema}</span>}
          </div>
        )}

        <div className="space-y-1.5">
          {bars && bars.length > 0
            ? bars.map((b) => metricBar(b, post))
            : defaultBars.map((b) => semaforoBar(b, fk))}
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-center mt-auto">
          <div className="rounded bg-white/[0.03] py-1.5">
            <p className="text-[13px] font-semibold text-white">{post.views == null ? '—' : formatNumber(post.views)}</p>
            <p className="text-[9px] text-gray-500 uppercase">Views</p>
          </div>
          <div className="rounded bg-white/[0.03] py-1.5">
            <p className="text-[13px] font-semibold text-white">{post.composite == null ? '—' : Math.round(post.composite)}</p>
            <p className="text-[9px] text-gray-500 uppercase" title="100 = mediana do grupo">Score</p>
          </div>
          <div className="rounded bg-white/[0.03] py-1.5">
            <p className="text-[13px] font-semibold text-white">{post.shares == null ? '—' : formatNumber(post.shares)}</p>
            <p className="text-[9px] text-gray-500 uppercase">Shares</p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-[#1F2937]">
          <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white">
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {open ? 'Fechar' : 'Ver análise'}
          </button>
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-white">
              abrir <ExternalLink size={11} />
            </a>
          )}
        </div>

        {open && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] pt-1">
            {([
              ['Alcance', post.reach != null ? formatNumber(post.reach) : '—'],
              ['Likes', post.likes != null ? formatNumber(post.likes) : '—'],
              ['Comentários', post.comments_count != null ? formatNumber(post.comments_count) : '—'],
              ['Saves', post.saves != null ? formatNumber(post.saves) : '—'],
              ['Watch médio', post.avg_watch_time_s != null ? `${Math.round(post.avg_watch_time_s)}s` : '—'],
              ['Skip rate', post.skip_rate != null ? `${post.skip_rate.toFixed(1)}%` : '—'],
              ['Visitas perfil', post.profile_visits != null ? formatNumber(post.profile_visits) : '—'],
              ['Impressões', post.impressions != null ? formatNumber(post.impressions) : '—'],
              ['Inscritos +', post.subs_gained != null ? formatNumber(post.subs_gained) : '—'],
              ['Duração', post.duration_seconds != null ? `${Math.round(post.duration_seconds)}s` : '—'],
              ['Publicado', new Date(post.published_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
              ...(post.receita !== undefined ? ([
                ['Receita atribuída', post.receita ? formatCurrency(post.receita.receita) : '— (sem link rastreado)'],
                ['Vendas', post.receita ? formatNumber(post.receita.vendas) : '—'],
              ] as Array<[string, string]>) : []),
            ] as Array<[string, string]>).filter(([, v]) => v !== '—').map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-gray-500">{k}</span>
                <span className="text-gray-300">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
