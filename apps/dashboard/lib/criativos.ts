import { createClient } from '@supabase/supabase-js'
import {
  fetchMetaAds,
  fetchTransacoes,
  fetchFunisConfig,
  getDateRange,
  filterByFunil,
  filterByAccount,
  filterTransacoesByFunil,
} from './supabase'
import { aggregateCreatives, type CreativeStats } from './creativeAnalysis'
import { getActiveWorkspaceId } from './workspace-context'
import { convBodyFrac } from './metrics/convBody'
import { liquidoHotmartVenda } from './hotmartFees'
import { assignmentsByAdRef } from './creativeTags'
import type { CriativoCard, CriativoTag, FadigaStatus } from '@/types/criativos'

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

interface CARow {
  ad_id: string | null
  ad_name: string | null
  fadiga_status: string | null
  fadiga_calculado_em: string | null
  frames_path: string | null
  thumbnail_url: string | null
  video_url: string | null
  instagram_permalink_url: string | null
  hook_tipo: string[] | string | null
  hook_descricao: string | null
  resumo: string | null
  transcricao: string | null
  formato_visual: string[] | string | null
  angulo_copy: string[] | string | null
  elementos_visuais: string[] | string | null
  cta: string[] | string | null
  producao: string[] | string | null
  estrutura_roteiro: unknown
  padroes_detectados: unknown
  nivel_consciencia: string | null
  momento_funil: string | null
  promessa_principal: string | null
}

// Campos array do Supabase podem vir como string[] ou CSV.
function parseArr(raw: string[] | string | null | undefined): string[] | null {
  if (Array.isArray(raw)) {
    const a = raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    return a.length ? a : null
  }
  if (typeof raw === 'string' && raw.trim() !== '') return raw.split(',').map((s) => s.trim()).filter(Boolean)
  return null
}

/**
 * Lista criativos com métricas reais por ad_id, respeitando os FILTROS GLOBAIS
 * do dashboard (data `de`/`ate`, funil e conta) — sem filtro próprio.
 *
 * ROAS/receita/vendas/CPA vêm de `aggregateCreatives` (meta_ads × transacoes
 * Hotmart). Retenção (hook/hold/ctr/cpm) das views. Mescla `criativo_analise`.
 * Ordena por ROAS.
 */
