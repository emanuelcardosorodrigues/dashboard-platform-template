/**
 * Webhook Hotmart → Supabase
 * Recebe eventos de compra em tempo real e insere na tabela transacoes
 *
 * Payload real (v2.0.0):
 *   body.data.purchase.origin.sck  — SCK completa
 *   body.data.purchase.order_date  — Unix ms (UTC)
 *   body.data.purchase.price.value — valor bruto
 *   body.data.buyer.email / name
 *   body.data.product.name
 *   body.data.commissions[]        — comissões (PRODUCER = líquido expert)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { timingSafeEqual } from 'crypto'
import { log } from '@/lib/log'
import { audit } from '@/lib/audit'
import { parseValue, badRequest, hotmartWebhookSchema } from '@/lib/validation/schemas'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { getWorkspaceCredential, listWorkspacesWithProvider } from '@/lib/integrations/credentials'
import { getHotmartConfig } from '@/lib/integrations/factory'
import { sendPush } from '@/lib/push'
import {
  buildTransacaoRecord,
  fetchSaleTracking,
  getHotmartToken,
  isTestSale,
  normalizeValorBruto,
  parseDateBR,
} from '@/lib/hotmartSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Roteia o webhook pro projeto dono do token recebido (multi-tenant):
 *  - token == env HOTMART_WEBHOOK_TOKEN  → projeto DEMO (default).
 *  - token == webhookToken de alguma cred 'hotmart' cifrada → aquele projeto.
 *  - nenhum match → null (401).
 * Cada cliente configura o token DELE no painel Hotmart apontando pra MESMA URL.
 */
async function resolveHotmartWorkspace(token: string): Promise<string | null> {
  if (!token) return null
  const envTok = process.env.HOTMART_WEBHOOK_TOKEN
  if (envTok && tokensMatch(token, envTok)) {
    return await getActiveWorkspaceId() // webhook sem cookie → DEMO default
  }
  for (const ws of await listWorkspacesWithProvider('hotmart')) {
    const cred = await getWorkspaceCredential<{ webhookToken?: string }>(ws, 'hotmart')
    if (cred?.secret?.webhookToken && tokensMatch(token, cred.secret.webhookToken)) return ws
  }
  return null
}

// 100KB cap pra payload Hotmart — corte defensivo: webhooks reais ficam em ~5–15KB.
const MAX_BODY_BYTES = 100 * 1024

function tokensMatch(a: string, b: string): boolean {
  // timingSafeEqual exige buffers do mesmo tamanho. Equaliza pad com zeros pra
  // não vazar tamanho do segredo; depois compara também o tamanho.
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  const len = Math.max(ab.length, bb.length)
  const pa = Buffer.alloc(len, 0)
  const pb = Buffer.alloc(len, 0)
  ab.copy(pa)
  bb.copy(pb)
  return timingSafeEqual(pa, pb) && ab.length === bb.length
}

function normalizePhone(raw: unknown): string {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return ''
  let d = digits
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 10) d = d.slice(0, 2) + '9' + d.slice(2)
  if (d.length !== 11) return ''
  return `+55${d}`
}

interface HotmartTrackingPayload {
  src: string
  sck: string
  xcod: string
}

/**
 * Enriquece o tracking (sck/xcod/src) pela sales/history — o payload do webhook
 * nem sempre traz `origin.sck`. Credencial é POR PROJETO (multi-tenant).
 * Falha aqui NUNCA derruba a ingestão: sem tracking, cai no sck do payload.
 */
async function fetchHotmartTracking(
  wsId: string,
  transaction: string,
): Promise<HotmartTrackingPayload | null> {
  if (!transaction) return null
  try {
    const cfg = await getHotmartConfig(wsId)
    if (!cfg) return null
    const token = await getHotmartToken(cfg)
    if (!token) return null
    return await fetchSaleTracking(token, transaction)
  } catch (error) {
    log.error('[webhook/hotmart] Falha ao enriquecer transação', { transaction, error })
    return null
  }
}

