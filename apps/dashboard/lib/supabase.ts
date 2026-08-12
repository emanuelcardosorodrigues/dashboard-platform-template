import { createClient } from '@supabase/supabase-js'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { getActiveWorkspaceId } from './workspace-context'
import {
  DEFAULT_FUNIS, resolverFunil as resolverFunilCfg, resolverFunilPorTokens,
  classificarProduto, temToken, type FunilConfig,
} from './funisConfig'

function getClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

const PAGE_SIZE = 1000

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SbTransacao {
  hotmart_id: string
  data: string | null
  hora_compra?: string | null
  created_at?: string | null
  nome: string
  email: string
  produto: string
  /**
   * ID Hotmart do produto (migration 0067) — chave estável da classificação.
   * NULL no histórico anterior ao backfill e quando a origem não informa.
   */
  produto_id?: string | null
  valor_bruto: number
  // #20 — NULL quando commissions ausente no payload (dado DESCONHECIDO, não zero).
  // Requer migration 0049 se a coluna for NOT NULL no banco.
  valor_liquido_expert: number | null
  forma_pagamento: string
  parcelas: number
  criativo: string
  ad_id?: string | null
  criativo_primeiro?: string | null
  ad_id_primeiro?: string | null
  utm_medium_ultimo: string
  utm_source_ultimo: string
  utm_medium_primeiro: string
  utm_source_primeiro: string
  // ── migration 0068: pacote de origem completo. Vazio no histórico anterior —
  // o sck já trazia esses valores, mas não havia coluna e eles eram descartados.
  utm_campaign_ultimo?: string | null
  utm_content_ultimo?: string | null
  utm_term_ultimo?: string | null
  utm_placement_ultimo?: string | null
  utm_campaign_primeiro?: string | null
  utm_content_primeiro?: string | null
  utm_term_primeiro?: string | null
  utm_placement_primeiro?: string | null
  /** sck cru, para reprocessar sem depender do mapeamento vigente. */
  sck_raw?: string | null
  /** todo parâmetro recebido, inclusive os que ainda não têm coluna dedicada. */
  utms?: Record<string, string> | null
  sck_slug?: string
  status?: string | null // 'approved' (default) | 'refunded'|'chargeback'|'protest'|'canceled'
}

// Status de transação que NÃO contam como receita (estorno/cancelamento).
export const REFUND_STATUSES = new Set(['refunded', 'chargeback', 'protest', 'canceled'])

/** #14 — dia seguinte (YYYY-MM-DD). Boundary de fim de dia deve ser EXCLUSIVO
 *  no dia seguinte (`< diaSeguinte T00:00`): `<= T23:59:59` trunca em segundos
 *  e exclui eventos dos 999ms finais do dia (timestamptz tem precisão de ms). */
export function diaSeguinteYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export interface SbMetaAds {
  data: string
  criativo: string
  ad_name: string
  ad_id: string
  account_id?: string
  campaign_name: string
  adset_name: string
  investimento: number
  impressoes: number
  alcance: number
  views_3seg: number
  views_75pct?: number
  views_95pct: number
  cliques_link: number
  landing_views: number
  checkouts: number
  compras: number
  valor_compras: number
  /** actions:comment do Meta. NULL = dia sincronizado antes da coluna existir (≠ zero). */
  comentarios?: number | null
  preview_url: string | null
  // Fase 8 — controle Meta (populados pelo sync-meta após migration 0020)
  campaign_id?: string | null
  adset_id?: string | null
  status?: string | null               // effective_status real do Meta (ACTIVE/PAUSED/...)
  daily_budget_cents?: number | null
  lifetime_budget_cents?: number | null
  campaign_daily_budget_cents?: number | null
}

export interface SbQualificacao {
  email: string
  nome: string
  aluno_mentoria?: boolean
  // Flags de compra denormalizadas na ficha (alvos de conversão p/ Lead Scoring).
  // aluno_mentoria = comprou o Programa Demonstrativo (vendido por fora, marcado na ficha).
  comprou_calculadora?: boolean
  comprou_ob1_script?: boolean
  comprou_ob2_tributario?: boolean
  comprou_ob3_dentista?: boolean
  valor_sonho?: string
  voce_e?: string
  qualificacao?: string
  criativo?: string
  data_primeira_compra?: string | null
  valor_bruto_total?: number | null
  whatsapp: string
  sexo: string
  faixa_etaria: string
  estado_civil: string
  tem_filhos: string
  tipo_clinica: string
  faturamento_declarado: string
  num_cadeiras: string
  tempo_odontologia: string
  especialidade: string
  como_conheceu: string
  maior_dificuldade: string
  medos: string
  objetivos: string
  o_que_falta: string
  unica_coisa_incomoda: string
  motivo_compra: string
  o_que_impediu: string
  instagram: string
  tentou_antes: string
  funcionou: string
  por_que_nao_funcionou: string
  emocao_fim_mes: string
  valor_sonho_mensal: string
  quanto_sobra: string
  tem_socio: string
  cpf_cnpj: string
  tem_ficha: boolean
}

export type ClarityRecorte = 'total' | 'url' | 'device' | 'source'

export interface SbClarityDaily {
  data: string
  recorte: ClarityRecorte
  dimensao_valor: string
  sessions: number | null
  pages_per_session: number | null
  total_pageviews: number | null
  scroll_depth_pct: number | null
  engagement_time_sec: number | null
  dead_clicks: number | null
  rage_clicks: number | null
  quick_backs: number | null
  excessive_scroll: number | null
  script_errors: number | null
  error_clicks: number | null
  raw_json: unknown
  synced_at: string
}

export interface AiInsightItem {
  titulo: string
  severidade?: 'alta' | 'media' | 'baixa'
  metrica?: string
  descricao: string
}

