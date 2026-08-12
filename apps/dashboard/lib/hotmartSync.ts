/**
 * Base compartilhada da ingestão Hotmart → transacoes.
 *
 * Usada por DOIS caminhos que precisam produzir a MESMA linha:
 *   • /api/webhook/hotmart      — tempo real (push da Hotmart)
 *   • /api/cron/reconcile-hotmart — rede de segurança (pull da sales/history)
 *
 * Por que existe: até 21/07/2026 o webhook era caminho ÚNICO e descartava toda
 * venda de valor <= R$1 como "teste", devolvendo HTTP 200 — a Hotmart marcava
 * como entregue e nunca reenviava. 48 vendas reais de R$1 (campanhas de
 * reativação/isca) sumiram do dashboard sem deixar rastro nem no audit_log.
 * O descarte agora é por MARCADOR DE TESTE, nunca por valor, e é sempre
 * auditado — e a reconciliação repara o que o push perder.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Datas (UTC-3 Brasília) ──────────────────────────────────────────────────

export function parseDateBR(ts: number | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts - 3 * 60 * 60 * 1000)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export function parseHoraBR(ts: number | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts - 3 * 60 * 60 * 1000)
  if (isNaN(d.getTime())) return null
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// ─── Detecção de transação de TESTE ──────────────────────────────────────────

/**
 * Postback de teste do painel Hotmart. Critério = MARCADOR, nunca valor.
 *
 * Deliberadamente ESTREITO: um falso negativo (linha de teste entra) some com um
 * delete; um falso positivo (venda real descartada) é perda silenciosa e
 * definitiva — foi exatamente o bug do filtro `valorBruto <= 1`. Na dúvida,
 * INGERE.
 */
const TEST_TRANSACTIONS = new Set(['HP16015479281022'])

export function isTestSale(args: {
  transaction: string
  productId?: unknown
  productName?: string
}): boolean {
  if (TEST_TRANSACTIONS.has(args.transaction)) return true
  if (/produto\s*test\s*postback/i.test(args.productName ?? '')) return true
  // product.id === 0 só existe no payload sintético de teste da Hotmart.
  if (args.productId !== undefined && args.productId !== null && Number(args.productId) === 0) return true
  return false
}

// ─── SCK ─────────────────────────────────────────────────────────────────────

function cleanSckValue(value: string | undefined): string {
  return !value || value === '0' || value === 'null' ? '' : value
}

export interface SckParts {
  pageSlug: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmContent: string
  utmTerm: string
  adId: string
  utmSourcePrim: string
  utmMediumPrim: string
  utmCampaignPrim: string
  utmContentPrim: string
  utmTermPrim: string
  adIdPrim: string
  /** sck como veio, sem parse. Guardado cru pra nada depender do mapeamento atual. */
  raw: string
  /** TODAS as posições, inclusive as que ainda não têm nome (`pos5`, `pos12`, ...). */
  todas: Record<string, string>
}

const EMPTY_SCK: SckParts = {
  pageSlug: '', utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '', utmTerm: '', adId: '',
  utmSourcePrim: '', utmMediumPrim: '', utmCampaignPrim: '', utmContentPrim: '', utmTermPrim: '', adIdPrim: '',
  raw: '', todas: {},
}

/**
 * Mapeamento alinhado com a automação n8n atual:
 *   0-6  = último impacto · 7-13 = primeiro impacto
 *   índice 0  = slug da página · índices 6/13 = ad_id (reconcilia com Meta Ads)
 *
 * As posições 5 e 12 nunca tiveram nome aqui. Pelo padrão UTM (source, medium,
 * campaign, content, term) o slot que sobra é o TERM, e é assim que são lidas —
 * mas isso é inferência do layout, não confirmação da tag do GTM que monta o sck.
 * Por isso `todas` carrega o pacote inteiro por índice e `raw` guarda o original:
 * se a posição 5 for outra coisa, o dado está preservado e a leitura se corrige
 * sem perder uma venda sequer. Índice desconhecido novo entra como `pos{N}`.
 */