export async function POST(req: NextRequest) {
  // Mandatory: sem env, recusar. (Hotmart envia "hottok" estático no header — não
  // assina o body via HMAC. timing-safe compare evita oracle de tamanho/conteúdo
  // do secret. Body size cap reduz superfície de DoS via payload gigante.)
  // Multi-tenant: o token recebido decide o PROJETO dono da venda. DEMO = env;
  // cliente = webhookToken da cred 'hotmart' dele. Nenhum match → 401.
  const token = req.headers.get('x-hotmart-webhook-token') ?? req.headers.get('x-hotmart-hottok') ?? ''
  const wsId = await resolveHotmartWorkspace(token)
  if (!wsId) {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
    await audit({
      action: 'webhook.hotmart.auth_failed',
      status: 'denied',
      ip,
      userAgent: req.headers.get('user-agent') ?? null,
      resource: '/api/webhook/hotmart',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Limite de body — recusa antes de parse JSON pra evitar gastar CPU.
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large' }, { status: 413 })
  }
  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large' }, { status: 413 })
  }

  let rawBody: unknown
  try {
    rawBody = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Valida esqueleto mínimo do payload Hotmart. Schema é passthrough, então
  // campos extras (commissions, buyer, product, etc.) seguem por dentro de body.
  const parsed = parseValue(rawBody, hotmartWebhookSchema)
  if (!parsed.ok) {
    const r = badRequest(parsed)
    return NextResponse.json(r.body, { status: r.status })
  }
  const body = parsed.data as Record<string, unknown>

  const event = (body.event as string) ?? ''
  // Só conta receita quando o pagamento é CONFIRMADO. PURCHASE_BILLET_PRINTED
  // (boleto impresso, ainda NÃO pago) foi removido: sem `status` no insert ele
  // caía no default 'approved' e inflava a receita até (e SE) o EXPIRED chegar.
  // Boleto pago dispara PURCHASE_APPROVED → é inserido aqui normalmente.
  const approved = ['PURCHASE_COMPLETE', 'PURCHASE_APPROVED']
  // Eventos de estorno/cancelamento — marcam a transação como não-receita.
  const REFUND_EVENTS: Record<string, string> = {
    PURCHASE_REFUNDED: 'refunded',
    PURCHASE_CHARGEBACK: 'chargeback',
    PURCHASE_PROTEST: 'protest',
    PURCHASE_CANCELED: 'canceled',
    PURCHASE_EXPIRED: 'canceled',
  }
  if (!approved.includes(event) && !(event in REFUND_EVENTS)) {
    return NextResponse.json({ ok: true, msg: `Evento ${event} ignorado` })
  }

  // Estrutura real do payload Hotmart v2
  const data     = (body.data ?? {}) as Record<string, unknown>
  const purchase = (data.purchase ?? {}) as Record<string, unknown>

  // Estorno/cancelamento: marca a transação existente como não-receita (sai de
  // TODOS os agregados via filtro central em _transacoesCore). Não deleta — preserva
  // o registro pra auditoria. Refund antes da compra existir = no-op (0 linhas).
  if (event in REFUND_EVENTS) {
    const hotmartIdRef = String(purchase.transaction ?? '')
    if (!hotmartIdRef) return NextResponse.json({ ok: true, msg: 'estorno sem transaction ID' })
    const supabaseRef = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { error: refErr } = await supabaseRef
      .from('transacoes')
      .update({ status: REFUND_EVENTS[event] })
      .eq('workspace_id', wsId)
      .eq('hotmart_id', hotmartIdRef)
    if (refErr) {
      log.error('[webhook/hotmart] erro ao marcar estorno', { hotmartId: hotmartIdRef, event, message: refErr.message })
      return NextResponse.json({ error: refErr.message }, { status: 500 })
    }
    // Tombstone permanente: faz o estorno sobreviver à entrega FORA DE ORDEM
    // (refund antes do approved → update de 0 linhas) e a duplicatas do approved.
    // O caminho do APPROVED consulta este tombstone antes de inserir. 500 em erro
    // → o Hotmart re-tenta (tombstone é crítico p/ não voltar a contar receita).
    const { error: tombErr } = await supabaseRef
      .from('hotmart_refund_tombstones')
      .upsert(
        { workspace_id: wsId, hotmart_id: hotmartIdRef, status: REFUND_EVENTS[event], event },
        { onConflict: 'workspace_id,hotmart_id' }
      )
    if (tombErr) {
      log.error('[webhook/hotmart] erro ao gravar tombstone de estorno', { hotmartId: hotmartIdRef, event, message: tombErr.message })
      return NextResponse.json({ error: tombErr.message }, { status: 500 })
    }
    revalidateTag('sb-transacoes', 'max')
    log.info('[webhook/hotmart] transação marcada como estornada', { hotmartId: hotmartIdRef, status: REFUND_EVENTS[event] })
    return NextResponse.json({ ok: true, msg: `Estorno aplicado: ${REFUND_EVENTS[event]}` })
  }
  const buyer    = (data.buyer ?? {}) as Record<string, unknown>
  const product  = (data.product ?? {}) as Record<string, unknown>
  const origin   = (purchase.origin ?? {}) as Record<string, unknown>
  const payment  = (purchase.payment ?? {}) as Record<string, unknown>
  const offer    = (purchase.offer ?? {}) as Record<string, unknown>
  const commissions = (data.commissions ?? []) as Array<{ value: number; source: string }>

  const parcelasNum = parseInt(String(payment.installments_number ?? 1)) || 1
  const precoValue = parseFloat(String((purchase.price as Record<string, unknown>)?.value ?? 0))
  const valorBruto = normalizeValorBruto(precoValue, String(payment.type ?? ''), parcelasNum)

  const hotmartId = String(purchase.transaction ?? '')
  if (!hotmartId) {
    return NextResponse.json({ error: 'transaction ID ausente' }, { status: 400 })
  }

  // Descarte SÓ por marcador de teste da Hotmart — nunca por valor.
  // Histórico: até 21/07/2026 aqui havia `if (valorBruto <= 1) return 200`, que
  // engoliu 48 vendas reais de R$1 (campanhas de reativação) sem rastro nenhum —
  // e como o 200 sinaliza "entregue", a Hotmart nunca reenviava. Todo descarte
  // agora é AUDITADO: nenhuma venda volta a sumir em silêncio.
  if (isTestSale({ transaction: hotmartId, productId: product.id, productName: String(product.name ?? '') })) {
    await audit({
      action: 'webhook.hotmart.test_ignored',
      resource: '/api/webhook/hotmart',
      metadata: { hotmartId, event, produto: String(product.name ?? ''), valorBruto },
    })
    return NextResponse.json({ ok: true, msg: 'Transação de teste ignorada' })
  }

  // Líquido do produtor vem em data.commissions[].source === 'PRODUCER'
  // #20 — NULL quando commissions ausente: 0 é enganoso (valor DESCONHECIDO ≠ zero).
  // Se a coluna transacoes.valor_liquido_expert for NOT NULL no banco, rodar
  // migration 0049_valor_liquido_expert_nullable.sql antes de deployar esta versão.
  const producerComm = commissions.find((c) => c.source === 'PRODUCER')
  const valorLiquidoExpert = producerComm?.value ?? null

  const orderTs = purchase.order_date as number ?? purchase.approved_date as number
  const dataCompra = parseDateBR(orderTs)
  const enrichedTracking = await fetchHotmartTracking(wsId, hotmartId)

  // SCK e XCOD já costumam vir no webhook; `src` pode vir do sales/history.
  const rawSck = enrichedTracking?.sck || String(origin.sck ?? '')
  const rawXcod = enrichedTracking?.xcod || String(origin.xcod ?? '')
  const src = enrichedTracking?.src || ''

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Mesma função que a reconciliação usa → linha reparada pelo cron é
  // indistinguível da que veio pelo push.
  const baseRecord = await buildTransacaoRecord(supabase, wsId, {
    transaction:        hotmartId,
    orderTs,
    priceValue:         precoValue,
    paymentType:        String(payment.type ?? ''),
    parcelas:           parcelasNum,
    buyerName:          String(buyer.name ?? ''),
    buyerEmail:         String(buyer.email ?? ''),
    productName:        String(product.name ?? offer.code ?? ''),
    productId:          product.id != null ? String(product.id) : '',
    rawSck,
    valorLiquidoExpert,
  })

  const criativo = baseRecord.criativo
  const adId = baseRecord.ad_id ?? ''
  const ultimoImpactoMedium = baseRecord.utm_medium_ultimo.toLowerCase()
  const isPaidTraffic = ultimoImpactoMedium.includes('pago')
  const isMetaAdsTraffic = ultimoImpactoMedium.includes('pago-metaads')
  const chaveUnicaPos3103 =
    dataCompra && dataCompra >= '2026-03-31' && adId
      ? `${adId}_${dataCompra}`
      : ''

  // Estorno pode ter chegado ANTES desta compra (entrega fora de ordem) — respeita
  // o tombstone pra a transação já nascer como não-receita (não infla o Lucro).
  const { data: refundTomb, error: tombReadErr } = await supabase
    .from('hotmart_refund_tombstones')
    .select('status')
    .eq('workspace_id', wsId)
    .eq('hotmart_id', hotmartId)
    .maybeSingle()
  // fail-closed: se a leitura do tombstone falha, NÃO inserir (o upsert nasceria com
  // status default = receita e uma transação estornada voltaria a contar). 500 → a
  // Hotmart re-tenta.
  if (tombReadErr) {
    log.error('[webhook/hotmart] erro ao ler tombstone', { hotmartId, message: tombReadErr.message })
    return NextResponse.json({ error: tombReadErr.message }, { status: 500 })
  }

  const record = {
    ...baseRecord,
    // se houver tombstone de estorno, a transação nasce já não-receita (order-independent)
    ...(refundTomb ? { status: refundTomb.status } : {}),
  }

  const { error } = await supabase
    .from('transacoes')
    .upsert(record, { onConflict: 'hotmart_id' })

  if (error) {
    log.error('[webhook/hotmart] Erro ao inserir transacao', { hotmartId, message: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fecha o race read-check-then-insert: se um REFUND gravou o tombstone ENTRE o
  // SELECT acima e este upsert, a transação teria nascido como receita. Re-lê o
  // tombstone e, se agora existe, reaplica o status de estorno.
  if (!refundTomb) {
    const { data: tombAfter } = await supabase
      .from('hotmart_refund_tombstones')
      .select('status')
      .eq('workspace_id', wsId)
      .eq('hotmart_id', hotmartId)
      .maybeSingle()
    if (tombAfter) {
      await supabase
        .from('transacoes')
        .update({ status: tombAfter.status })
        .eq('workspace_id', wsId)
        .eq('hotmart_id', hotmartId)
    }
  }

  // Push de nova venda (best-effort; tag dedupa duplicata do webhook no device).
  await sendPush(
    { title: 'Nova venda 🎉', body: `${record.produto || 'Produto'} · R$ ${valorBruto.toFixed(2)}`, url: '/', tag: `venda-${hotmartId}` },
    wsId,
  ).catch(() => {})

  // Salva comprador na qualificacao (só preenche whatsapp se ainda não tem)
  const buyerEmail = record.email
  const buyerPhone = normalizePhone((buyer as Record<string, unknown>).checkout_phone ?? (buyer as Record<string, unknown>).phone)
  if (buyerEmail) {
    const { data: existing } = await supabase
      .from('qualificacao')
      .select('email,whatsapp')
      .eq('workspace_id', wsId)
      .eq('email', buyerEmail)
      .maybeSingle() as { data: { email: string; whatsapp: string | null } | null }

    const qualRecord: Record<string, unknown> = { workspace_id: wsId, email: buyerEmail, nome: record.nome }
    // Só atualiza whatsapp se tiver número e o existente estiver vazio
    if (buyerPhone && !existing?.whatsapp) qualRecord.whatsapp = buyerPhone

    // onConflict 'email' mantido (DEMO-safe; vira 'workspace_id,email' no gate de DDL
    // antes do 2º cliente — senão um lead de mesmo email colidiria entre projetos).
    await supabase.from('qualificacao').upsert(qualRecord, { onConflict: 'workspace_id,email', ignoreDuplicates: false })
  }

  revalidateTag('sb-transacoes', 'max')

  log.info('[webhook/hotmart] ok', {
    hotmartId,
    produto: record.produto,
    valorBruto,
    paid: isPaidTraffic,
    meta: isMetaAdsTraffic,
    criativo: criativo || null,
    chave: chaveUnicaPos3103 || null,
    xcod: rawXcod || null,
    src: src || null,
  })

  await audit({
    action: 'webhook.hotmart.purchase',
    resource: '/api/webhook/hotmart',
    metadata: {
      hotmartId,
      event,
      produto: record.produto,
      valorBruto,
      paid: isPaidTraffic,
      meta: isMetaAdsTraffic,
    },
  })

  return NextResponse.json({
    ok: true,
    hotmart_id: hotmartId,
    criativo,
    is_paid_traffic: isPaidTraffic,
    is_meta_ads_traffic: isMetaAdsTraffic,
    chave_unica_pos_3103: chaveUnicaPos3103 || null,
    src: src || null,
  })
}
