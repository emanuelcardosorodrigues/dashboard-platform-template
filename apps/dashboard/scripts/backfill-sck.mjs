// Uso: node scripts/backfill-sck.mjs [YYYY-MM-DD]
// Ex:  node scripts/backfill-sck.mjs 2026-04-26

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Carrega .env.local manualmente
const envPath = resolve(process.cwd(), '.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const [key, ...rest] = line.split('=')
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const HOTMART_CLIENT_ID = process.env.HOTMART_CLIENT_ID
const HOTMART_CLIENT_SECRET = process.env.HOTMART_CLIENT_SECRET

const dataFiltro = process.argv[2] || new Date().toISOString().slice(0, 10)
console.log(`\n🔍 Backfill sck_slug para data: ${dataFiltro}\n`)

async function getHotmartToken() {
  const auth = Buffer.from(`${HOTMART_CLIENT_ID}:${HOTMART_CLIENT_SECRET}`).toString('base64')
  const res = await fetch('https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  })
  const json = await res.json()
  return json.access_token ?? null
}

async function fetchSck(token, hotmartId) {
  const url = `https://developers.hotmart.com/payments/api/v1/sales/history?transaction=${hotmartId}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return ''
  const json = await res.json()
  const rawSck = String(json.items?.[0]?.purchase?.tracking?.source_sck ?? '')
  if (!rawSck) return ''
  const p = rawSck.split('|')
  return p[0] && p[0] !== '0' ? p[0] : ''
}

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(options.headers ?? {}),
    },
  })
  if (options.method === 'PATCH') return res
  return res.json()
}

const rows = await supabaseFetch(
  `/transacoes?select=hotmart_id&data=eq.${dataFiltro}&or=(sck_slug.is.null,sck_slug.eq.)`
)

if (!Array.isArray(rows) || rows.length === 0) {
  console.log('✅ Nenhuma transação pendente para essa data.')
  process.exit(0)
}

console.log(`📦 ${rows.length} transação(ões) encontrada(s) sem sck_slug\n`)

const token = await getHotmartToken()
if (!token) { console.error('❌ Falha ao obter token Hotmart'); process.exit(1) }

let updated = 0, skipped = 0

for (const row of rows) {
  const sckSlug = await fetchSck(token, row.hotmart_id)
  if (!sckSlug) {
    console.log(`  ⚠️  ${row.hotmart_id} — sck não encontrado na Hotmart`)
    skipped++
    continue
  }

  await supabaseFetch(`/transacoes?hotmart_id=eq.${row.hotmart_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ sck_slug: sckSlug }),
  })

  console.log(`  ✅ ${row.hotmart_id} → ${sckSlug}`)
  updated++
}

console.log(`\nConcluído: ${updated} atualizado(s), ${skipped} sem sck na Hotmart.\n`)
