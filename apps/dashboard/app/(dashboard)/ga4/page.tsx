export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import KpiCard from '@/components/cards/KpiCard'
import {
  ga4ConfiguredForActive,
  fetchGa4Overview,
  fetchGa4Daily,
  fetchGa4TopSources,
  fetchGa4TopPages,
  fetchGa4ByCampaignId,
  type GA4CampaignRow,
  type GA4PageRow,
} from '@/lib/ga4'
import { fetchMetaAds, fetchTransacoes, tipoDaTransacao, getDateRange, type SbMetaAds, type SbTransacao } from '@/lib/supabase'
import { todayBR } from '@/lib/formatters'

interface SearchParamsShape { de?: string; ate?: string }

export default async function Ga4Page({ searchParams }: { searchParams: Promise<SearchParamsShape> }) {
  const { de = '', ate = '' } = await searchParams

  if (!(await ga4ConfiguredForActive())) {
    return (
      <div className="flex flex-col h-full">
        <Header title="GA4" subtitle="Google Analytics" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-8 text-center text-gray-400 space-y-3">
            <p className="text-lg font-medium text-white">GA4 não configurado</p>
            <div className="text-sm space-y-1">
              <p>Defina <code className="text-amber-300">GA4_PROPERTY_ID</code> (numérico) na Vercel.</p>
              <p>Reusa <code className="text-amber-300">GOOGLE_SERVICE_ACCOUNT_EMAIL</code> + <code className="text-amber-300">GOOGLE_PRIVATE_KEY</code> já configurados pra Sheets.</p>
              <p className="pt-2">No GA4: Admin → Property access → adicione o service account email como <strong>Viewer</strong>.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="GA4" subtitle="Google Analytics" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="h-24 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />}>
          <Ga4Sections de={de} ate={ate} />
        </Suspense>
      </div>
    </div>
  )
}

async function Ga4Sections({ de, ate }: { de: string; ate: string }) {
  const { from, to } = getDateRange(de, ate)
  const today = todayBR()
  // GA4 aceita YYYY-MM-DD. Default últimos 7 dias.
  const startDate = from ?? new Date(Date.now() - 7 * 86400_000 - 3 * 3600_000).toISOString().slice(0, 10)
  const endDate = to ?? today

  const [overviewRes, dailyRes, sourcesRes, pagesRes, campaignRes, metaAdsRes, transacoesRes] = await Promise.allSettled([
    fetchGa4Overview(startDate, endDate),
    fetchGa4Daily(startDate, endDate),
    fetchGa4TopSources(startDate, endDate, 10),
    fetchGa4TopPages(startDate, endDate, 100),
    fetchGa4ByCampaignId(startDate, endDate, 200),
    fetchMetaAds(),
    fetchTransacoes(),
  ])

  if (overviewRes.status === 'rejected') {
    console.error('[GA4] overview fetch failed:', overviewRes.reason)
    return <Ga4Error message="Não foi possível carregar os dados do GA4. Tente novamente em instantes." />
  }
  const overview = overviewRes.value
  const dailyOk = dailyRes.status === 'fulfilled'
  const sourcesOk = sourcesRes.status === 'fulfilled'
  const pagesOk = pagesRes.status === 'fulfilled'
  const campaignOk = campaignRes.status === 'fulfilled'
  const metaAdsOk = metaAdsRes.status === 'fulfilled'
  const transacoesOk = transacoesRes.status === 'fulfilled'
  ;[dailyRes, sourcesRes, pagesRes, campaignRes, metaAdsRes, transacoesRes].forEach((r, i) => {
    if (r.status === 'rejected') {
      const label = ['daily', 'sources', 'pages', 'campaign', 'metaAds', 'transacoes'][i]
      console.error(`[GA4] ${label} fetch failed:`, r.reason)
    }
  })
  const daily = dailyOk ? dailyRes.value : []
  const sources = sourcesOk ? sourcesRes.value : []
  const pages = pagesOk ? pagesRes.value : []
  const ga4Campaigns = campaignOk ? campaignRes.value : []
  const metaAds = metaAdsOk ? metaAdsRes.value : []
  const transacoes = transacoesOk ? transacoesRes.value : []
  const creativos = crossGa4WithMeta(ga4Campaigns, metaAds, startDate, endDate)
  const porPagina = crossPagesWithHotmart(pages, transacoes, startDate, endDate)

  const maxDailySessions = Math.max(1, ...daily.map((d) => d.sessions))

  return (
    <>
      <div className="text-[11px] text-gray-500 tabular-nums">
        Período GA4: {startDate} → {endDate}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Sessões" value={fmtNumber(overview.sessions)} />
        <KpiCard label="Usuários" value={fmtNumber(overview.totalUsers)} />
        <KpiCard label="Sessões Engajadas" value={fmtNumber(overview.engagedSessions)} subtext={`Eng. rate: ${fmtPct(overview.engagementRate)}`} />
        <KpiCard label="Conversões" value={fmtNumber(overview.conversions)} subtext={overview.totalRevenue > 0 ? `Receita: ${fmtBRL(overview.totalRevenue)}` : undefined} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Novos usuários" value={fmtNumber(overview.newUsers)} />
        <KpiCard label="Bounce rate" value={fmtPct(overview.bounceRate)} />
        <KpiCard label="Tempo médio/sessão" value={fmtSec(overview.averageSessionDuration)} />
        <KpiCard label="Sessões/usuário" value={overview.totalUsers > 0 ? (overview.sessions / overview.totalUsers).toFixed(2) : '–'} />
      </div>

      <section className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">Sessões por dia</h2>
          <span className="text-[11px] text-gray-500">{daily.length} dias</span>
        </div>
        {!dailyOk ? (
          <SectionWarning msg="Falha ao carregar sessões por dia. Tente novamente em instantes." />
        ) : daily.length === 0 ? (
          <p className="text-sm text-gray-500">Sem dados no período.</p>
        ) : (
          <div className="grid items-end gap-1 h-32" style={{ gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))` }}>
            {daily.map((d) => {
              const h = (d.sessions / maxDailySessions) * 100
              return (
                <div key={d.date} className="group relative h-full flex items-end">
                  <div className="absolute -top-12 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 bg-gray-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap border border-gray-700">
                    {d.date}<br />Sessões: {fmtNumber(d.sessions)}<br />Usuários: {fmtNumber(d.totalUsers)}<br />Conv: {fmtNumber(d.conversions)}
                  </div>
                  <div className="w-full bg-cyan-500/40 hover:bg-cyan-400/70 transition-colors rounded-t" style={{ height: `${h}%`, minHeight: '2px' }} />
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Top fontes</h2>
        {!sourcesOk ? (
          <SectionWarning msg="Falha ao carregar top fontes. Tente novamente em instantes." />
        ) : sources.length === 0 ? (
          <p className="text-sm text-gray-500">Sem dados de fontes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1F2937] text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="text-left py-2 pr-3 font-semibold">Fonte / Meio</th>
                  <th className="text-right py-2 px-3 font-semibold">Sessões</th>
                  <th className="text-right py-2 px-3 font-semibold">Usuários</th>
                  <th className="text-right py-2 px-3 font-semibold">Conversões</th>
                  <th className="text-right py-2 pl-3 font-semibold">Receita</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s, i) => (
                  <tr key={`${s.source}/${s.medium}/${i}`} className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/30 transition-colors">
                    <td className="py-2 pr-3 text-gray-200">
                      <span className="font-medium">{s.source}</span>
                      <span className="text-gray-500"> / {s.medium}</span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(s.sessions)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(s.totalUsers)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(s.conversions)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-medium text-white">{s.totalRevenue > 0 ? fmtBRL(s.totalRevenue) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">Sessões por criativo Meta</h2>
          <span className="text-[11px] text-gray-500">
            {creativos.length} criativos · joinado por <code className="text-amber-300">utm_id = ad.id</code>
          </span>
        </div>
        {(!campaignOk || !metaAdsOk) ? (
          <SectionWarning msg="Falha ao carregar o cruzamento GA4 × Meta. Tente novamente em instantes." />
        ) : creativos.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nenhum criativo cruzado. Confere se <code className="text-amber-300">utm_id={'{'}{'{'}<span>ad.id</span>{'}'}{'}'}</code> tá no template de URL de TODOS os anúncios Meta.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1F2937] text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="text-left py-2 pr-3 font-semibold">Criativo</th>
                  <th className="text-right py-2 px-3 font-semibold">Meta LPV</th>
                  <th className="text-right py-2 px-3 font-semibold">GA4 Sessões</th>
                  <th className="text-right py-2 px-3 font-semibold" title="GA4 sessões ÷ Meta LPV. Acima de 100% = GA4 vê mais que o Meta paga (bom). Abaixo = perda no caminho (connect rate)">Connect</th>
                  <th className="text-right py-2 px-3 font-semibold">Conv. GA4</th>
                  <th className="text-right py-2 px-3 font-semibold">Compras Meta</th>
                  <th className="text-right py-2 pl-3 font-semibold">Receita Meta</th>
                </tr>
              </thead>
              <tbody>
                {creativos.map((c) => {
                  const ratio = c.metaLpv > 0 ? c.ga4Sessions / c.metaLpv : null
                  const cls = ratio === null ? 'text-gray-500'
                    : ratio >= 0.9 ? 'text-emerald-400'
                    : ratio >= 0.7 ? 'text-amber-400'
                    : 'text-rose-400'
                  return (
                    <tr key={c.adId} className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/30 transition-colors">
                      <td className="py-2 pr-3 text-gray-200 max-w-[280px]">
                        <div className="truncate font-medium" title={c.criativo}>{c.criativo || '(sem nome)'}</div>
                        <div className="font-mono text-[10px] text-gray-500" title={c.adId}>{c.adId}</div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(c.metaLpv)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(c.ga4Sessions)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-medium ${cls}`}>
                        {ratio === null ? '–' : fmtPct(ratio)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(c.ga4Conversions)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(c.metaCompras)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums font-medium text-white">{c.metaReceita > 0 ? fmtBRL(c.metaReceita) : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-500 mt-3">
              <span className="text-emerald-400">≥90%</span> ok · <span className="text-amber-400">70–90%</span> revisar página · <span className="text-rose-400">&lt;70%</span> perda alta (bot, redirect lento, mismatch domínio)
            </p>
          </div>
        )}
      </section>

      {/* Receita & Conversão por página — GA4 sessões (pagePath) × vendas Hotmart (sck), por slug */}
      <section className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">Receita & Conversão por Página</h2>
          <span className="text-[11px] text-gray-500">{porPagina.length} págs · GA4 sessões × Hotmart (slug)</span>
        </div>
        {(!pagesOk || !transacoesOk) ? (
          <SectionWarning msg="Falha ao carregar páginas e/ou vendas Hotmart. Tente novamente em instantes." />
        ) : porPagina.length === 0 ? (
          <p className="text-sm text-gray-500">Sem páginas com vendas no período (join por slug pagePath ↔ sck).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1F2937] text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="text-left py-2 pr-3 font-semibold">Página (slug)</th>
                  <th className="text-right py-2 px-3 font-semibold">Sessões GA4</th>
                  <th className="text-right py-2 px-3 font-semibold">Vendas Front</th>
                  <th className="text-right py-2 px-3 font-semibold" title="Vendas front ÷ sessões GA4">Conv.</th>
                  <th className="text-right py-2 pl-3 font-semibold">Receita</th>
                </tr>
              </thead>
              <tbody>
                {porPagina.map((p) => {
                  const conv = p.sessions > 0 ? (p.frontSales / p.sessions) * 100 : null
                  const cls = conv === null ? 'text-gray-500' : conv >= 2 ? 'text-emerald-400' : conv >= 1 ? 'text-amber-400' : 'text-rose-400'
                  return (
                    <tr key={p.slug} className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/30 transition-colors">
                      <td className="py-2 pr-3 font-mono text-[12px] text-gray-200">{p.slug}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-300">{p.sessions > 0 ? fmtNumber(p.sessions) : '–'}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(p.frontSales)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-medium ${cls}`}>{conv === null ? '–' : `${conv.toFixed(2).replace('.', ',')}%`}</td>
                      <td className="py-2 pl-3 text-right tabular-nums font-medium text-white">{fmtBRL(p.receita)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-500 mt-3">
              Receita/vendas = Hotmart front (por <code className="text-amber-300">sck</code>); sessões = GA4 (<code className="text-amber-300">pagePath</code>); cruzados pelo slug. GA4 não vê a compra (checkout off-domain), por isso o join.
            </p>
          </div>
        )}
      </section>

      <section className="bg-[#111827] border border-[#1F2937] rounded-xl p-6">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Top páginas</h2>
        {!pagesOk ? (
          <SectionWarning msg="Falha ao carregar top páginas. Tente novamente em instantes." />
        ) : pages.length === 0 ? (
          <p className="text-sm text-gray-500">Sem dados de páginas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1F2937] text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="text-left py-2 pr-3 font-semibold">Path</th>
                  <th className="text-left py-2 pr-3 font-semibold">Título</th>
                  <th className="text-right py-2 px-3 font-semibold">Views</th>
                  <th className="text-right py-2 px-3 font-semibold">Usuários</th>
                  <th className="text-right py-2 pl-3 font-semibold">T. médio</th>
                </tr>
              </thead>
              <tbody>
                {pages.slice(0, 12).map((p, i) => (
                  <tr key={`${p.pagePath}/${i}`} className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/30 transition-colors">
                    <td className="py-2 pr-3 font-mono text-[11px] text-gray-400 max-w-[280px] truncate" title={p.pagePath}>{p.pagePath}</td>
                    <td className="py-2 pr-3 text-gray-300 max-w-[300px] truncate" title={p.pageTitle}>{p.pageTitle}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(p.screenPageViews)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtNumber(p.totalUsers)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums text-gray-300">{fmtSec(p.averageSessionDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function Ga4Error({ message }: { message: string }) {
  return (
    <div className="bg-[#111827] border border-red-900/50 rounded-xl p-6 text-center">
      <p className="text-lg font-medium text-rose-400 mb-2">Erro ao consultar GA4</p>
      <p className="text-sm text-gray-400 break-all">{message}</p>
    </div>
  )
}

/** Aviso de falha pontual numa seção (distinto do "sem dados" — a busca falhou, não veio vazia). */
function SectionWarning({ msg }: { msg: string }) {
  return <p className="text-sm text-amber-400">{msg}</p>
}

function fmtNumber(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('pt-BR') : '—'
}

function fmtPct(n: number): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(1).replace('.', ',')}%` : '—'
}

function fmtBRL(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'
}

function fmtSec(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—'
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

interface CreativoCross {
  adId: string
  criativo: string
  ga4Sessions: number
  ga4Conversions: number
  ga4Revenue: number
  metaLpv: number
  metaCliques: number
  metaCompras: number
  metaReceita: number
}

function crossGa4WithMeta(
  ga4: GA4CampaignRow[],
  meta: SbMetaAds[],
  startDate: string,
  endDate: string,
): CreativoCross[] {
  const metaAgg = new Map<string, { criativo: string; lpv: number; cliques: number; compras: number; receita: number }>()
  for (const row of meta) {
    if (!row.ad_id) continue
    if (row.data < startDate || row.data > endDate) continue
    const cur = metaAgg.get(row.ad_id) ?? { criativo: row.ad_name || row.criativo || '', lpv: 0, cliques: 0, compras: 0, receita: 0 }
    cur.lpv += Number(row.landing_views || 0)
    cur.cliques += Number(row.cliques_link || 0)
    cur.compras += Number(row.compras || 0)
    cur.receita += Number(row.valor_compras || 0)
    if (!cur.criativo && (row.ad_name || row.criativo)) cur.criativo = row.ad_name || row.criativo || ''
    metaAgg.set(row.ad_id, cur)
  }

  const ga4Map = new Map(ga4.map((g) => [g.campaignId, g]))
  const allIds = new Set<string>([...metaAgg.keys(), ...ga4Map.keys()])

  const out: CreativoCross[] = []
  for (const adId of allIds) {
    const m = metaAgg.get(adId)
    const g = ga4Map.get(adId)
    if (!m && !g) continue
    if ((m?.lpv ?? 0) < 1 && (g?.sessions ?? 0) < 1) continue
    out.push({
      adId,
      criativo: m?.criativo ?? '',
      ga4Sessions: g?.sessions ?? 0,
      ga4Conversions: g?.conversions ?? 0,
      ga4Revenue: g?.totalRevenue ?? 0,
      metaLpv: m?.lpv ?? 0,
      metaCliques: m?.cliques ?? 0,
      metaCompras: m?.compras ?? 0,
      metaReceita: m?.receita ?? 0,
    })
  }
  out.sort((a, b) => Math.max(b.metaLpv, b.ga4Sessions) - Math.max(a.metaLpv, a.ga4Sessions))
  return out.slice(0, 50)
}

// ── Receita & Conversão por página (Fase 7) ────────────────────────────────
// GA4 não enxerga a compra (checkout off-domain na Hotmart), então cruzamos as
// sessões do GA4 (por pagePath) com as vendas front da Hotmart (por sck), via slug.
function pageSlug(path: string): string {
  const clean = (path || '').split('?')[0].split('#')[0]
  const segs = clean.split('/').filter(Boolean)
  return (segs[segs.length - 1] || '').toLowerCase()
}
function sckSlug(sck: string): string {
  // "col-pv02" ou composto "col-pv02_ckck01_obob02" → 1º segmento (o hífen faz parte do slug).
  return (sck || '').split('_')[0].trim().toLowerCase()
}

interface PaginaCross { slug: string; sessions: number; frontSales: number; receita: number }

function crossPagesWithHotmart(pages: GA4PageRow[], transacoes: SbTransacao[], startDate: string, endDate: string): PaginaCross[] {
  const sessBySlug = new Map<string, number>()
  for (const p of pages) {
    const s = pageSlug(p.pagePath)
    if (!s) continue
    sessBySlug.set(s, (sessBySlug.get(s) ?? 0) + p.sessions)
  }
  const hot = new Map<string, { frontSales: number; receita: number }>()
  for (const t of transacoes) {
    if ((t.valor_bruto || 0) <= 1) continue
    const d = (t.data || '').slice(0, 10)
    if (d < startDate || d > endDate) continue
    if (tipoDaTransacao(t) !== 'frontEnd') continue
    const s = sckSlug(t.sck_slug || '')
    if (!s) continue
    const cur = hot.get(s) ?? { frontSales: 0, receita: 0 }
    cur.frontSales += 1
    cur.receita += t.valor_bruto || 0
    hot.set(s, cur)
  }
  const out: PaginaCross[] = []
  for (const [slug, v] of hot) {
    out.push({ slug, sessions: sessBySlug.get(slug) ?? 0, frontSales: v.frontSales, receita: v.receita })
  }
  out.sort((a, b) => b.receita - a.receita)
  return out
}
