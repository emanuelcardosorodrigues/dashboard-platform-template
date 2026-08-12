/**
 * Backfill pontual: insere em `transacoes` as vendas que existem na Hotmart e
 * nunca chegaram ao dashboard.
 *
 * Origem do buraco: o webhook descartava `valorBruto <= 1` como "teste" e
 * devolvia HTTP 200 — a Hotmart marcava como entregue e nunca reenviava.
 *
 * Usa EXATAMENTE as mesmas funções do cron /api/cron/reconcile-hotmart
 * (lib/hotmartSync.ts), então a linha reparada é idêntica à do caminho normal.
 *
 *   node scripts/backfill-hotmart-faltantes.ts 2026-01-01 2026-07-21          # dry-run
 *   node scripts/backfill-hotmart-faltantes.ts 2026-01-01 2026-07-21 --apply  # grava
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
} from '../lib/hotmartSync.ts'

// ─── env ─────────────────────────────────────────────────────────────────────
const envPath = path.join(import.meta.dirname, '..', '.env.local')
for (const linha of fs.readFileSync(envPath, 'utf8').split('\n')) {
  if (!linha.includes('=') || linha.trim().startsWith('#')) continue
  const i = linha.indexOf('=')
  const k = linha.slice(0, i).trim()
  if (!process.env[k]) process.env[k] = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const [, , FROM = '2026-01-01', TO = '2026-07-21'] = process.argv
const APPLY = process.argv.includes('--apply')
const ms = (d: string, end = false) => new Date(`${d}T${end ? '23:59:59' : '00:00:00'}-03:00`).getTime()

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ─── workspace ───────────────────────────────────────────────────────────────
const slug = (process.env.DEFAULT_WORKSPACE_SLUG || 'demo').trim()
const { data: ws, error: wsErr } = await supabase.from('workspaces').select('id,slug').eq('slug', slug).maybeSingle()
if (wsErr || !ws) throw new Error(`workspace '${slug}' não encontrado: ${wsErr?.message ?? 'ausente'}`)
const wsId = ws.id as string
console.log(`workspace: ${ws.slug} (${wsId})`)

// ─── Hotmart ─────────────────────────────────────────────────────────────────
const token = await getHotmartToken({
  clientId: process.env.HOTMART_CLIENT_ID!,
  clientSecret: process.env.HOTMART_CLIENT_SECRET!,
})
if (!token) throw new Error('não obtive access_token da Hotmart')

const itens = await fetchSalesHistoryRange(token, ms(FROM), ms(TO, true))

const porTransacao = new Map<string, SalesHistoryItem>()
let ignoradasTeste = 0
for (const it of itens) {
  const id = String(it.purchase?.transaction ?? '')
  if (!id || porTransacao.has(id)) continue
  if (!HOTMART_REVENUE_STATUSES.has(String(it.purchase?.status ?? ''))) continue
  if (isTestSale({ transaction: id, productId: it.product?.id, productName: it.product?.name })) { ignoradasTeste++; continue }
  porTransacao.set(id, it)
}

// ─── diff ────────────────────────────────────────────────────────────────────
const ids = [...porTransacao.keys()]
const existentes = new Set<string>()
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await supabase
    .from('transacoes').select('hotmart_id')
    .eq('workspace_id', wsId).in('hotmart_id', ids.slice(i, i + 200))
  if (error) throw new Error(`select transacoes: ${error.message}`)
  for (const r of data ?? []) existentes.add(r.hotmart_id as string)
}
const faltantes = ids.filter((id) => !existentes.has(id))

console.log(`\njanela ${FROM} → ${TO}`)
console.log(`Hotmart (receita, dedup): ${ids.length}   | postbacks de teste ignorados: ${ignoradasTeste}`)
console.log(`já no dashboard:          ${existentes.size}`)
console.log(`FALTANDO:                 ${faltantes.length}`)
if (!APPLY) console.log('\n*** DRY-RUN — nada foi gravado. Rode com --apply para inserir. ***')

// tombstones de estorno: linha reparada nasce como não-receita
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
  const produto = String(item.product?.name ?? '')
  try {
    const tracking = await fetchSaleTracking(token, id)
    const record = await buildTransacaoRecord(supabase, wsId, saleFromHistoryItem(item, tracking?.sck ?? ''))
    const tomb = tombstones.get(id)
    const linha = { ...record, ...(tomb ? { status: tomb } : {}) }

    if (APPLY) {
      const { error } = await supabase.from('transacoes').upsert(linha, { onConflict: 'hotmart_id' })
      if (error) throw new Error(error.message)
      inseridas++
    }
    console.log(`${APPLY ? 'OK  ' : 'DRY '} ${dia}  ${id.padEnd(16)} R$ ${String(valor).padStart(8)}  ${record.sck_slug || '(sem sck)'}  ${produto}`)
  } catch (e) {
    erros++
    console.error(`ERRO ${dia}  ${id}  ${(e as Error).message}`)
  }
}

console.log(`\n${APPLY ? `inseridas: ${inseridas}` : `seriam inseridas: ${faltantes.length}`}   erros: ${erros}`)