export function parseSck(sck: string): SckParts {
  if (!sck) return { ...EMPTY_SCK, todas: {} }
  const p = sck.split('|')
  // Conferido contra a sales/history REAL em 08/08/2026. O NOME de cada posição
  // segue a convenção UTM da casa; o CONTEÚDO é o que o Meta entrega:
  //   [0] page_slug     p/col-pvia03
  //   [1] utm_source    Instagram_Reels        ← o placement viaja no source (é o padrão daqui)
  //   [2] utm_medium    pago-metaads
  //   [3] utm_campaign  AD_ID_DEMO_CAMPANHA     ← ID da campanha, não o nome
  //   [4] utm_content   demo-col-vid-04-…       ← nome do anúncio (o "criativo")
  //   [5] utm_term      AD_ID_DEMO_CONJUNTO     ← ID do conjunto de anúncios
  //   [6] ad_id         AD_ID_DEMO_ANUNCIO
  // 7-13 espelham tudo para o primeiro impacto.
  // `utm_placement` é outro parâmetro, hoje não usado — por isso a coluna nasce vazia.
  const NOMES: Record<number, string> = {
    0: 'page_slug', 1: 'utm_source', 2: 'utm_medium', 3: 'utm_campaign', 4: 'utm_content',
    5: 'utm_term', 6: 'ad_id',
    7: 'page_slug_primeiro', 8: 'utm_source_primeiro', 9: 'utm_medium_primeiro',
    10: 'utm_campaign_primeiro', 11: 'utm_content_primeiro', 12: 'utm_term_primeiro', 13: 'ad_id_primeiro',
  }
  const todas: Record<string, string> = {}
  p.forEach((valor, i) => {
    const limpo = cleanSckValue(valor)
    if (limpo) todas[NOMES[i] ?? `pos${i}`] = limpo
  })
  return {
    pageSlug: p[0] && p[0] !== '0' ? p[0] : '',
    utmSource: cleanSckValue(p[1]),     // placement (Instagram_Reels, Facebook_Mobile_Reels…)
    utmMedium: cleanSckValue(p[2]),
    utmCampaign: cleanSckValue(p[3]),   // ID da campanha no Meta
    utmContent: cleanSckValue(p[4]),    // nome do anúncio (o "criativo")
    utmTerm: cleanSckValue(p[5]),       // ID do conjunto de anúncios
    adId: cleanSckValue(p[6]),
    utmSourcePrim: cleanSckValue(p[8]),
    utmMediumPrim: cleanSckValue(p[9]),
    utmCampaignPrim: cleanSckValue(p[10]),
    utmContentPrim: cleanSckValue(p[11]),
    utmTermPrim: cleanSckValue(p[12]),
    adIdPrim: cleanSckValue(p[13]),
    raw: sck,
    todas,
  }
}

// ─── Valor bruto ─────────────────────────────────────────────────────────────

/**
 * HOTMART_INSTALLMENTS (parcelamento FINANCIADO pela Hotmart): price.value chega
 * como valor da PARCELA, não o total → multiplica p/ não subnotificar o bruto.
 * Cartão parcelado tem outro payment.type e já traz o total em price.value.
 */
export function normalizeValorBruto(priceValue: number, paymentType: string, parcelas: number): number {
  return paymentType === 'HOTMART_INSTALLMENTS' && parcelas > 1 ? priceValue * parcelas : priceValue
}

// ─── Criativo (Hotmart × Meta Ads) ───────────────────────────────────────────