export interface SbAiInsight {
  id: string
  data: string
  periodo: 'daily' | 'weekly' | 'custom'
  periodo_from?: string | null
  periodo_to?: string | null
  modelo: string
  prompt_version: string
  tldr: string | null
  alertas: AiInsightItem[] | null
  oportunidades: AiInsightItem[] | null
  recomendacoes: AiInsightItem[] | null
  metricas_contexto: unknown
  tokens_input: number | null
  tokens_output: number | null
  custo_usd: number | null
  gerado_at: string
  gerado_por: 'cron' | 'manual'
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchAllRows<T>(table: 'transacoes' | 'meta_ads' | 'qualificacao', workspaceId: string, orderColumn?: string): Promise<T[]> {
  const __t0 = Date.now()
  const client = getClient()
  const rows: T[] = []
  let from = 0

  while (true) {
    let query = client.from(table).select('*').eq('workspace_id', workspaceId).range(from, from + PAGE_SIZE - 1)

    if (orderColumn) {
      query = query.order(orderColumn, { ascending: true })
    }

    const { data, error } = await query

    if (error) {
      console.error(`[supabase] ${table}:`, error.message)
      return []
    }

    const chunk = (data ?? []) as T[]
    rows.push(...chunk)

    if (chunk.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  // Telemetria (Fase 0): só roda em cache MISS — o unstable_cache abaixo serve
  // o resto do tempo. Permite comparar baseline vs depois e confirmar hit/miss.
  console.log(`[supabase] fetchAllRows ${table}: ${rows.length} linhas em ${Date.now() - __t0}ms (cache miss)`)
  return rows
}

// ── Camada de cache (Fase 1 — performance) ──────────────────────────────────
// Estratégia: cachear o FETCH CRU das tabelas (chave SEM filtros) entre requests
// via unstable_cache; o filtro por data/funil/conta segue 100% em JS por request
// (microssegundos em ~1.9k linhas), então o mesmo blob cacheado serve toda conta
// com segurança (nenhum dado de conta/cookie entra na chave do cache).
//   • unstable_cache  → persiste entre requests/deploys, invalidável por tag.
//   • cache() (react) → dedup dentro de UM render (várias seções Suspense).
// Refresh imediato: revalidateTag(tag, { expire: 0 }) (ver app/api/revalidate +
// app/actions/syncMeta) — força cache miss bloqueante no próximo render.
// fetchedAt é capturado no momento do MISS → alimenta o indicador "atualizado às".
const REVALIDATE_HOT = 300   // 5 min — meta/transações (frescor pedido pelo usuário)
const REVALIDATE_WARM = 600  // 10 min — qualificação/config (mudam pouco)

// Multi-tenant: workspaceId é o 1º argumento E entra na chave do unstable_cache
// (chaveado por argumento) → cada projeto tem seu próprio blob, sem vazamento.
// O fetcher público resolve o workspace ativo e passa pra cá (nunca o contrário:
// resolução de workspace é request-scoped e não pode rodar dentro do cache).
const _transacoesCore = unstable_cache(
  async (workspaceId: string): Promise<{ rows: SbTransacao[]; fetchedAt: string }> => {
    const all = await fetchAllRows<SbTransacao>('transacoes', workspaceId, 'data')
    // Exclui estornos/cancelamentos de TODOS os agregados num ponto só. Defensivo:
    // se a coluna `status` não existe (migration não rodada), status vem undefined
    // e nada é filtrado — não quebra.
    const rows = all.filter((r) => !REFUND_STATUSES.has((r.status ?? '').toLowerCase()))
    return { rows, fetchedAt: new Date().toISOString() }
  },
  ['sb-transacoes-core-v3'],
  { tags: ['sb-transacoes'], revalidate: REVALIDATE_HOT },
)

const _metaAdsCore = unstable_cache(
  async (workspaceId: string): Promise<{ rows: SbMetaAds[]; fetchedAt: string }> => ({
    rows: await fetchAllRows<SbMetaAds>('meta_ads', workspaceId, 'data'),
    fetchedAt: new Date().toISOString(),
  }),
  ['sb-meta-ads-core-v2'],
  { tags: ['sb-meta-ads'], revalidate: REVALIDATE_HOT },
)

const _qualificacaoCore = unstable_cache(
  async (workspaceId: string): Promise<SbQualificacao[]> => fetchAllRows<SbQualificacao>('qualificacao', workspaceId),
  ['sb-qualificacao-core-v2'],
  { tags: ['sb-qualificacao'], revalidate: REVALIDATE_WARM },
)

const _configCore = unstable_cache(
  async (workspaceId: string): Promise<Record<string, string>> => {
    const client = getClient()
    const { data, error } = await client.from('config').select('chave, valor').eq('workspace_id', workspaceId)
    if (error) { console.error('[supabase] config:', error.message); return {} }
    const out: Record<string, string> = {}
    ;(data ?? []).forEach((row: { chave: string; valor: string }) => { out[row.chave] = row.valor })
    return out
  },
  // v2: v1 era cache GLOBAL (sem workspace) — envenenava config entre tenants.
  // O workspaceId agora entra como argumento → unstable_cache particiona por tenant.
  ['sb-config-core-v2'],
  { tags: ['sb-config'], revalidate: REVALIDATE_WARM },
)

// Os fetchers públicos resolvem o workspace ativo (DEMO na Onda 1/2; sessão na
// Onda 3) e passam pro core cacheado. `wsId?` opcional permite que crons/contextos
// sem cookie alvejem um workspace específico (fan-out na Onda 5).
export const fetchTransacoes = cache(async (wsId?: string): Promise<SbTransacao[]> =>
  (await _transacoesCore(wsId ?? await getActiveWorkspaceId())).rows)
export const fetchMetaAds = cache(async (wsId?: string): Promise<SbMetaAds[]> =>
  (await _metaAdsCore(wsId ?? await getActiveWorkspaceId())).rows)
export const fetchQualificacao = cache(async (wsId?: string): Promise<SbQualificacao[]> =>
  _qualificacaoCore(wsId ?? await getActiveWorkspaceId()))
export const fetchConfig = cache(async (wsId?: string): Promise<Record<string, string>> =>
  _configCore(wsId ?? await getActiveWorkspaceId()))

// ── Lead Scoring: config por funil ───────────────────────────────────────────
// Fallback gracioso: se a migration não foi aplicada (tabela ausente), retorna []
// e a aba cai nos defaults — não quebra o deploy antes do SQL ser colado.
export interface SbLeadScoreConfig {
  funil: string
  weights: Record<string, Record<string, number>>
  tier_quente: number
  tier_morno: number
  alvo_coluna: string
}

const _leadScoreConfigCore = unstable_cache(
  async (workspaceId: string): Promise<SbLeadScoreConfig[]> => {
    const client = getClient()
    const { data, error } = await client.from('lead_score_config').select('*').eq('workspace_id', workspaceId)
    if (error) return []
    return (data ?? []) as SbLeadScoreConfig[]
  },
  ['sb-lead-score-config-v2'],
  { tags: ['sb-lead-score-config'], revalidate: 60 },
)
export const fetchLeadScoreConfigs = cache(async (wsId?: string): Promise<SbLeadScoreConfig[]> =>
  _leadScoreConfigCore(wsId ?? await getActiveWorkspaceId()))

// ── Funis configuráveis (admin) ───────────────────────────────────────────────
// Fallback gracioso: tabela ausente/vazia/erro → DEFAULT_FUNIS (= régua antiga).
interface SbFunilRow {
  slug: string; nome: string; ordem: number; ativo: boolean; cor: string | null
  produtos: unknown; campanhas: unknown
}
const _funisConfigCore = unstable_cache(
  async (workspaceId: string): Promise<FunilConfig[]> => {
    const client = getClient()
    const { data, error } = await client.from('funis').select('*').eq('workspace_id', workspaceId).order('ordem')
    const rows = (data ?? []) as SbFunilRow[]
    if (error || rows.length === 0) return DEFAULT_FUNIS
    return rows.map((r) => ({
      slug: r.slug, nome: r.nome, ordem: r.ordem, ativo: r.ativo !== false, cor: r.cor ?? undefined,
      produtos: Array.isArray(r.produtos) ? r.produtos : [],
      campanhas: (r.campanhas && typeof r.campanhas === 'object')
        ? r.campanhas
        : { habilitado: true, tokens: [], campos: ['ad_name', 'sck', 'campaign_name'] },
    })) as FunilConfig[]
  },
  ['sb-funis-v1'],
  { tags: ['sb-funis'], revalidate: 300 },
)
export const fetchFunisConfig = cache(async (wsId?: string): Promise<FunilConfig[]> =>
  _funisConfigCore(wsId ?? await getActiveWorkspaceId()))

/**
 * Horário (ISO) em que os dados do dashboard foram efetivamente buscados do
 * Supabase (momento do último cache MISS de meta_ads). Alimenta o indicador
 * "atualizado às HH:MM". Compartilha o MESMO objeto cacheado de fetchMetaAds,
 * então não dispara fetch extra.
 */
export const fetchDataFreshness = cache(async (): Promise<string> => (await _metaAdsCore(await getActiveWorkspaceId())).fetchedAt)

/**
 * Data MAIS RECENTE de cada fonte sincronizada (não "quando o cache encheu", mas
 * "até quando vão os dados"). Detecta SYNC MORTO — ex: cron do Meta parado deixa
 * o último dia defasado. Reusa os cores cacheados (sem fetch extra).
 */
export const fetchDataStaleness = cache(async (): Promise<{ metaAds: string | null; transacoes: string | null }> => {
  try {
    const wsId = await getActiveWorkspaceId()
    const [meta, trans] = await Promise.all([_metaAdsCore(wsId), _transacoesCore(wsId)])
    const maxOf = (rows: Array<{ data?: string | null }>) =>
      rows.reduce((m, r) => { const d = (r.data || '').slice(0, 10); return d > m ? d : m }, '')
    return { metaAds: maxOf(meta.rows) || null, transacoes: maxOf(trans.rows) || null }
  } catch { return { metaAds: null, transacoes: null } }
})

// ── vTurb por criativo (Fase 4 / Tier B) ────────────────────────────────────
// Fallback gracioso: se a migration 0019 não foi aplicada (tabela ausente) ou não
// há dados ainda, retorna [] e o dashboard segue sem as colunas VSL.
export interface SbVturbCreativeDaily {
  player_id: string
  day: string
  match_key: string
  match_kind: 'utm_id' | 'utm_content'
  total_viewed: number
  total_started: number
  total_finished: number
  total_clicked: number
  total_conversions: number
  total_over_pitch: number
  total_under_pitch: number
  total_first_minute?: number // usuários que alcançaram >= 60s (retenção por tempo por criativo)
}

const _vturbCreativeDaily = unstable_cache(
  async (workspaceId: string, from: string, to: string): Promise<SbVturbCreativeDaily[]> => {
    const client = getClient()
    let q = client.from('vturb_creative_daily').select('*').eq('workspace_id', workspaceId)
    if (from) q = q.gte('day', from)
    if (to) q = q.lte('day', to)
    const { data, error } = await q
    if (error) return []
    return (data ?? []) as SbVturbCreativeDaily[]
  },
  ['sb-vturb-creative-daily-v2'],
  { tags: ['sb-vturb'], revalidate: 300 },
)
export const fetchVturbCreativeDaily = cache(async (from: string, to: string) =>
  _vturbCreativeDaily(await getActiveWorkspaceId(), from, to))

export interface SbVslPlayerMap {
  funil: string
  papel: 'principal' | 'upsell' | 'downsell' | 'order_bump'
  player_id: string
  is_default: boolean
}
const _vslPlayerMap = unstable_cache(
  async (workspaceId: string): Promise<SbVslPlayerMap[]> => {
    const client = getClient()
    const { data, error } = await client.from('vsl_player_map').select('funil, papel, player_id, is_default').eq('workspace_id', workspaceId)
    if (error) return []
    return (data ?? []) as SbVslPlayerMap[]
  },
  ['sb-vsl-player-map-v2'],
  { tags: ['sb-vturb'], revalidate: 600 },
)
export const fetchVslPlayerMap = cache(async () => _vslPlayerMap(await getActiveWorkspaceId()))

export const fetchClarityDaily = cache(async (data: string): Promise<SbClarityDaily[]> => {
  const client = getClient()
  const { data: rows, error } = await client.from('clarity_daily').select('*').eq('workspace_id', await getActiveWorkspaceId()).eq('data', data)
  if (error) { console.error('[supabase] clarity_daily:', error.message); return [] }
  return (rows ?? []) as SbClarityDaily[]
})

export const fetchClarityDailyRange = cache(async (from: string, to: string): Promise<SbClarityDaily[]> => {
  const client = getClient()
  const { data: rows, error } = await client
    .from('clarity_daily')
    .select('*')
    .eq('workspace_id', await getActiveWorkspaceId())
    .gte('data', from)
    .lte('data', to)
    .order('data', { ascending: false })
  if (error) { console.error('[supabase] clarity_daily range:', error.message); return [] }
  return (rows ?? []) as SbClarityDaily[]
})

export const fetchLatestAiInsight = cache(async (data: string): Promise<SbAiInsight | null> => {
  const client = getClient()
  const { data: row, error } = await client
    .from('ai_insights')
    .select('*')
    .eq('workspace_id', await getActiveWorkspaceId())
    .eq('data', data)
    .order('gerado_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) { console.error('[supabase] ai_insights:', error.message); return null }
  return (row as SbAiInsight | null) ?? null
})

/**
 * Busca o insight mais recente que cubra exatamente o período [from, to]
 * (match por periodo_from + periodo_to). Se não houver, faz fallback para o
 * insight diário (data=to) — útil enquanto a migration de periodo_from/to
 * ainda não tiver sido aplicada.
 */
export const fetchLatestAiInsightForRange = cache(async (from: string, to: string): Promise<SbAiInsight | null> => {
  const client = getClient()
  const wsId = await getActiveWorkspaceId()
  const exact = await client
    .from('ai_insights')
    .select('*')
    .eq('workspace_id', wsId)
    .eq('periodo_from', from)
    .eq('periodo_to', to)
    .order('gerado_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (exact.data) return exact.data as SbAiInsight
  // Fallback: insight diário do último dia do range.
  const fb = await client
    .from('ai_insights')
    .select('*')
    .eq('workspace_id', wsId)
    .eq('data', to)
    .order('gerado_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (fb.error) {
    if (exact.error && exact.error.code !== '42703') {
      console.error('[supabase] ai_insights range:', exact.error.message)
    }
    return null
  }
  return (fb.data as SbAiInsight | null) ?? null
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getDateRange(de: string, ate: string): { from: string | null; to: string | null } {
  return {
    from: de || null,
    to: ate || null,
  }
}

export type ProdutoTipo = 'frontEnd' | 'ob1' | 'ob2' | 'ob3' | 'ob4' | 'upsell' | 'downsell'

/**
 * Regras de classificação de produto, ordenadas do MAIS específico → MAIS genérico.
 * Cada regra recebe (produto_lowercased, isDpl) e retorna o tipo ou null.
 *
 * REGRA DE NEGÓCIO: CPA usa apenas vendas frontEnd. Order Bumps (OB1-OB4), upsell e
 * downsell NUNCA contam pra CPA — são vendas adicionais pós-front.
 *
 * Upsell e downsell são vendidos no funil pós-compra da Hotmart e geralmente NÃO
 * carregam UTM (sem `criativo`). Por isso o filtro de funil tem fallback adicional
 * via `produtoToFunil` (abaixo).
 *
 * Match por substring ambígua é PROIBIDO — "protocolo" colide entre PLO (front) e DPL (OB3),
 * "oculto" colide entre Protocolo Lucro Oculto (front) e Manual Lucro Oculto (OB4).
 */
const PRODUTO_RULES: ReadonlyArray<{ test: (p: string, isDpl: boolean) => boolean; tipo: ProdutoTipo }> = [
  // 1. Upsell/downsell PLO — DOWNSELL primeiro (mais específico, contém "express")
  { test: (p) => /implementa.*express.*lucro.*oculto/.test(p), tipo: 'downsell' },
  { test: (p) => /implementa.*lucro.*oculto/.test(p), tipo: 'upsell' },

  // 2. Front-ends nomeados — específicos primeiro
  { test: (p) => /produto.*demonstrativo/.test(p), tipo: 'frontEnd' },
  // Imersão Lucro Clínico — front do funil LPS
  { test: (p) => /imers.*lucro.*cl[ií]nico/.test(p), tipo: 'frontEnd' },
  // Protocolo Lucro Oculto: front PLO/COL. Exclui Manual Lucro Oculto que tem "lucro oculto" no nome.
  { test: (p) => /protocolo.*lucro.*oculto/.test(p) && !/manual/.test(p), tipo: 'frontEnd' },

  // 3. Protocolo Dentista Parceiro: front em DPL, OB3 nos demais funis
  { test: (p, isDpl) => /protocolo.*(dentista|parceiro)/.test(p) && isDpl, tipo: 'frontEnd' },
  { test: (p) => /protocolo.*(dentista|parceiro)/.test(p), tipo: 'ob3' },

  // 4. Order bumps por nome explícito
  { test: (p) => /script.*anti.*desconto/.test(p), tipo: 'ob1' },
  { test: (p) => /(lucro )?tribut/.test(p), tipo: 'ob2' },
  { test: (p) => /manual.*lucro.*oculto/.test(p), tipo: 'ob4' },
]

/**
 * Classifica um produto Hotmart em frontEnd / OB1..OB4 / upsell / downsell.
 * Fallback: produto desconhecido vira frontEnd (conservador: prefere inflar CPA do que zerar) + warn em dev.
 */
export function produtoToTipo(
  produto: string,
  criativo = '',
  funis: FunilConfig[] = DEFAULT_FUNIS,
  produtoId = '',
): ProdutoTipo {
  // Resolve o funil (por token/produto) e classifica o produto no PAPEL daquele funil.
  // Config-driven (lib/funisConfig); DEFAULT_FUNIS reproduz a régua antiga.
  // `produtoId` (transacoes.produto_id, migration 0067) é o que faz as regras
  // `por:'id'` funcionarem — sem ele só as regras por nome casam.
  const slug = resolverFunilCfg({ produto, criativo, produtoId }, funis)
  return classificarProduto(produto, slug, funis, produtoId) as ProdutoTipo
}

/**
 * Classifica a transação inteira — forma PREFERIDA sobre `produtoToTipo(nome, criativo)`.
 * Carrega o `produto_id` junto, que é o que faz as regras `por:'id'` casarem; chamar
 * a versão por nome numa linha que TEM id é o jeito de reintroduzir o bug do rename.
 */
export function tipoDaTransacao(
  t: { produto?: string | null; criativo?: string | null; produto_id?: string | null },
  funis: FunilConfig[] = DEFAULT_FUNIS,
): ProdutoTipo {
  return produtoToTipo(t.produto || '', t.criativo || '', funis, t.produto_id || '')
}

/** Funis canônicos do negócio. */
export type Funil = 'col' | 'plo' | 'dpl' | 'lps'
const FUNIS: readonly Funil[] = ['col', 'plo', 'dpl', 'lps']

/** Normaliza o valor do dropdown ('col-', 'plo', 'lps-') para o slug do funil. '' / 'all' / desconhecido → null. */
export function normalizeFunil(funil: string, funis: FunilConfig[] = DEFAULT_FUNIS): string | null {
  const slug = (funil || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!slug || slug === 'all') return null
  return funis.some((f) => f.slug === slug && f.ativo !== false) ? slug : null
}

/** True se a string carrega o token do funil como palavra delimitada (evita 'protoCOLo' casar 'col'). */
function hasFunilToken(s: string, slug: Funil): boolean {
  return new RegExp(`(?:^|[^a-z])${slug}(?:[^a-z]|$)`).test((s || '').toLowerCase())
}

/** Detecta o funil embutido num criativo/sck/campanha ('demo-col-vid', 'col-pv07', 'COL - Teste'). */
export function detectFunil(s: string): Funil | null {
  for (const f of FUNIS) if (hasFunilToken(s, f)) return f
  return null
}

/**
 * Mapeia um produto Hotmart ao funil canônico quando o nome do produto carrega o
 * funil de origem. Usado como ÚLTIMO recurso em resolveFunil (depois de criativo/sck/
 * campanha/email). Order bumps "geral COL" caem em 'col'; quando vendidos em outro
 * funil, o sinal de criativo/sck/email vence antes de chegar aqui.
 *
 * Retorna null quando o nome não amarra a nenhum funil.
 */
export function produtoToFunil(produto: string, criativo = ''): Funil | null {
  const p = (produto || '').toLowerCase()
  const isDpl = /dpl[_-]/.test((criativo || '').toLowerCase())
  // Produtos com funil FIXO: front-ends + upsell/downsell específicos.
  if (/protocolo.*lucro.*oculto/.test(p) && !/manual/.test(p)) return 'plo'   // PLO front
  if (/implementa.*lucro.*oculto/.test(p)) return 'plo'                        // PLO upsell/downsell
  if (/imers.*lucro.*cl[ií]nico/.test(p)) return 'lps'                         // LPS front
  if (/produto.*demonstrativo/.test(p)) return 'col'                              // COL front
  if (/protocolo.*(dentista|parceiro)/.test(p) && isDpl) return 'dpl'          // DPL front (só com criativo dpl)
  // Order bumps ambíguos (Dentista sem dpl, Script, Tributário, Manual) → null aqui;
  // resolvidos por email/compra e, em último caso, default COL (ver produtoBumpDefault).
  return null
}

/**
 * Default de funil pros order bumps "geral COL" (Script, Tributário, Manual, Dentista sem dpl).
 * Usado como ÚLTIMO recurso em resolveFunil — depois de criativo/sck/campanha/produto-fixo/email.
 */
function produtoBumpDefault(produto: string, criativo = ''): Funil | null {
  const p = (produto || '').toLowerCase()
  const isDpl = /dpl[_-]/.test((criativo || '').toLowerCase())
  if (/script.*anti.*desconto/.test(p)) return 'col'
  if (/(lucro )?tribut/.test(p)) return 'col'
  if (/manual.*lucro.*oculto/.test(p)) return 'col'
  if (/protocolo.*(dentista|parceiro)/.test(p) && !isDpl) return 'col'
  return null
}

/** Filtra linhas do meta_ads pelo account_id. 'all' ou vazio retorna tudo. */
export function filterByAccount<T extends { account_id?: string }>(rows: T[], conta: string): T[] {
  if (!conta || conta === 'all') return rows
  return rows.filter((r) => r.account_id === conta)
}

/** Filtra linhas do meta_ads (gasto) pelo funil, via tokens de campanha da config. */
export function filterByFunil<T extends { campaign_name: string; ad_name?: string }>(rows: T[], funil: string, funis: FunilConfig[] = DEFAULT_FUNIS): T[] {
  const slug = normalizeFunil(funil, funis)
  if (!slug) return rows
  const camp = funis.find((f) => f.slug === slug)?.campanhas
  if (!camp?.habilitado) return []  // funil sem mapeamento de campanha → nenhum gasto atribuído
  const tokens = camp.tokens || []
  const campos = camp.campos || []
  return rows.filter((r) =>
    tokens.some((tk) =>
      (campos.includes('campaign_name') && temToken(r.campaign_name || '', tk)) ||
      (campos.includes('ad_name') && temToken(r.ad_name || '', tk)),
    ),
  )
}

const emailKeyOf = (email?: string | null) => (email || '').toLowerCase().trim()

/**
 * Resolve o funil de UMA transação por prioridade de sinal (forte → fraco):
 *   1. token no `criativo` (ad_name)
 *   2. token no `sck_slug`
 *   3. token na `campaign_name` (via lookup criativo → meta_ads)
 *   4. funil do front-end comprado pelo MESMO email (`emailFunilMap`) — resolve order
 *      bumps órfãos (sem UTM) que herdam o funil da compra; respeita "bump varia de funil".
 *   5. default do produto (`produtoToFunil`) — último recurso.
 */
function resolveFunil(
  r: SbTransacao,
  criativoCampaignMap: Record<string, string>,
  emailFunilMap: Record<string, Funil>,
): Funil | null {
  return (
    detectFunil(r.criativo || '') ||
    detectFunil(r.sck_slug || '') ||
    detectFunil(criativoCampaignMap[r.criativo || ''] || '') ||
    produtoToFunil(r.produto || '', r.criativo || '') ||
    emailFunilMap[emailKeyOf(r.email)] ||
    produtoBumpDefault(r.produto || '', r.criativo || '')
  )
}

/**
 * Filtra transações pelo funil. Resolve o funil de cada transação via resolveFunil
 * (criativo → sck → campanha → email/front da mesma compra → default do produto) e
 * compara com o funil pedido. Passe `allMetaAds` para o lookup de campanha.
 */
export function filterTransacoesByFunil(rows: SbTransacao[], funil: string, allMetaAds?: SbMetaAds[], funis: FunilConfig[] = DEFAULT_FUNIS): SbTransacao[] {
  const slug = normalizeFunil(funil, funis)
  if (!slug) return rows

  // criativo (ad_name) → campaign_name (do meta_ads)
  const criativoCampaignMap: Record<string, string> = {}
  if (allMetaAds) {
    for (const r of allMetaAds) {
      const adName = (r.ad_name || r.criativo || '').trim()
      if (adName && r.campaign_name && !criativoCampaignMap[adName]) criativoCampaignMap[adName] = r.campaign_name
    }
  }
  const sinalDe = (r: SbTransacao) => ({
    criativo: r.criativo, sck: r.sck_slug, campaign: criativoCampaignMap[r.criativo || ''], produto: r.produto,
    produtoId: r.produto_id || '',
    utmCampaign: r.utm_campaign_ultimo, utmContent: r.utm_content_ultimo, utmTerm: r.utm_term_ultimo,
  })

  // email → funil, pelo SINAL DIRETO (tokens de criativo/sck/campanha). Front tem
  // prioridade pra que order bumps órfãos do mesmo comprador herdem o funil de entrada.
  const emailFunilMap: Record<string, string> = {}
  for (const r of rows) {
    const email = emailKeyOf(r.email); if (!email) continue
    const dir = resolverFunilPorTokens(sinalDe(r), funis)
    if (dir && produtoToTipo(r.produto || '', r.criativo || '', funis, r.produto_id || '') === 'frontEnd') emailFunilMap[email] = dir
  }
  for (const r of rows) {
    const email = emailKeyOf(r.email); if (!email || emailFunilMap[email]) continue
    const dir = resolverFunilPorTokens(sinalDe(r), funis)
    if (dir) emailFunilMap[email] = dir
  }

  return rows.filter((r) => resolverFunilCfg({ ...sinalDe(r), emailFunil: emailFunilMap[emailKeyOf(r.email)] }, funis) === slug)
}

// ─── Experiments ──────────────────────────────────────────────────────────────

export interface SbVariant {
  name: string       // 'A' | 'B' | 'C'
  slug: string       // ex: 'col-pv02' (page) | 'ck-v1' (checkout) | 'ob1' (ob)
  url?: string       // obrigatório para page e checkout; ausente para ob
  weight: number     // 0–1; o Worker renormaliza as ATIVAS, então não precisa somar 1
  enabled?: boolean  // ausente = ativa. false = desativada (fora do sorteio, histórico preservado)
}

export interface SbExperiment {
  id: string
  name: string
  entry_path: string
  type: 'page' | 'checkout' | 'ob'
  variants: SbVariant[]
  status: 'draft' | 'active' | 'paused' | 'ended'
  fallback_url?: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
  matrix?: Record<string, string> | null       // ob only: { "ckSlug_obSlug": "https://pay.hotmart.com/..." }
  checkout_slug?: string | null                 // page only: entry_path do checkout vinculado ex: "/col"
  started_at: string | null
  ended_at: string | null
  created_at: string
  // A/B Testing 2.0 (migration 0003)
  vturb_enabled?: boolean
  auto_optimize?: boolean
  champion_variant?: string | null
  bandit_min_conv?: number
}

export interface SbImpressionStat {
  experiment_id: string
  variant: string
  count: number
}

export interface SbImpressionUid {
  experiment_id: string
  variant: string
  uid: string
}

/**
 * Fase 3: bot_uids virou tabela de QUARENTENA com workflow suspect→confirmed.
 * Só status='confirmed' exclui das analytics (suspects continuam contando até revisão).
 * Backward-compat: rows sem coluna status (pré-migration 0002) são tratadas como confirmed.
 */
// Fail-CLOSED do filtro de bots: se a query falhar, reusar o último Set bom da
// instância em vez de retornar vazio (vazio = bots passam a CONTAR nas métricas
// silenciosamente — viola "dados 100% corretos"). Multi-tenant: o último-bom é
// por workspace (Map), senão um projeto serviria o fallback de outro.
const _lastGoodBotUids = new Map<string, Set<string>>()

export const fetchBotUids = cache(async (): Promise<Set<string>> => {
  const client = getClient()
  const wsId = await getActiveWorkspaceId()
  // Tenta filtrar por status. Se a coluna não existe (migration não aplicada), cai pra select * sem filtro.
  let { data, error } = await client.from('bot_uids').select('uid').eq('workspace_id', wsId).eq('status', 'confirmed')
  if (error && /column .* does not exist/i.test(error.message)) {
    const fallback = await client.from('bot_uids').select('uid').eq('workspace_id', wsId)
    data = fallback.data
    error = fallback.error
  }
  if (error) {
    console.error('[supabase] bot_uids FALHOU — usando último filtro válido da instância:', error.message)
    return _lastGoodBotUids.get(wsId) ?? new Set()
  }
  const set = new Set((data ?? []).map((r: { uid: string }) => r.uid))
  _lastGoodBotUids.set(wsId, set)
  return set
})

export const fetchImpressionUids = cache(async (de?: string, ate?: string): Promise<SbImpressionUid[]> => {
  const client = getClient()
  const wsId = await getActiveWorkspaceId()
  const [botUids, rows] = await Promise.all([
    fetchBotUids(),
    (async () => {
      const all: SbImpressionUid[] = []
      let from = 0
      while (true) {
        let q = client
          .from('impressions')
          .select('experiment_id, variant, uid')
          .eq('workspace_id', wsId)
        if (de) q = q.gte('timestamp', `${de}T00:00:00-03:00`)
        if (ate) q = q.lt('timestamp', `${diaSeguinteYmd(ate)}T00:00:00-03:00`) // #14 fim de dia exclusivo
        const { data, error } = await q.range(from, from + PAGE_SIZE - 1)
        if (error) { console.error('[supabase] impressionUids:', error.message); return [] }
        const chunk = (data ?? []) as SbImpressionUid[]
        all.push(...chunk)
        if (chunk.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
      return all
    })(),
  ])
  return rows.filter(r => !botUids.has(r.uid))
})

/**
 * Cliques roteados (302 do Worker /r/) por experimento/variante — tabela route_clicks
 * (migration 0053). Denominador do connect rate na aba Experimentos: connect rate =
 * views (impressions) ÷ clicks (route_clicks), MESMA identidade (uid). Mesmo filtro de
 * bot das impressões pra o ratio não pender pra um lado. Retorna [] se a tabela não
 * existe (migration não aplicada) → a UI mostra connect rate "—" e não quebra.
 */
export const fetchRouteClickUids = cache(async (de?: string, ate?: string): Promise<SbImpressionUid[]> => {
  const client = getClient()
  const wsId = await getActiveWorkspaceId()
  const [botUids, rows] = await Promise.all([
    fetchBotUids(),
    (async () => {
      const all: SbImpressionUid[] = []
      let from = 0
      while (true) {
        let q = client
          .from('route_clicks')
          .select('experiment_id, variant, uid')
          .eq('workspace_id', wsId)
        if (de) q = q.gte('timestamp', `${de}T00:00:00-03:00`)
        if (ate) q = q.lt('timestamp', `${diaSeguinteYmd(ate)}T00:00:00-03:00`) // fim de dia exclusivo
        const { data, error } = await q.range(from, from + PAGE_SIZE - 1)
        if (error) {
          if (!/relation .* does not exist/i.test(error.message)) console.error('[supabase] routeClickUids:', error.message)
          return all // tabela ausente ou falha → degrada pro que já tem
        }
        const chunk = (data ?? []) as SbImpressionUid[]
        all.push(...chunk)
        if (chunk.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
      return all
    })(),
  ])
  return rows.filter(r => !botUids.has(r.uid))
})

export interface SbCheckoutHit {
  slug: string
  cid: string
  /** Cookie uid do Worker (via GTM server-side). Presente só p/ quem veio pelo /r/.
   *  Mesma identidade de `impressions.uid` → passagem EXATA por interseção. */
  uid?: string | null
}

/**
 * Cliques no CTA de checkout (tabela checkout_hits, alimentada pela tag GTM). Dá
 * "passagem pro checkout" pra páginas SEM teste A/B. Escopo por workspace + janela
 * de data (coluna `dia`, já em America/Sao_Paulo). Retorna [] se a tabela não existe
 * (migration 0051 não aplicada) — a Análise de Páginas degrada pro comportamento antigo.
 */
export const fetchCheckoutHits = cache(async (de?: string, ate?: string): Promise<SbCheckoutHit[]> => {
  const client = getClient()
  const wsId = await getActiveWorkspaceId()
  const all: SbCheckoutHit[] = []
  let from = 0
  while (true) {
    let q = client.from('checkout_hits').select('slug, cid, uid').eq('workspace_id', wsId)
    if (de) q = q.gte('dia', de)
    if (ate) q = q.lte('dia', ate)
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1)
    if (error) {
      // tabela ausente (migration não aplicada) ou falha: degrada silencioso pra []
      if (!/relation .* does not exist/i.test(error.message)) console.error('[supabase] checkoutHits:', error.message)
      return all
    }
    const chunk = (data ?? []) as SbCheckoutHit[]
    all.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
})

/**
 * "Rodando desde" por variante = 1ª impressão (view `variant_first_seen`, migration 0055).
 * É o único sinal RETROATIVO honesto de quando a variante entrou no ar: o JSON de `variants`
 * nunca guardou data de criação. E pega certo a variante ADICIONADA depois do experimento
 * (ex: COL-TP-2006 variante D, criada em 29/06 num teste que começou em 20/06).
 * Chave do mapa: `experimentId|variant`. Variante sem tráfego ainda → ausente (não inventa data).
 */
export const fetchVariantFirstSeen = cache(async (): Promise<Map<string, string>> => {
  const client = getClient()
  const wsId = await getActiveWorkspaceId()
  const { data, error } = await client
    .from('variant_first_seen')
    .select('experiment_id, variant, first_seen')
    .eq('workspace_id', wsId)
  if (error) {
    // view ausente (migration não aplicada) → degrada: o card só não mostra a data
    if (!/relation .* does not exist/i.test(error.message)) console.error('[supabase] variantFirstSeen:', error.message)
    return new Map()
  }
  const m = new Map<string, string>()
  for (const r of (data ?? []) as { experiment_id: string; variant: string; first_seen: string }[]) {
    if (r.first_seen) m.set(`${r.experiment_id}|${r.variant}`, r.first_seen)
  }
  return m
})

export const fetchExperiments = cache(async (): Promise<SbExperiment[]> => {
  const client = getClient()
  const { data, error } = await client
    .from('experiments')
    .select('*')
    .eq('workspace_id', await getActiveWorkspaceId())
    .order('created_at', { ascending: false })
  if (error) { console.error('[supabase] experiments:', error.message); return [] }
  return (data ?? []) as SbExperiment[]
})

export const fetchImpressionStats = cache(async (de?: string, ate?: string): Promise<SbImpressionStat[]> => {
  const client = getClient()
  const wsId = await getActiveWorkspaceId()
  const botUids = await fetchBotUids()

  const counts: Record<string, number> = {}
  let from = 0
  while (true) {
    let q = client
      .from('impressions')
      .select('experiment_id, variant, uid')
      .eq('workspace_id', wsId)
    if (de) q = q.gte('timestamp', `${de}T00:00:00-03:00`)
    if (ate) q = q.lt('timestamp', `${diaSeguinteYmd(ate)}T00:00:00-03:00`) // #14 fim de dia exclusivo
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1)
    if (error) { console.error('[supabase] impressions:', error.message); return [] }
    for (const row of (data ?? []) as { experiment_id: string; variant: string; uid: string }[]) {
      if (botUids.has(row.uid)) continue
      const key = `${row.experiment_id}|${row.variant}`
      counts[key] = (counts[key] ?? 0) + 1
    }
    if ((data ?? []).length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return Object.entries(counts).map(([key, count]) => {
    const [experiment_id, variant] = key.split('|')
    return { experiment_id, variant, count }
  })
})

// ─── Quizzes ──────────────────────────────────────────────────────────────────

export interface SbQuizStep {
  id: string
  type: 'text' | 'single_choice' | 'multi_choice' | 'form'
  title?: string
  body?: string
  options?: { id: string; label: string }[]
  fields?: string[]
  cta?: string
}

export interface SbQuizConfig {
  steps: SbQuizStep[]
  redirect_on_complete?: string
  thank_you?: { title?: string; body?: string }
}

export interface SbQuiz {
  slug: string
  title: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  config: SbQuizConfig
  webhook_url: string | null
  created_at: string
  updated_at: string
}

export interface SbQuizSession {
  session_id: string
  uid: string
  quiz_slug: string
  utms: Record<string, string> | null
  ua: string | null
  ua_simple: string | null
  ip_country: string | null
  started_at: string
  completed_at: string | null
  lead_data: Record<string, unknown> | null
  bot_filtered: boolean
}

export interface SbQuizFunnelRow {
  quiz_slug: string
  day: string
  step_index: number
  step_id: string
  views: number
  answers: number
  dropouts: number
  completions: number
  checkout_clicks: number
}

export const fetchQuizzes = cache(async (): Promise<SbQuiz[]> => {
  const client = getClient()
  const { data, error } = await client
    .from('quiz_quizzes')
    .select('*')
    .eq('workspace_id', await getActiveWorkspaceId())
    .order('created_at', { ascending: false })
  if (error) { console.error('[supabase] quiz_quizzes:', error.message); return [] }
  return (data ?? []) as SbQuiz[]
})

export const fetchQuizSessions = cache(async (): Promise<SbQuizSession[]> => {
  const client = getClient()
  const wsId = await getActiveWorkspaceId()
  const all: SbQuizSession[] = []
  let from = 0
  while (true) {
    const { data, error } = await client
      .from('quiz_sessions')
      .select('*')
      .eq('workspace_id', wsId)
      .eq('bot_filtered', false)
      .order('started_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) { console.error('[supabase] quiz_sessions:', error.message); return all }
    const chunk = (data ?? []) as SbQuizSession[]
    all.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
})

export const fetchQuizFunnel = cache(async (): Promise<SbQuizFunnelRow[]> => {
  const client = getClient()
  const { data, error } = await client
    .from('quiz_funnel_daily')
    .select('*')
    .eq('workspace_id', await getActiveWorkspaceId())
    .order('day', { ascending: false })
  if (error) { console.error('[supabase] quiz_funnel_daily:', error.message); return [] }
  // checkout_clicks só existe após a migration 0002 — default 0 enquanto a coluna não chega.
  return (data ?? []).map((r) => ({ ...r, checkout_clicks: (r as { checkout_clicks?: number }).checkout_clicks ?? 0 })) as SbQuizFunnelRow[]
})

export function scoreQualificacao(q: SbQualificacao | undefined): 'Qualificado' | 'Semi-qualificado' | 'Lead' | 'Sem ficha' {
  if (!q || !q.tem_ficha) return 'Sem ficha'
  const fat = (q.faturamento_declarado || '').toLowerCase()
  // Word-boundary regex prevents "200" from matching "\b20\b", "300" from matching "\b30\b", etc.
  if (fat.includes('acima') || fat.includes('mais de') || /\b100\b/.test(fat) || /\b50\b/.test(fat)) return 'Qualificado'
  if (/\b20\b/.test(fat) || /\b30\b/.test(fat) || /\b40\b/.test(fat)) return 'Semi-qualificado'
  return 'Lead'
}
