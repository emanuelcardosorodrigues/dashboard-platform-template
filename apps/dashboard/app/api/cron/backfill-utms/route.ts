/**
 * Backfill do pacote de origem (migration 0068) a partir da sales/history.
 *
 * POR QUE EXISTE: até a 0068, `transacoes` só tinha utm_source e utm_medium. O
 * sck que a Hotmart devolve SEMPRE trouxe campaign (posição 3/10), content (4/11)
 * e o resto — o valor era extraído pelo parseSck e descartado na gravação, por
 * falta de coluna. Ou seja: o dado histórico não está perdido, está na Hotmart.
 * A sales/history devolve `purchase.tracking.source_sck` por transação, que é
 * exatamente a string original.
 *
 * Escopo deliberadamente ESTREITO: preenche só as colunas da 0068 (+ sck_raw e
 * utms). Não toca em `criativo`, `ad_id` nem `sck_slug` — reescrever atribuição
 * consolidada é outro problema, com outro risco. Quem preenche sck_slug vazio é
 * o /api/admin/backfill-sck.
 *
 * Idempotente: só pega linha com `sck_raw IS NULL`, e só grava quando a API
 * devolve sck. Linha sem sck na Hotmart (venda sem tracking) fica pendente para
 * sempre — por isso a resposta separa `sem_sck` de `restantes`, senão um lote que
 * só encontra vendas sem tracking pareceria travado.
 *
 * Uma chamada HTTP por transação (a sales/history não aceita lote por id), então
 * roda em lotes: GET ?ws=<uuid|slug>&limit=100 até `restantes` chegar a 0.
 * Bearer CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getHotmartConfig } from '@/lib/integrations/factory'
import { resolveWsParam } from '@/lib/organico/resolveWs'
import { parseSck } from '@/lib/hotmartSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HOTMART_AUTH_URL = 'https://api-sec-vlc.hotmart.com/security/oauth/token'
const HOTMART_SALES_HISTORY_URL = 'https://developers.hotmart.com/payments/api/v1/sales/history'

async function getToken(clientId: string, clientSecret: string): Promise<string | null> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`${HOTMART_AUTH_URL}?grant_type=client_credentials`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const json = (await res.json()) as { access_token?: string }
  return json.access_token ?? null
}

/**
 * sck ORIGINAL da transação.
 *
 * O retorno distingue TRÊS situações que a primeira versão confundia numa só
 * (string vazia), e a confusão custou caro: um erro de transporte era lido como
 * "venda sem tracking", a linha era marcada como respondida e saía da fila para
 * sempre. Falha de rede nunca pode virar fato sobre o dado.
 *   ok:true  + sck:'...'  → a Hotmart devolveu tracking
 *   ok:true  + sck:''     → a Hotmart respondeu e esta venda REALMENTE não tem
 *   ok:false              → não deu pra saber (HTTP ruim, item ausente, parse) → re-fila
 */
interface ResultadoSck { ok: boolean; sck: string; status: number; motivo?: string }

async function fetchSckRaw(token: string, hotmartId: string): Promise<ResultadoSck> {
  const url = new URL(HOTMART_SALES_HISTORY_URL)
  url.searchParams.set('transaction', hotmartId)
  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, sck: '', status: 0, motivo: `rede: ${(e as Error).message}` }
  }
  if (!res.ok) {
    const corpo = await res.text().catch(() => '')
    return { ok: false, sck: '', status: res.status, motivo: corpo.slice(0, 160) }
  }
  let json: { items?: Array<{ purchase?: { tracking?: { source_sck?: string } } }> }
  try {
    json = (await res.json()) as typeof json
  } catch {
    return { ok: false, sck: '', status: res.status, motivo: 'resposta não-JSON' }
  }
  // Sem item = a query não encontrou a transação. Isso é ausência de RESPOSTA
  // sobre ela, não afirmação de que não tem tracking — re-fila.
  if (!json.items || json.items.length === 0) {
    return { ok: false, sck: '', status: res.status, motivo: 'transação não encontrada na sales/history' }
  }
  return { ok: true, sck: String(json.items[0]?.purchase?.tracking?.source_sck ?? ''), status: res.status }
}

/**
 * `?probe=1` — descobre QUAL forma de chamar a sales/history a Hotmart aceita
 * hoje, em vez de adivinhar. Roda as variações contra UMA transação real e
 * devolve status + trecho do corpo de cada uma. Somente leitura.
 *
 * Existe porque a chamada `?transaction=<id>` sozinha — a que o webhook também
 * usa em fetchSaleTracking — passou a responder 400 invalid_parameter.
 */