export async function resolveCreativeName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  adId: string,
  dataCompra: string | null,
  metaAccessToken = process.env.META_ACCESS_TOKEN,
): Promise<string> {
  if (!adId || !/^\d+$/.test(adId)) return ''

  if (dataCompra) {
    const { data: exactMatch } = await supabase
      .from('meta_ads').select('ad_name')
      .eq('data', dataCompra).eq('ad_id', adId)
      .limit(1).maybeSingle() as { data: { ad_name: string } | null }
    if (exactMatch?.ad_name) return exactMatch.ad_name

    const { data: latestBefore } = await supabase
      .from('meta_ads').select('ad_name,data')
      .eq('ad_id', adId).lte('data', dataCompra)
      .order('data', { ascending: false }).limit(1).maybeSingle() as { data: { ad_name: string } | null }
    if (latestBefore?.ad_name) return latestBefore.ad_name
  }

  const { data: latestAny } = await supabase
    .from('meta_ads').select('ad_name,data')
    .eq('ad_id', adId).order('data', { ascending: false })
    .limit(1).maybeSingle() as { data: { ad_name: string } | null }
  if (latestAny?.ad_name) return latestAny.ad_name

  return fetchAdNameFromMeta(adId, metaAccessToken)
}

async function fetchAdNameFromMeta(adId: string, token: string | undefined): Promise<string> {
  if (!token) return ''
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${adId}?fields=name&access_token=${token}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return ''
    const json = await res.json() as { name?: string }
    return json.name ?? ''
  } catch {
    return ''
  }
}

// ─── Montagem da linha ───────────────────────────────────────────────────────

export interface NormalizedSale {
  transaction: string
  orderTs: number | undefined
  priceValue: number
  paymentType: string
  parcelas: number
  buyerName: string
  buyerEmail: string
  productName: string
  /**
   * ID do produto na Hotmart — chave ESTÁVEL do produto. O nome é editável no
   * painel (já mudou uma vez e quase derrubou a classificação), o ID não.
   * '' quando a origem não informa; nesse caso a regra por nome ainda decide.
   */
  productId: string
  rawSck: string
  /** Comissão PRODUCER. null = DESCONHECIDO (sales/history não devolve). */
  valorLiquidoExpert: number | null
}

export interface TransacaoRecord {
  workspace_id: string
  hotmart_id: string
  data: string | null
  hora_compra: string | null
  nome: string
  email: string
  produto: string
  /** ID Hotmart do produto (migration 0067). null quando a origem não informou. */
  produto_id: string | null
  valor_bruto: number
  valor_liquido_expert: number | null
  forma_pagamento: string
  parcelas: number
  criativo: string
  ad_id: string | null
  criativo_primeiro: string | null
  ad_id_primeiro: string | null
  utm_medium_ultimo: string
  utm_source_ultimo: string
  utm_medium_primeiro: string
  utm_source_primeiro: string
  // ── migration 0068: o resto do pacote de origem ──
  utm_campaign_ultimo: string
  utm_content_ultimo: string
  utm_term_ultimo: string
  utm_placement_ultimo: string
  utm_campaign_primeiro: string
  utm_content_primeiro: string
  utm_term_primeiro: string
  utm_placement_primeiro: string
  /** sck cru, exatamente como a Hotmart entregou. */
  sck_raw: string | null
  /** pacote inteiro por nome de posição — inclui parâmetro que ainda não tem coluna. */
  utms: Record<string, string> | null
  sck_slug: string
}

/**
 * Produz a linha de `transacoes` a partir de uma venda normalizada.
 * Único ponto onde a linha nasce — webhook e reconciliação passam por aqui, então
 * uma venda reparada pelo cron é indistinguível da que veio pelo push.
 */
