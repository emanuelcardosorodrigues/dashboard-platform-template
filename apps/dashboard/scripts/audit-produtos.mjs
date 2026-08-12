#!/usr/bin/env node
// Audita produtos reais do banco contra PRODUTO_RULES (Sprint Verdade Cristalina — Passo 0).
// Lista produtos distintos, classifica com produtoToTipo, e destaca os que caíram no fallback frontEnd.
//
// Uso: node scripts/audit-produtos.mjs

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key)

// Cópia do PRODUTO_RULES de lib/supabase.ts — mantém em sync manualmente.
const RULES = [
  // Upsell/downsell PLO — downsell antes (express é mais específico)
  { test: (p) => /implementa.*express.*lucro.*oculto/.test(p), tipo: 'downsell' },
  { test: (p) => /implementa.*lucro.*oculto/.test(p), tipo: 'upsell' },
  // Fronts
  { test: (p) => /calculadora.*dashboard-demo/.test(p), tipo: 'frontEnd' },
  { test: (p) => /protocolo.*lucro.*oculto/.test(p) && !/manual/.test(p), tipo: 'frontEnd' },
  { test: (p, isDpl) => /protocolo.*(dentista|parceiro)/.test(p) && isDpl, tipo: 'frontEnd' },
  { test: (p) => /protocolo.*(dentista|parceiro)/.test(p), tipo: 'ob3' },
  // OBs
  { test: (p) => /script.*anti.*desconto/.test(p), tipo: 'ob1' },
  { test: (p) => /(lucro )?tribut/.test(p), tipo: 'ob2' },
  { test: (p) => /manual.*lucro.*oculto/.test(p), tipo: 'ob4' },
]

function classify(produto, criativo = '') {
  const p = (produto || '').toLowerCase()
  const isDpl = /dpl[_-]/.test((criativo || '').toLowerCase())
  for (const r of RULES) if (r.test(p, isDpl)) return { tipo: r.tipo, matched: true }
  return { tipo: 'frontEnd', matched: false }
}

async function main() {
  console.log('→ Paginando transacoes (PostgREST default = 1000/req)...')
  const PAGE = 1000
  let from = 0
  const data = []
  while (true) {
    const { data: page, error } = await supabase
      .from('transacoes')
      .select('produto, criativo')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('Erro Supabase:', error.message)
      process.exit(1)
    }
    if (!page || page.length === 0) break
    data.push(...page)
    if (page.length < PAGE) break
    from += PAGE
    process.stdout.write(`\r  ${data.length} rows... `)
  }
  console.log(`\r  ${data.length} rows total       `)

  // Map produto → { count, sampleCriativos:Set, dpl:bool }
  const stats = new Map()
  for (const row of data ?? []) {
    const produto = (row.produto || '<sem produto>').trim()
    const criativo = (row.criativo || '').trim()
    const isDpl = /dpl[_-]/.test(criativo.toLowerCase())
    const key = `${produto}|${isDpl ? 'DPL' : 'OTHER'}`
    if (!stats.has(key)) stats.set(key, { produto, isDpl, count: 0, sampleCriativos: new Set() })
    const s = stats.get(key)
    s.count++
    if (s.sampleCriativos.size < 3 && criativo) s.sampleCriativos.add(criativo)
  }

  const rows = [...stats.values()]
    .map((s) => ({ ...s, ...classify(s.produto, s.isDpl ? 'dpl_audit' : '') }))
    .sort((a, b) => b.count - a.count)

  const total = rows.reduce((sum, r) => sum + r.count, 0)
  console.log(`\n✓ ${rows.length} (produto × funil) distintos, ${total} transações totais\n`)

  // Agregação por tipo
  const byTipo = {}
  for (const r of rows) {
    byTipo[r.tipo] = (byTipo[r.tipo] ?? 0) + r.count
  }
  console.log('Distribuição por tipo:')
  for (const [tipo, count] of Object.entries(byTipo).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / total) * 100).toFixed(1)
    console.log(`  ${tipo.padEnd(10)} ${String(count).padStart(6)}  (${pct}%)`)
  }
  console.log()

  // Tabela detalhada
  console.log('Detalhes (top 30):')
  console.log('─'.repeat(120))
  console.log(`${'Produto'.padEnd(50)} ${'Funil'.padEnd(7)} ${'Tipo'.padEnd(10)} ${'Match'.padEnd(7)} ${'Count'.padStart(6)}`)
  console.log('─'.repeat(120))
  for (const r of rows.slice(0, 30)) {
    const matchStr = r.matched ? '✓' : '⚠ FB'
    const produtoStr = r.produto.length > 48 ? r.produto.slice(0, 47) + '…' : r.produto
    console.log(
      `${produtoStr.padEnd(50)} ${(r.isDpl ? 'DPL' : 'OTHER').padEnd(7)} ${r.tipo.padEnd(10)} ${matchStr.padEnd(7)} ${String(r.count).padStart(6)}`
    )
  }
  console.log('─'.repeat(120))

  // Fallbacks
  const fallbacks = rows.filter((r) => !r.matched)
  if (fallbacks.length > 0) {
    console.log(`\n⚠ ${fallbacks.length} (produto × funil) caíram no fallback frontEnd (regras não cobrem):\n`)
    for (const f of fallbacks) {
      console.log(`  [${f.count}x] "${f.produto}" (${f.isDpl ? 'DPL' : 'OTHER'})`)
      if (f.sampleCriativos.size > 0) {
        console.log(`         criativos exemplo: ${[...f.sampleCriativos].slice(0, 3).join(', ')}`)
      }
    }
    console.log('\n→ Adicionar regra em lib/supabase.ts PRODUTO_RULES se algum desses NÃO for de fato frontEnd.')
  } else {
    console.log('\n✓ Todos os produtos foram classificados explicitamente por uma regra. Nenhum fallback.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
