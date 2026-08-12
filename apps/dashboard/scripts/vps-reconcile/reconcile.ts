/**
 * Reconciliação Hotmart → Supabase, rodando NA VPS.
 *
 * Por que não na Vercel: `developers.hotmart.com` devolve 400 invalid_parameter
 * para requisição originada da rede da Vercel, com token VÁLIDO e qualquer query.
 * Medido em 22/07/2026 com o mesmo token nas três origens — local 200, VPS 200,
 * Vercel 400. O host de auth funciona da Vercel; só o de dados recusa.
 *
 * Rede de segurança do webhook: o push é o caminho normal, este pull repara o
 * que ele perder (descarte indevido, 500, timeout, incidente). Só INSERE o que
 * está ausente — nunca sobrescreve linha existente.
 *
 *   node reconcile.ts --days 3           # janela padrão
 *   node reconcile.ts --days 30 --dry    # sem gravar
 *
 * Credenciais: systemd LoadCredentialEncrypted (CREDENTIALS_DIRECTORY) com
 * fallback pra env, pra permitir execução manual.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  HOTMART_REVENUE_STATUSES,
  buildTransacaoRecord,
  fetchSalesHistoryRange,
  fetchSaleTracking,
  getHotmartToken,
  isTestSale,
  parseDateBR,
  saleFromHistoryItem,
  type SalesHistoryItem,
} from './hotmartSync.ts'

// ─── credenciais ─────────────────────────────────────────────────────────────
function cred(nome: string, envVar: string): string {
  const dir = process.env.CREDENTIALS_DIRECTORY
  if (dir) {
    const p = path.join(dir, nome)
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim()
  }
  return (process.env[envVar] ?? '').trim()
}

const SUPABASE_URL = cred('supabase_url', 'SUPABASE_URL')
const SUPABASE_KEY = cred('supabase_service_role_key', 'SUPABASE_SERVICE_ROLE_KEY')
const HOTMART_ID = cred('hotmart_client_id', 'HOTMART_CLIENT_ID')
const HOTMART_SECRET = cred('hotmart_client_secret', 'HOTMART_CLIENT_SECRET')
const WS_SLUG = (process.env.DEFAULT_WORKSPACE_SLUG || 'demo').trim()

for (const [nome, v] of [['supabase_url', SUPABASE_URL], ['supabase_service_role_key', SUPABASE_KEY],
  ['hotmart_client_id', HOTMART_ID], ['hotmart_client_secret', HOTMART_SECRET]] as const) {
  if (!v) { console.error(`FATAL: credencial ausente: ${nome}`); process.exit(1) }
}

// ─── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const iDays = argv.indexOf('--days')
const DAYS = iDays >= 0 ? Math.min(Math.max(parseInt(argv[iDays + 1] ?? '3', 10) || 3, 1), 365) : 3

const agora = Date.now()
const inicio = new Date(agora - 3 * 3600e3)
inicio.setUTCDate(inicio.getUTCDate() - DAYS)
inicio.setUTCHours(0, 0, 0, 0)
const startMs = inicio.getTime() + 3 * 3600e3

const ts = () => new Date(Date.now() - 3 * 3600e3).toISOString().replace('T', ' ').slice(0, 19)
const logar = (m: string) => console.log(`[${ts()}] ${m}`)

// ─── execução ────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

const { data: ws, error: wsErr } = await supabase
  .from('workspaces').select('id,slug').eq('slug', WS_SLUG).maybeSingle()
if (wsErr || !ws) { console.error(`FATAL: workspace '${WS_SLUG}': ${wsErr?.message ?? 'nao encontrado'}`); process.exit(1) }
const wsId = ws.id as string

const token = await getHotmartToken({ clientId: HOTMART_ID, clientSecret: HOTMART_SECRET })
if (!token) { console.error('FATAL: auth Hotmart nao devolveu access_token'); process.exit(1) }

const itens = await fetchSalesHistoryRange(token, startMs, agora)

const porTransacao = new Map<string, SalesHistoryItem>()
let ignoradasTeste = 0
for (const it of itens) {
  const id = String(it.purchase?.transaction ?? '')
  if (!id || porTransacao.has(id)) continue
  if (!HOTMART_REVENUE_STATUSES.has(String(it.purchase?.status ?? ''))) continue
  if (isTestSale({ transaction: id, productId: it.product?.id, productName: it.product?.name })) { ignoradasTeste++; continue }
  porTransacao.set(id, it)
}

const ids = [...porTransacao.keys()]
const existentes = new Set<string>()
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await supabase
    .from('transacoes').select('hotmart_id')
    .eq('workspace_id', wsId).in('hotmart_id', ids.slice(i, i + 200))
  if (error) { console.error(`FATAL: select transacoes: ${error.message}`); process.exit(1) }
  for (const r of data ?? []) existentes.add(r.hotmart_id as string)
}
const faltantes = ids.filter((id) => !existentes.has(id))

logar(`janela ${DAYS}d | hotmart=${ids.length} no_dash=${existentes.size} faltando=${faltantes.length} teste_ignorado=${ignoradasTeste}${DRY ? ' | DRY-RUN' : ''}`)

if (faltantes.length === 0) {
  logar('nada a reparar')
  process.exit(0)
}

const tombstones = new Map<string, string>()
for (let i = 0; i < faltantes.length; i += 200) {
  const { data } = await supabase
    .from('hotmart_refund_tombstones').select('hotmart_id,status')
    .eq('workspace_id', wsId).in('hotmart_id', faltantes.slice(i, i + 200))
  for (const r of data ?? []) tombstones.set(r.hotmart_id as string, r.status as string)
}

let inseridas = 0
let erros = 0
for (const id of faltantes) {
  const item = porTransacao.get(id)!
  const dia = parseDateBR(item.purchase?.order_date ?? item.purchase?.approved_date)
  const valor = Number(item.purchase?.price?.value ?? 0)
  try {
    const tracking = await fetchSaleTracking(token, id)
    const record = await buildTransacaoRecord(supabase, wsId, saleFromHistoryItem(item, tracking?.sck ?? ''))
    const tomb = tombstones.get(id)
    if (!DRY) {
      const { error } = await supabase.from('transacoes')
        .upsert({ ...record, ...(tomb ? { status: tomb } : {}) }, { onConflict: 'hotmart_id' })
      if (error) throw new Error(error.message)
    }
    inseridas++
    logar(`  REPARADA ${dia} ${id} R$${valor} ${record.sck_slug || '(sem sck)'} ${record.produto}`)
  } catch (e) {
    erros++
    logar(`  ERRO ${dia} ${id}: ${(e as Error).message}`)
  }
}

// Reparo é INCIDENTE do webhook, não rotina: sai com código != 0 pra o
// OnFailure do systemd disparar o alerta. Reparo silencioso ninguém revisa.
logar(`fim | reparadas=${inseridas} erros=${erros}`)
if (erros > 0) process.exit(1)
if (inseridas > 0 && !DRY) {
  logar('ATENCAO: o webhook perdeu venda(s) — investigar por que o push falhou')
  process.exit(3)
}
process.exit(0)