export async function buildTransacaoRecord(
  supabase: SupabaseClient,
  wsId: string,
  sale: NormalizedSale,
): Promise<TransacaoRecord> {
  const valorBruto = normalizeValorBruto(sale.priceValue, sale.paymentType, sale.parcelas)
  const dataCompra = parseDateBR(sale.orderTs)
  const sck = parseSck(sale.rawSck)

  // Atribuição Hotmart × Meta só faz sentido para tráfego pago de Meta Ads.
  const isMetaAdsTraffic = sck.utmMedium.toLowerCase().includes('pago-metaads')
  let criativo = ''
  if (isMetaAdsTraffic && sck.adId) criativo = await resolveCreativeName(supabase, sck.adId, dataCompra)
  if (!criativo && isMetaAdsTraffic) criativo = /^\d+$/.test(sck.utmContent) ? '' : sck.utmContent
  if (/^\d+$/.test(criativo)) criativo = '' // nunca salvar ID numérico cru como criativo

  const isPaidMetaPrim = sck.utmMediumPrim.toLowerCase().includes('pago-metaads')
  let criativoPrimeiro = ''
  if (isPaidMetaPrim && sck.adIdPrim) {
    criativoPrimeiro = sck.adIdPrim === sck.adId
      ? criativo
      : await resolveCreativeName(supabase, sck.adIdPrim, dataCompra)
  }
  if (!criativoPrimeiro && isPaidMetaPrim) {
    criativoPrimeiro = /^\d+$/.test(sck.utmContentPrim) ? '' : sck.utmContentPrim
  }
  if (/^\d+$/.test(criativoPrimeiro)) criativoPrimeiro = ''

  return {
    workspace_id: wsId,
    hotmart_id: sale.transaction,
    data: dataCompra,
    hora_compra: parseHoraBR(sale.orderTs),
    nome: sale.buyerName,
    email: sale.buyerEmail.toLowerCase().trim(),
    produto: sale.productName,
    produto_id: sale.productId || null,
    valor_bruto: valorBruto,
    valor_liquido_expert: sale.valorLiquidoExpert,
    forma_pagamento: sale.paymentType,
    parcelas: sale.parcelas,
    criativo,
    ad_id: sck.adId || null,
    criativo_primeiro: criativoPrimeiro || null,
    ad_id_primeiro: sck.adIdPrim || null,
    utm_medium_ultimo: sck.utmMedium,
    utm_source_ultimo: sck.utmSource,
    utm_medium_primeiro: sck.utmMediumPrim,
    utm_source_primeiro: sck.utmSourcePrim,
    utm_campaign_ultimo: sck.utmCampaign,
    utm_content_ultimo: sck.utmContent,
    utm_term_ultimo: sck.utmTerm,
    // Placement não vem no sck hoje. Se a tag do GTM passar a mandar, cai no
    // pacote `todas` e é promovido aqui sem migration nova. Enquanto não mandar,
    // fica vazio — coluna vazia é honesta, dado inventado não.
    utm_placement_ultimo: sck.todas['utm_placement'] ?? '',
    utm_campaign_primeiro: sck.utmCampaignPrim,
    utm_content_primeiro: sck.utmContentPrim,
    utm_term_primeiro: sck.utmTermPrim,
    utm_placement_primeiro: sck.todas['utm_placement_primeiro'] ?? '',
    sck_raw: sck.raw || null,
    utms: Object.keys(sck.todas).length > 0 ? sck.todas : null,
    sck_slug: sck.pageSlug,
  }
}

// ─── Cliente da API Hotmart ──────────────────────────────────────────────────

const HOTMART_AUTH_URL = 'https://api-sec-vlc.hotmart.com/security/oauth/token'
const HOTMART_SALES_HISTORY_URL = 'https://developers.hotmart.com/payments/api/v1/sales/history'

export interface HotmartApiCreds { clientId: string; clientSecret: string }

/**
 * Erro de API sem o corpo da resposta não é acionável — obriga a adivinhar se foi
 * credencial, parâmetro ou permissão. O provedor já diz o motivo; carregue-o.
 */