export async function listCriativos(
  de = '',
  ate = '',
  funil = 'all',
  conta = 'all'
): Promise<CriativoCard[]> {
  const { from, to } = getDateRange(de, ate)

  const [metaAll, transAll, funis] = await Promise.all([fetchMetaAds(), fetchTransacoes(), fetchFunisConfig()])

  // Filtros globais: data + funil + conta (mesmos helpers das outras abas).
  let meta = metaAll.filter((m) => (m.impressoes ?? 0) > 0)
  if (from) meta = meta.filter((m) => (m.data ?? '') >= from)
  if (to) meta = meta.filter((m) => (m.data ?? '') <= to)
  meta = filterByFunil(meta, funil, funis)
  meta = filterByAccount(meta, conta)
  if (meta.length === 0) return []

  let trans = transAll
  if (from) trans = trans.filter((t) => (t.data ?? '') >= from)
  if (to) trans = trans.filter((t) => (t.data ?? '') <= to)
  trans = filterTransacoesByFunil(trans, funil, metaAll, funis)

  // ROAS / receita / vendas (frontEnd) / cpa reais.
  // aggregateCreatives agora agrupa por NOME (mesmo criativo em vários ad_ids = 1 linha);
  // cada CreativeStats traz o ad_id representante (maior investimento). Indexa por nome.
  const stats = aggregateCreatives(meta, trans)
  const statsByName: Record<string, CreativeStats> = {}
  for (const s of stats) statsByName[s.criativo] = s

  // Views por NOME do criativo (hook/hold/ctr/cpm) — quartis não estão em CreativeStats.
  // Guarda os ad_ids do grupo pra escolher a análise IA/preview.
  interface ViewsAgg {
    ad_name: string
    account_id: string | null
    imp: number
    cliques: number
    v3: number
    v75: number
    v95: number
    invest: number
    checkouts: number
    comentarios: number
    adIds: Set<string>
  }
  const viewsByName: Record<string, ViewsAgg> = {}
  // Gasto e receita líquida POR ad_id — pra escolher o ad_id CANÔNICO (maior lucro)
  // de cada grupo-por-nome (o que o "Copiar ID" copia pra reusar na campanha).
  const gastoByAdId: Record<string, number> = {}
  const receitaByAdId: Record<string, number> = {}
  for (const m of meta) {
    const name = m.criativo || m.ad_name || '(sem nome)'
    const a =
      viewsByName[name] ??
      (viewsByName[name] = { ad_name: m.ad_name || m.criativo || name, account_id: m.account_id ?? null, imp: 0, cliques: 0, v3: 0, v75: 0, v95: 0, invest: 0, checkouts: 0, comentarios: 0, adIds: new Set<string>() })
    if (!a.account_id && m.account_id) a.account_id = m.account_id
    a.imp += m.impressoes ?? 0
    a.cliques += m.cliques_link ?? 0
    a.v3 += m.views_3seg ?? 0
    a.v75 += m.views_75pct ?? 0
    a.v95 += m.views_95pct ?? 0
    a.invest += m.investimento ?? 0
    a.checkouts += m.checkouts ?? 0
    a.comentarios += m.comentarios ?? 0 // NULL (dia pré-coluna) soma 0, não quebra
    if (m.ad_id) { a.adIds.add(m.ad_id); gastoByAdId[m.ad_id] = (gastoByAdId[m.ad_id] ?? 0) + (m.investimento ?? 0) }
  }

  // Receita líquida por ad_id (atribuição direta pelo ad_id da transação) — base
  // do lucro por anúncio pra escolher o canônico do grupo.
  for (const t of trans) {
    if (t.ad_id) receitaByAdId[t.ad_id] = (receitaByAdId[t.ad_id] ?? 0) + liquidoHotmartVenda(Number(t.valor_bruto ?? 0))
  }

  // criativo_analise (fadiga + IA) por ad_id — SEMPRE filtrado por workspace
  // (ad_id vem do Meta e pode colidir entre tenants → vazaria análise/transcrição).
  const supabase = getClient()
  const workspaceId = await getActiveWorkspaceId()
  const { data: caRows } = await supabase
    .from('criativo_analise')
    .select(
      'ad_id,ad_name,fadiga_status,fadiga_calculado_em,frames_path,thumbnail_url,video_url,instagram_permalink_url,hook_tipo,hook_descricao,resumo,transcricao,formato_visual,angulo_copy,elementos_visuais,cta,producao,estrutura_roteiro,padroes_detectados,nivel_consciencia,momento_funil,promessa_principal'
    )
    .eq('workspace_id', workspaceId)
    .not('ad_id', 'is', null)
  const caMap: Record<string, CARow> = {}
  for (const r of (caRows as CARow[] | null) ?? []) if (r.ad_id) caMap[r.ad_id] = r

  // tags (manual + odin + equipe) por ad_id — pra anexar a cada card (união do grupo)
  const tagsByAd = await assignmentsByAdRef(workspaceId)

  // preview_url do Meta (mesmo link "ver anúncio" da aba Criativos), por ad_id e ad_name.
  const previewByAd: Record<string, string> = {}
  const previewByName: Record<string, string> = {}
  for (const m of metaAll) {
    if (!m.preview_url) continue
    if (m.ad_id && !previewByAd[m.ad_id]) previewByAd[m.ad_id] = m.preview_url
    const nm = m.ad_name || m.criativo
    if (nm && !previewByName[nm]) previewByName[nm] = m.preview_url
  }

  const result: CriativoCard[] = Object.entries(viewsByName).map(([name, v]) => {
    const s = statsByName[name]
    const repAdId = s?.ad_id ?? null
    // Análise IA/fadiga: prefere o ad_id representante; senão qualquer ad_id do grupo
    // que já tenha resumo (mesmo criativo → mesma análise).
    let ca: CARow | undefined = repAdId ? caMap[repAdId] : undefined
    if (!ca || !ca.resumo) {
      for (const id of v.adIds) { const c = caMap[id]; if (c?.resumo) { ca = c; break } }
    }
    if (!ca && repAdId) ca = caMap[repAdId]
    const cardAdId = repAdId ?? Array.from(v.adIds)[0] ?? name
    // ad_id CANÔNICO = anúncio de MAIOR LUCRO (receita líq. − gasto) do grupo;
    // empate → maior investimento. É o ID que o "Copiar ID" copia.
    // ARMADILHA: receitaByAdId só existe quando a transação traz t.ad_id — mas a
    // atribuição de receita deste projeto é por NOME (t.ad_id é frequentemente
    // nulo). Se NENHUM ad do grupo tem receita por ad_id, "maior lucro" = -gasto e
    // escolheria o de MENOR gasto (um teste pausado), o oposto do vencedor. Nesse
    // caso caímos no anúncio DOMINANTE (maior investimento).
    let ad_id_canonico = cardAdId
    const receitaGrupo = Array.from(v.adIds).reduce((sum, id) => sum + (receitaByAdId[id] ?? 0), 0)
    if (receitaGrupo > 0) {
      let bestLucro = -Infinity
      let bestInv = -1
      for (const id of v.adIds) {
        const lucroId = (receitaByAdId[id] ?? 0) - (gastoByAdId[id] ?? 0)
        const invId = gastoByAdId[id] ?? 0
        if (lucroId > bestLucro || (lucroId === bestLucro && invId > bestInv)) {
          bestLucro = lucroId; bestInv = invId; ad_id_canonico = id
        }
      }
    } else {
      let bestInv = -1
      for (const id of v.adIds) {
        const invId = gastoByAdId[id] ?? 0
        if (invId > bestInv) { bestInv = invId; ad_id_canonico = id }
      }
    }
    const imp = v.imp
    const gasto = s?.investimento ?? v.invest

    const hold_rate = imp > 0 ? (v.v75 || v.v95) / imp : null
    const hook_rate = imp > 0 ? v.v3 / imp : null
    const ctr = imp > 0 ? v.cliques / imp : null
    const cpc_link = v.cliques > 0 ? gasto / v.cliques : null
    const cpm = imp > 0 ? (gasto / imp) * 1000 : null
    const custo_por_checkout = v.checkouts > 0 ? gasto / v.checkouts : null

    const roas = s?.roas ?? 0
    const roasBruto = s?.roasBruto ?? 0
    const receita = s?.receita ?? 0
    const vendas = s?.compras ?? 0
    const cpa = s?.cpa ?? null

    // Conversão do BODY: de quem assistiu 75% do vídeo, quantos compraram. Isola a força do
    // corpo do criativo — o gancho já fez o trabalho dele (isso é o hook rate); aqui o que
    // pesa é se a promessa/oferta do miolo converteu quem ficou até o fim.
    // Piso de v75: anúncio de IMAGEM tem views75 residual e a razão explodia (demo-lps-img-02:
    // 7 compras ÷ 1 view75 = 700%). Abaixo do piso → null, o card mostra "—".
    const conv_body = convBodyFrac(vendas, v.v75)

    // Conversão do CLIQUE: de quem clicou no link, quantos compraram. Eficiência de tudo que
    // vem DEPOIS do anúncio (página + checkout). Já existe em /criativos como `convClique`;
    // faltava aqui na Análise de Criativos.
    const conv_clique = v.cliques > 0 ? vendas / v.cliques : null

    const fadigaRaw = ca?.fadiga_status
    const fadiga_status: FadigaStatus | null =
      fadigaRaw === 'saudavel' || fadigaRaw === 'atencao' || fadigaRaw === 'saturado' || fadigaRaw === 'insuficiente'
        ? fadigaRaw
        : null

    // tags do card = união das tags de todos os ad_ids do grupo-por-nome (dedup por id)
    const cardTags: CriativoTag[] = []
    const seenTag = new Set<number>()
    for (const id of v.adIds) {
      for (const t of tagsByAd.get(id) ?? []) {
        if (!seenTag.has(t.id)) { seenTag.add(t.id); cardTags.push(t) }
      }
    }

    return {
      ad_id: cardAdId,
      ad_id_canonico,
      ad_ids: Array.from(v.adIds),
      tags: cardTags,
      num_contas: s?.contas ?? 0,
      campaign_name: s?.campaign_name ?? null,
      adset_name: s?.adset_name ?? null,
      account_id: v.account_id,
      ad_name: ca?.ad_name || v.ad_name || name,
      hold_rate,
      hook_rate,
      ctr,
      conv_body,
      conv_clique,
      comentarios: v.comentarios,
      cpa,
      cpc_link,
      cpm,
      impressoes: imp,
      investimento: gasto,
      custo_por_checkout,
      roas,
      roasBruto,
      receita,
      lucro: receita - gasto,
      vendas,
      fadiga_status,
      fadiga_calculado_em: ca?.fadiga_calculado_em ?? null,
      frames_path: ca?.frames_path ?? null,
      thumbnail_url: ca?.thumbnail_url ?? null,
      video_url: ca?.video_url ?? null,
      instagram_permalink_url: ca?.instagram_permalink_url ?? null,
      preview_url: previewByName[name] ?? (repAdId ? previewByAd[repAdId] : null) ?? null,
      hook_tipo: parseArr(ca?.hook_tipo),
      hook_descricao: ca?.hook_descricao ?? null,
      resumo: ca?.resumo ?? null,
      transcricao: ca?.transcricao ?? null,
      formato_visual: parseArr(ca?.formato_visual),
      angulo_copy: parseArr(ca?.angulo_copy),
      elementos_visuais: parseArr(ca?.elementos_visuais),
      cta: parseArr(ca?.cta),
      producao: parseArr(ca?.producao),
      estrutura_roteiro: (ca?.estrutura_roteiro as { narrativa: string; confianca: number } | null) ?? null,
      padroes_detectados: (ca?.padroes_detectados as Record<string, unknown> | null) ?? null,
      nivel_consciencia: ca?.nivel_consciencia ?? null,
      momento_funil: ca?.momento_funil ?? null,
      promessa_principal: ca?.promessa_principal ?? null,
    }
  })

  result.sort((a, b) => b.roas - a.roas)
  return result
}