async function probe(token: string, hotmartId: string) {
  const agora = Date.now()
  const doisAnos = agora - 730 * 24 * 3600 * 1000
  const BASE = 'https://developers.hotmart.com/payments/api/v1'
  const variantes: Array<{ nome: string; url?: string; accept?: boolean; params: Record<string, string> }> = [
    { nome: 'transaction', params: { transaction: hotmartId } },
    { nome: 'janela_7d', params: { start_date: String(agora - 7 * 864e5), end_date: String(agora) } },
    { nome: 'janela_30d', params: { start_date: String(agora - 30 * 864e5), end_date: String(agora) } },
    { nome: 'janela_90d', params: { start_date: String(agora - 90 * 864e5), end_date: String(agora) } },
    { nome: 'janela_7d+max', params: { start_date: String(agora - 7 * 864e5), end_date: String(agora), max_results: '10' } },
    { nome: 'transaction+status', params: { transaction: hotmartId, transaction_status: 'APPROVED' } },
    { nome: 'accept_json', params: { transaction: hotmartId }, accept: true },
    { nome: 'summary_7d', url: `${BASE}/sales/summary`, params: { start_date: String(agora - 7 * 864e5), end_date: String(agora) } },
  ]
  const out: Array<Record<string, unknown>> = []

  // CONTROLE NEGATIVO — a mesma chamada com um token obviamente inválido.
  // Se o token lixo receber 401 e o nosso 400, o 400 é sobre o PEDIDO.
  // Se ambos receberem 400, o 400 é como esta API responde a credencial sem
  // acesso — e o problema está no app/permissão da Hotmart, não no código.
  try {
    const u = new URL(HOTMART_SALES_HISTORY_URL)
    u.searchParams.set('transaction', hotmartId)
    const res = await fetch(u.toString(), { headers: { Authorization: 'Bearer token-invalido-de-proposito' }, cache: 'no-store' })
    out.push({ variante: 'CONTROLE token invalido', status: res.status, corpo: (await res.text()).slice(0, 200) })
  } catch (e) {
    out.push({ variante: 'CONTROLE token invalido', erro: (e as Error).message })
  }
  out.push({ variante: 'token obtido', tamanho: token.length, prefixo: token.slice(0, 4) })

  // A Hotmart entrega um "Basic" PRÓPRIO no painel, e existe env HOTMART_CLIENT_BASIC
  // que nenhum código usa — montamos o nosso a partir de id:secret. Se os dois
  // diferirem, o token que obtemos pode ser de outro app (autentica, mas não vê as
  // vendas — exatamente o sintoma). Compara por hash e testa o token do basic oficial.
  const basicEnv = (process.env.HOTMART_CLIENT_BASIC ?? '').trim()
  if (basicEnv) {
    const { createHash } = await import('node:crypto')
    const h = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 8)
    const basicMontado = Buffer.from(`${process.env.HOTMART_CLIENT_ID}:${process.env.HOTMART_CLIENT_SECRET}`).toString('base64')
    out.push({
      variante: 'basic: env vs montado',
      iguais: h(basicEnv) === h(basicMontado),
      env_sha8: h(basicEnv), montado_sha8: h(basicMontado),
    })
    try {
      const r = await fetch(`${HOTMART_AUTH_URL}?grant_type=client_credentials`, {
        method: 'POST', headers: { Authorization: `Basic ${basicEnv}` }, cache: 'no-store',
      })
      const tk = r.ok ? ((await r.json()) as { access_token?: string }).access_token : null
      if (!tk) {
        out.push({ variante: 'token via BASIC do painel', status: r.status, obs: 'nao obteve token' })
      } else {
        const u = new URL(HOTMART_SALES_HISTORY_URL)
        u.searchParams.set('transaction', hotmartId)
        const res2 = await fetch(u.toString(), { headers: { Authorization: `Bearer ${tk}` }, cache: 'no-store' })
        const corpo = await res2.text()
        out.push({ variante: 'sales/history com BASIC do painel', status: res2.status, corpo: res2.ok ? 'OK — RESPONDEU' : corpo.slice(0, 200) })
      }
    } catch (e) {
      out.push({ variante: 'token via BASIC do painel', erro: (e as Error).message })
    }
  } else {
    out.push({ variante: 'basic do painel', obs: 'HOTMART_CLIENT_BASIC ausente no runtime' })
  }

  for (const v of variantes) {
    const url = new URL(v.url ?? HOTMART_SALES_HISTORY_URL)
    for (const [k, val] of Object.entries(v.params)) url.searchParams.set(k, val)
    try {
      const res = await fetch(url.toString(), { headers: v.accept ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const corpo = await res.text()
      let temTracking: unknown = null
      let itens: unknown = null
      try {
        const j = JSON.parse(corpo) as { items?: Array<{ purchase?: { tracking?: unknown } }> }
        itens = j.items?.length ?? 0
        temTracking = j.items?.[0]?.purchase?.tracking ? 'sim' : 'nao'
      } catch { /* corpo não-JSON */ }
      out.push({ variante: v.nome, status: res.status, itens, tracking: temTracking, corpo: res.ok ? undefined : corpo.slice(0, 500) })
    } catch (e) {
      out.push({ variante: v.nome, erro: (e as Error).message })
    }
  }
  return out
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  if (!isVercelCron && (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = new URL(req.url).searchParams
  const workspaceId = await resolveWsParam(sp.get('ws'))
  const limit = Math.min(500, Math.max(1, Number(sp.get('limit') ?? 100)))

  const cfg = await getHotmartConfig(workspaceId)
  if (!cfg) return NextResponse.json({ error: 'sem credencial Hotmart para este projeto' }, { status: 400 })

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  const { count: pendentes } = await supabase
    .from('transacoes')
    .select('hotmart_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .is('sck_raw', null)

  const { data: rows, error } = await supabase
    .from('transacoes')
    .select('hotmart_id')
    .eq('workspace_id', workspaceId)
    .is('sck_raw', null)
    .order('data', { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows?.length) return NextResponse.json({ ok: true, processados: 0, restantes: 0, msg: 'nada pendente' })

  const token = await getToken(cfg.clientId, cfg.clientSecret)
  if (!token) return NextResponse.json({ error: 'falha ao obter token Hotmart' }, { status: 502 })

  if (sp.get('probe') === '1') {
    const alvo = (rows as Array<{ hotmart_id: string }>)[0].hotmart_id
    return NextResponse.json({ probe: alvo, variantes: await probe(token, alvo) })
  }

  let atualizados = 0
  let semSck = 0
  let comCampaign = 0
  let naoRespondido = 0
  const porStatus: Record<string, number> = {}
  const erros: string[] = []

  for (const row of rows as Array<{ hotmart_id: string }>) {
    try {
      const r = await fetchSckRaw(token, row.hotmart_id)
      if (!r.ok) {
        // NÃO grava nada: a linha continua com sck_raw NULL e volta na próxima
        // rodada. Um lote inteiro assim significa problema de credencial/endpoint,
        // e a resposta precisa gritar isso em vez de parecer trabalho feito.
        naoRespondido++
        const chave = `${r.status}`
        porStatus[chave] = (porStatus[chave] ?? 0) + 1
        if (erros.length < 5 && r.motivo) erros.push(`${row.hotmart_id} [${r.status}]: ${r.motivo}`)
        continue
      }
      const raw = r.sck
      if (!raw) {
        // A Hotmart respondeu e esta venda realmente não tem tracking. Aí sim
        // marca como respondida, para não gastar a mesma chamada para sempre.
        await supabase.from('transacoes').update({ sck_raw: '' })
          .eq('workspace_id', workspaceId).eq('hotmart_id', row.hotmart_id)
        semSck++
        continue
      }
      const p = parseSck(raw)
      if (p.utmCampaign) comCampaign++
      const { error: upErr } = await supabase
        .from('transacoes')
        .update({
          sck_raw: raw,
          utms: Object.keys(p.todas).length > 0 ? p.todas : null,
          utm_campaign_ultimo: p.utmCampaign,
          utm_content_ultimo: p.utmContent,
          utm_term_ultimo: p.utmTerm,
          utm_placement_ultimo: p.todas['utm_placement'] ?? '',
          utm_campaign_primeiro: p.utmCampaignPrim,
          utm_content_primeiro: p.utmContentPrim,
          utm_term_primeiro: p.utmTermPrim,
          utm_placement_primeiro: p.todas['utm_placement_primeiro'] ?? '',
        })
        .eq('workspace_id', workspaceId)
        .eq('hotmart_id', row.hotmart_id)
      if (upErr) erros.push(`${row.hotmart_id}: ${upErr.message}`)
      else atualizados++
    } catch (e) {
      erros.push(`${row.hotmart_id}: ${String(e)}`)
    }
  }

  // `avancou` é o que o orquestrador precisa saber: linhas que saíram da fila.
  // Sem isso, um lote 100% não-respondido pareceria progresso e o laço giraria
  // para sempre repetindo as mesmas transações.
  const avancou = atualizados + semSck
  return NextResponse.json({
    ok: true,
    processados: rows.length,
    atualizados,
    sem_sck: semSck,
    nao_respondido: naoRespondido,
    por_status: porStatus,
    avancou,
    com_utm_campaign: comCampaign,
    restantes: Math.max(0, (pendentes ?? 0) - avancou),
    erros: erros.slice(0, 10),
  })
}