async function erroHttp(prefixo: string, res: Response, url?: string): Promise<Error> {
  let corpo = ''
  try { corpo = (await res.text()).slice(0, 400) } catch { /* corpo ilegível */ }
  // A URL entra no erro porque "invalid_parameter" sem saber QUAL parâmetro foi
  // enviado é indiagnosticável. Não há segredo aqui: o token vai no header.
  return new Error(`${prefixo} ${res.status}${corpo ? ` — ${corpo}` : ''}${url ? ` [url: ${url}]` : ''}`)
}

export async function getHotmartToken(creds: HotmartApiCreds): Promise<string | null> {
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
  const res = await fetch(`${HOTMART_AUTH_URL}?grant_type=client_credentials`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
  })
  if (!res.ok) throw await erroHttp('hotmart auth', res)
  const json = await res.json() as { access_token?: string }
  return json.access_token ?? null
}

export interface SalesHistoryItem {
  buyer?: { name?: string; email?: string }
  product?: { id?: number; name?: string }
  purchase?: {
    transaction?: string
    order_date?: number
    approved_date?: number
    status?: string
    price?: { value?: number }
    payment?: { type?: string; installments_number?: number }
    offer?: { code?: string }
    tracking?: { source?: string; source_sck?: string; external_code?: string }
  }
}

/** Página TODO o intervalo. `page_token` vem em page_info.next_page_token. */
export async function fetchSalesHistoryRange(
  token: string,
  startMs: number,
  endMs: number,
  maxPages = 50,
): Promise<SalesHistoryItem[]> {
  const out: SalesHistoryItem[] = []
  let pageToken: string | null = null
  for (let i = 0; i < maxPages; i++) {
    const url = new URL(HOTMART_SALES_HISTORY_URL)
    url.searchParams.set('start_date', String(startMs))
    url.searchParams.set('end_date', String(endMs))
    url.searchParams.set('max_results', '500')
    if (pageToken) url.searchParams.set('page_token', pageToken)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) throw await erroHttp(`hotmart sales_history (pagina ${i + 1})`, res, url.toString())
    const json = await res.json() as { items?: SalesHistoryItem[]; page_info?: { next_page_token?: string } }
    out.push(...(json.items ?? []))
    pageToken = json.page_info?.next_page_token ?? null
    if (!pageToken) break
  }
  return out
}

/**
 * A consulta por PERÍODO não devolve `tracking`; a por TRANSAÇÃO devolve.
 * (Verificado contra a API em 21/07/2026.) Por isso o sck é buscado 1-a-1.
 */
export async function fetchSaleTracking(
  token: string,
  transaction: string,
): Promise<{ src: string; sck: string; xcod: string } | null> {
  const url = new URL(HOTMART_SALES_HISTORY_URL)
  url.searchParams.set('transaction', transaction)
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const json = await res.json() as { items?: SalesHistoryItem[] }
  const tracking = json.items?.[0]?.purchase?.tracking
  if (!tracking) return null
  return {
    src: String(tracking.source ?? ''),
    sck: String(tracking.source_sck ?? ''),
    xcod: String(tracking.external_code ?? ''),
  }
}

/** Item da sales/history → venda normalizada (comissões não vêm nesse endpoint). */
export function saleFromHistoryItem(item: SalesHistoryItem, rawSck: string): NormalizedSale {
  const p = item.purchase ?? {}
  return {
    transaction: String(p.transaction ?? ''),
    orderTs: p.order_date ?? p.approved_date,
    priceValue: Number(p.price?.value ?? 0),
    paymentType: String(p.payment?.type ?? ''),
    parcelas: Number(p.payment?.installments_number ?? 1) || 1,
    buyerName: String(item.buyer?.name ?? ''),
    buyerEmail: String(item.buyer?.email ?? ''),
    productName: String(item.product?.name ?? p.offer?.code ?? ''),
    productId: item.product?.id != null ? String(item.product.id) : '',
    rawSck,
    valorLiquidoExpert: null,
  }
}

/** Status da sales/history que representam receita reconhecida. */
export const HOTMART_REVENUE_STATUSES = new Set(['APPROVED', 'COMPLETE'])
