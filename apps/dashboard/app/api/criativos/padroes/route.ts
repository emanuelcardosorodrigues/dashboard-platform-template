import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  fetchMetaAds,
  fetchTransacoes,
  fetchFunisConfig,
  getDateRange,
  filterByFunil,
  filterByAccount,
  filterTransacoesByFunil,
} from '@/lib/supabase'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { aggregateCreatives } from '@/lib/creativeAnalysis'

export const dynamic = 'force-dynamic'

interface CorteItem { valor: string; pct: number }
interface PadroesResp {
  total_criativos: number
  top_performers: number
  criterio: string
  cortes: {
    hook_tipo: CorteItem[]
    estrutura_narrativa: CorteItem[]
    tom: CorteItem[]
    duracao_faixa: CorteItem[]
    nivel_consciencia: CorteItem[]
    momento_funil: CorteItem[]
  }
}

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  return sorted[base]
}

function topN(items: string[], n: number, total: number): CorteItem[] {
  const counts = new Map<string, number>()
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1)
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([valor, c]) => ({ valor, pct: total > 0 ? Math.round((c / total) * 100) : 0 }))
}

function duracaoFaixa(seg: number | null): string | null {
  if (seg === null) return null
  if (seg < 15) return '<15s'
  if (seg < 30) return '15-30s'
  if (seg < 45) return '30-45s'
  if (seg < 60) return '45-60s'
  return '>60s'
}

interface CARow {
  ad_id: string | null
  hook_tipo: string[] | string | null
  estrutura_roteiro: unknown
  padroes_detectados: unknown
  nivel_consciencia: string | null
  momento_funil: string | null
}

// "Padrões Campeões" = criativos com MAIOR ROAS (top 20%), respeitando os
// filtros globais do dashboard (de/ate/funil/conta).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const de = sp.get('de') ?? ''
  const ate = sp.get('ate') ?? ''
  const funil = sp.get('funil') ?? 'all'
  const conta = sp.get('conta') ?? 'all'
  const { from, to } = getDateRange(de, ate)

  const [metaAll, transAll, funis] = await Promise.all([fetchMetaAds(), fetchTransacoes(), fetchFunisConfig()])

  let meta = metaAll.filter((m) => (m.impressoes ?? 0) > 0)
  if (from) meta = meta.filter((m) => (m.data ?? '') >= from)
  if (to) meta = meta.filter((m) => (m.data ?? '') <= to)
  meta = filterByFunil(meta, funil, funis)
  meta = filterByAccount(meta, conta)
  if (meta.length === 0) {
    return NextResponse.json({ insuficiente: true, total_criativos: 0, top_performers: 0 })
  }
  let trans = transAll
  if (from) trans = trans.filter((t) => (t.data ?? '') >= from)
  if (to) trans = trans.filter((t) => (t.data ?? '') <= to)
  trans = filterTransacoesByFunil(trans, funil, metaAll, funis)

  const stats = aggregateCreatives(meta, trans)

  const supabase = getClient()
  // Filtro de tenant obrigatório: ad_id vem do Meta e pode colidir entre projetos.
  const workspaceId = await getActiveWorkspaceId()
  const { data: caRows } = await supabase
    .from('criativo_analise')
    .select('ad_id,hook_tipo,estrutura_roteiro,padroes_detectados,nivel_consciencia,momento_funil')
    .eq('workspace_id', workspaceId)
    .not('ad_id', 'is', null)
  const caMap: Record<string, CARow> = {}
  for (const r of (caRows as CARow[] | null) ?? []) if (r.ad_id) caMap[r.ad_id] = r

  interface Row {
    ad_id: string
    roas: number
    vendas: number
    hook_tipo: string[] | null
    estrutura_roteiro: Record<string, unknown> | null
    padroes_detectados: Record<string, unknown> | null
    nivel_consciencia: string | null
    momento_funil: string | null
  }

  const rows: Row[] = stats
    .filter((s) => s.ad_id)
    .map((s) => {
      const ca = caMap[s.ad_id as string]
      let hookTipo: string[] | null = null
      const raw = ca?.hook_tipo
      if (Array.isArray(raw) && raw.length > 0) hookTipo = raw as string[]
      else if (typeof raw === 'string' && raw !== '') hookTipo = raw.split(',').map((x) => x.trim()).filter(Boolean)
      return {
        ad_id: s.ad_id as string,
        roas: s.roas,
        vendas: s.compras,
        hook_tipo: hookTipo,
        estrutura_roteiro: (ca?.estrutura_roteiro as Record<string, unknown> | null) ?? null,
        padroes_detectados: (ca?.padroes_detectados as Record<string, unknown> | null) ?? null,
        nivel_consciencia: ca?.nivel_consciencia ?? null,
        momento_funil: ca?.momento_funil ?? null,
      }
    })

  const total = rows.length
  const comVenda = rows.filter((r) => r.vendas > 0)
  const roasSorted = comVenda.map((r) => r.roas).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const p80Roas = quantile(roasSorted, 0.8)
  const topPerformers = comVenda.filter((r) => p80Roas !== null && r.roas >= p80Roas)

  if (topPerformers.length < 3) {
    return NextResponse.json({ insuficiente: true, total_criativos: total, top_performers: topPerformers.length })
  }

  const hookTipos: string[] = []
  const estruturas: string[] = []
  const tons: string[] = []
  const duracoes: string[] = []
  const niveis: string[] = []
  const momentos: string[] = []

  for (const r of topPerformers) {
    if (r.hook_tipo) for (const h of r.hook_tipo) hookTipos.push(h)
    const narrativa = r.estrutura_roteiro ? (r.estrutura_roteiro['narrativa'] as string | undefined) : undefined
    if (narrativa && typeof narrativa === 'string') estruturas.push(narrativa)
    const tom = r.padroes_detectados ? (r.padroes_detectados['tom'] as string | undefined) : undefined
    if (tom && typeof tom === 'string') tons.push(tom)
    const durSec = r.padroes_detectados ? (r.padroes_detectados['duracao_segundos'] as number | undefined) : undefined
    const faixa = duracaoFaixa(typeof durSec === 'number' ? durSec : null)
    if (faixa) duracoes.push(faixa)
    if (r.nivel_consciencia) niveis.push(r.nivel_consciencia)
    if (r.momento_funil) momentos.push(r.momento_funil)
  }

  const tp = topPerformers.length
  const resp: PadroesResp = {
    total_criativos: total,
    top_performers: tp,
    criterio: 'Maiores ROAS (top 20%)',
    cortes: {
      hook_tipo: topN(hookTipos, 3, hookTipos.length || tp),
      estrutura_narrativa: topN(estruturas, 3, tp),
      tom: topN(tons, 3, tp),
      duracao_faixa: topN(duracoes, 3, tp),
      nivel_consciencia: topN(niveis, 3, tp),
      momento_funil: topN(momentos, 3, tp),
    },
  }

  return NextResponse.json(resp)
}
