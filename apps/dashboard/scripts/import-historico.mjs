/**
 * Script de importação histórica: Google Sheets → Supabase
 * Roda uma vez para carregar dados históricos.
 *
 * Usage: node scripts/import-historico.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

// Carrega credenciais do JSON da service account (mais confiável que env vars)
const SA_JSON_PATH = '/Users/usuario-exemplo/Downloads/dash-claude-code-6c8a5993536b.json'
const serviceAccount = JSON.parse(readFileSync(SA_JSON_PATH, 'utf8'))

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SPREADSHEET_ID = '1xCVzvI7w2RDQJgZ30YqWHp5i3fYUXs0sAVNOfznq0-o'

// ─── Google Sheets auth ───────────────────────────────────────────────────────

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const authClient = await auth.getClient()
  return google.sheets({ version: 'v4', auth: authClient })
}

async function fetchRange(sheets, range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range })
  return res.data.values ?? []
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseNum(v) {
  if (!v) return 0
  const n = parseFloat(String(v).replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.').trim())
  return isNaN(n) ? 0 : n
}

function parseBool(v) {
  return String(v ?? '').toLowerCase() === 'sim' || v === true || v === '1'
}

function parseDate(v) {
  if (!v) return null
  // DD/MM/YYYY → YYYY-MM-DD
  const parts = String(v).split('/')
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10)
  return null
}

function parseIntSafe(v) {
  const n = parseInt(String(v ?? '0').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

// ─── Import: Meta Ads ─────────────────────────────────────────────────────────

async function importMetaAds(sheets) {
  console.log('\n📊 Buscando Dados do Meta Ads...')
  const rows = await fetchRange(sheets, "'Dados do Meta Ads'!A1:AO15000")
  if (rows.length < 2) { console.log('   Sem dados'); return }

  const h = {}
  rows[0].forEach((col, i) => { h[col.trim()] = i })

  // Helper
  const c = (row, key, fallback = -1) => {
    const idx = h[key] ?? fallback
    return idx >= 0 ? (row[idx] ?? '') : ''
  }

  const records = []
  for (const row of rows.slice(1)) {
    const data = parseDate(c(row, 'data_inicio'))
    const adId = c(row, 'ad_id')
    if (!data || !adId) continue

    const investimento = parseNum(c(row, 'Investimento Com Imposto'))
    if (investimento === 0 && parseNum(c(row, 'impressoes')) === 0) continue

    records.push({
      data,
      criativo:       c(row, 'CRIATIVO_NORMALIZADO') || c(row, 'ad_name'),
      tipo_criativo:  null,
      link_anuncio:   c(row, 'link_anuncio'),
      ad_name:        c(row, 'ad_name'),
      ad_id:          adId,
      campaign_name:  c(row, 'campaign_name'),
      adset_name:     c(row, 'adset_name'),
      investimento,
      impressoes:     parseIntSafe(c(row, 'impressoes')),
      alcance:        parseIntSafe(c(row, 'alcance')),
      views_3seg:     parseIntSafe(c(row, 'views_3seg')),
      views_95pct:    parseIntSafe(c(row, 'views_95pct')),
      cliques_link:   parseIntSafe(c(row, 'cliques_link')),
      landing_views:  parseIntSafe(c(row, 'visualizacoes_landing')),
      checkouts:      parseIntSafe(c(row, 'checkouts')),
      compras:        parseIntSafe(c(row, 'compras')),
      valor_compras:  parseNum(c(row, 'valor_compras')),
    })
  }

  // Agrega por (data, ad_id) para evitar duplicatas
  const agg = new Map()
  for (const r of records) {
    const key = `${r.data}||${r.ad_id}`
    if (!agg.has(key)) {
      agg.set(key, { ...r })
    } else {
      const e = agg.get(key)
      e.investimento   += r.investimento
      e.impressoes     += r.impressoes
      e.alcance        += r.alcance
      e.views_3seg     += r.views_3seg
      e.views_95pct    += r.views_95pct
      e.cliques_link   += r.cliques_link
      e.landing_views  += r.landing_views
      e.checkouts      += r.checkouts
      e.compras        += r.compras
      e.valor_compras  += r.valor_compras
    }
  }
  const aggregated = Array.from(agg.values())
  console.log(`   ${records.length} linhas → ${aggregated.length} após agregação`)
  await upsertBatch(supabase, 'meta_ads', aggregated, ['data', 'ad_id'])
}

// ─── Import: Transações ───────────────────────────────────────────────────────

async function importTransacoes(sheets) {
  console.log('\n💰 Buscando Transações...')
  const rows = await fetchRange(sheets, "'TODAS AS TRANSAÇÕES'!A1:AM3000")
  if (rows.length < 2) { console.log('   Sem dados'); return }

  const h = {}
  rows[0].forEach((col, i) => { h[col.trim()] = i })

  const c = (row, key, fallback = -1) => {
    const idx = h[key] ?? fallback
    return idx >= 0 ? (row[idx] ?? '') : ''
  }

  const records = []
  for (const row of rows.slice(1)) {
    const data = parseDate(c(row, 'Data'))
    const hotmartId = c(row, 'ID')
    if (!data) continue

    const valorBruto = parseNum(c(row, 'Valor Bruto'))
    if (valorBruto <= 1) continue  // Exclui transações de teste R$1

    records.push({
      data,
      nome:                 c(row, 'Nome'),
      email:                c(row, 'E-mail').toLowerCase().trim(),
      produto:              c(row, 'Produto'),
      valor_bruto:          valorBruto,
      valor_liquido_expert: parseNum(c(row, 'Valor Líquido (Expert)')),
      valor_liquido_equipe:  parseNum(c(row, 'Valor Líquido Equipe')),
      forma_pagamento:      c(row, 'Forma de Pagamento'),
      parcelas:             parseIntSafe(c(row, 'Quantidade de parcelas')) || 1,
      criativo:             c(row, 'CRIATIVO_NORMALIZADO'),
      utm_medium_ultimo:    c(row, 'ÚLTIMO IMPACTO Utm_medium'),
      utm_source_ultimo:    c(row, 'ÚLTIMO IMPACTO utm_source'),
      utm_medium_primeiro:  c(row, 'PRIMEIRO IMPACTO Utm_medium'),
      utm_source_primeiro:  c(row, 'PRIMEIRO IMPACTO utm_source'),
      hotmart_id:           hotmartId || null,
    })
  }

  console.log(`   ${records.length} registros para inserir`)
  await upsertBatch(supabase, 'transacoes', records, ['hotmart_id'])
}

// ─── Import: Qualificação ─────────────────────────────────────────────────────

async function importQualificacao(sheets) {
  console.log('\n📋 Buscando Fichas de Qualificação...')
  const rows = await fetchRange(sheets, "'_Qualificação Compradores'!A1:AK800")
  if (rows.length < 2) { console.log('   Sem dados'); return }

  const h = {}
  rows[0].forEach((col, i) => { h[col.trim()] = i })

  const c = (row, key, fallback = -1) => {
    const idx = h[key] ?? fallback
    return idx >= 0 ? (row[idx] ?? '') : ''
  }

  const records = []
  for (const row of rows.slice(1)) {
    const email = c(row, 'email').toLowerCase().trim()
    if (!email) continue

    records.push({
      email,
      nome:                   c(row, 'nome'),
      data_primeira_compra:   parseDate(c(row, 'data_primeira_compra')),
      criativo:               c(row, 'criativo'),
      tipo_criativo:          c(row, 'tipo_criativo'),
      utm_medium_ultimo:      c(row, 'utm_medium_ultimo'),
      utm_source_ultimo:      c(row, 'utm_source_ultimo'),
      utm_medium_primeiro:    c(row, 'utm_medium_primeiro'),
      utm_source_primeiro:    c(row, 'utm_source_primeiro'),
      comprou_calculadora:    parseBool(c(row, 'comprou_calculadora')),
      comprou_ob1_script:     parseBool(c(row, 'comprou_ob1_script')),
      comprou_ob2_tributario: parseBool(c(row, 'comprou_ob2_tributario')),
      comprou_ob3_dentista:   parseBool(c(row, 'comprou_ob3_dentista')),
      valor_bruto_total:      parseNum(c(row, 'valor_bruto_total')),
      forma_pagamento:        c(row, 'forma_pagamento'),
      parcelas:               parseIntSafe(c(row, 'parcelas')) || 1,
      tem_ficha:              parseBool(c(row, 'tem_ficha')),
      sexo:                   c(row, 'sexo'),
      faixa_etaria:           c(row, 'faixa_etaria'),
      faturamento_declarado:  c(row, 'faturamento_declarado'),
      quanto_sobra:           c(row, 'quanto_sobra'),
      valor_sonho:            c(row, 'valor_sonho'),
      voce_e:                 c(row, 'voce_e'),
      especialidade:          c(row, 'especialidade'),
      tempo_odontologia:      c(row, 'tempo_odontologia'),
      maior_dificuldade:      c(row, 'maior_dificuldade'),
      medos:                  c(row, 'medos'),
      objetivos:              c(row, 'objetivos'),
      emocao_fim_mes:         c(row, 'emocao_fim_mes'),
      tentou_antes:           c(row, 'tentou_antes'),
      por_que_nao_funcionou:  c(row, 'por_que_nao_funcionou'),
      como_conheceu:          c(row, 'como_conheceu'),
      qualificacao:           c(row, 'qualificacao') || 'Sem ficha',
      aluno_mentoria:         parseBool(c(row, 'aluno_mentoria')),
    })
  }

  console.log(`   ${records.length} registros para inserir`)
  await upsertBatch(supabase, 'qualificacao', records, ['email'])
}

// ─── Batch upsert ─────────────────────────────────────────────────────────────

async function upsertBatch(client, table, records, onConflict) {
  const BATCH = 500
  let inserted = 0
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)
    const { error } = await client
      .from(table)
      .upsert(batch, { onConflict: onConflict.join(','), ignoreDuplicates: false })
    if (error) {
      console.error(`   ❌ Erro no batch ${i}-${i + BATCH}:`, error.message)
    } else {
      inserted += batch.length
      process.stdout.write(`\r   ✅ ${inserted}/${records.length} inseridos`)
    }
  }
  console.log('')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Iniciando importação histórica: Google Sheets → Supabase')
  console.log(`   Planilha: ${SPREADSHEET_ID}`)
  console.log(`   Supabase: ${process.env.SUPABASE_URL}`)

  const sheets = await getSheets()

  await importMetaAds(sheets)
  await importTransacoes(sheets)
  await importQualificacao(sheets)

  console.log('\n✅ Importação concluída!')
}

main().catch((err) => { console.error('❌ Erro fatal:', err); process.exit(1) })
