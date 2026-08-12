// Uso: node scripts/backfill-ad-id.mjs [YYYY-MM-DD]
// Se data fornecida: só transações daquele dia. Sem data: tudo onde ad_id é NULL.
//
// Pra cada transação sem ad_id, busca o sales/history da Hotmart e extrai:
//   - ad_id (índice 6 do sck = último impacto)
//   - ad_id_primeiro (índice 13 do sck = primeiro impacto)
//   - criativo_primeiro (lookup do ad_id_primeiro em meta_ads)
// Salva tudo em transacoes.

import { readFileSync } from 'fs'
import { resolve } from 'path'

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

const dataFiltro = process.argv[2] || null
console.log(`\nBackfill ad_id ${dataFiltro ? `para data ${dataFiltro}` : '(todas as transações sem ad_id)'}\n`)

async function getHotmartToken() {
  const auth = Buffer.from(`${HOTMART_CLIENT_ID}:${HOTMART_CLIENT_SECRET}`).toString('base64')
  const res = await fetch('https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  })
  const json = await res.json()
  return json.access_token ?? null
}

function cleanAdId(value) {
  if (!value || value === '0' || value === 'null') return ''
  if (!/^\d+$/.test(value)) return ''
  return value
}

async function fetchAdIds(token, hotmartId) {
  const url = `https://developers.hotmart.com/payments/api/v1/sales/history?transaction=${hotmartId}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { adId: '', adIdPrim: '' }
  const json = await res.json()
  const rawSck = String(json.items?.[0]?.purchase?.tracking?.source_sck ?? '')
  if (!rawSck) return { adId: '', adIdPrim: '' }
  const p = rawSck.split('|')
  return { adId: cleanAdId(p[6]), adIdPrim: cleanAdId(p[13]) }
}

const adNameCache = new Map()
async function resolveAdName(adId, txDate) {
  if (!adId) return ''
  const cacheKey = `${adId}|${txDate}`
  if (adNameCache.has(cacheKey)) return adNameCache.get(cacheKey)

  let row = await supabaseFetch(`/meta_ads?select=ad_name&ad_id=eq.${adId}&data=eq.${txDate}&limit=1`)
  let name = Array.isArray(row) && row[0]?.ad_name ? row[0].ad_name : ''
  if (!name) {
    row = await supabaseFetch(`/meta_ads?select=ad_name,data&ad_id=eq.${adId}&data=lte.${txDate}&order=data.desc&limit=1`)
    name = Array.isArray(row) && row[0]?.ad_name ? row[0].ad_name : ''
  }
  if (!name) {
    row = await supabaseFetch(`/meta_ads?select=ad_name,data&ad_id=eq.${adId}&order=data.desc&limit=1`)
    name = Array.isArray(row) && row[0]?.ad_name ? row[0].ad_name : ''
  }
  adNameCache.set(cacheKey, name)
  return name
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

const filter = `or=(ad_id.is.null,ad_id_primeiro.is.null)${dataFiltro ? `&data=eq.${dataFiltro}` : ''}`
const rows = await supabaseFetch(`/transacoes?select=hotmart_id,data,criativo,ad_id,ad_id_primeiro,criativo_primeiro&${filter}&order=data.desc&limit=2000`)

if (!Array.isArray(rows) || rows.length === 0) {
  console.log('Nenhuma transação pendente.')
  process.exit(0)
}

console.log(`${rows.length} transação(ões) sem ad_id\n`)

const token = await getHotmartToken()
if (!token) { console.error('Falha ao obter token Hotmart'); process.exit(1) }

let updated = 0, skipped = 0, errors = 0

for (const row of rows) {
  try {
    const { adId, adIdPrim } = await fetchAdIds(token, row.hotmart_id)
    if (!adId && !adIdPrim) {
      console.log(`  -- ${row.hotmart_id} (${row.data}) — sck sem ad_ids`)
      skipped++
      continue
    }

    const patch = {}
    if (adId && !row.ad_id) patch.ad_id = adId
    if (adIdPrim && !row.ad_id_primeiro) patch.ad_id_primeiro = adIdPrim
    if (adIdPrim && !row.criativo_primeiro) {
      const name = await resolveAdName(adIdPrim, row.data)
      if (name) patch.criativo_primeiro = name
    }

    if (Object.keys(patch).length === 0) { skipped++; continue }

    const res = await supabaseFetch(`/transacoes?hotmart_id=eq.${row.hotmart_id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      console.error(`  !! ${row.hotmart_id} — patch falhou: ${res.status}`)
      errors++
      continue
    }
    console.log(`  ok ${row.hotmart_id} (${row.data}) → ${JSON.stringify(patch)}`)
    updated++
  } catch (e) {
    console.error(`  !! ${row.hotmart_id} — ${e.message}`)
    errors++
  }
  await new Promise((r) => setTimeout(r, 120))
}

console.log(`\nResultado: ${updated} atualizado(s), ${skipped} sem dado novo, ${errors} erro(s).\n`)
