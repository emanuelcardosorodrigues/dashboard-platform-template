#!/usr/bin/env tsx
/**
 * warm-ab-kv.ts — pré-aquece o KV cache do Worker A/B fazendo curls reais
 * em cada entry_path de experimento ativo. Cada hit força o Worker a popular
 * `experiment:{type}:{pathname}` no namespace AB_KV (b153fd66...).
 *
 * Rodar manualmente após Fase 1 do plano whimsical-seeking-lemon, ou em CI
 * pós-deploy do Worker. Usa SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY do .env.local.
 *
 * Uso:
 *   tsx scripts/warm-ab-kv.ts
 *   (lê variáveis do .env.local automaticamente se rodado via package.json)
 */

import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const WORKER_BASE = process.env.AB_WORKER_BASE ?? 'https://example.com/r'

if (!SUPA_URL || !SUPA_KEY) {
  console.error('Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })

async function main() {
  const { data: exps, error } = await supabase
    .from('experiments')
    .select('id, name, type, entry_path, status')
    .eq('status', 'active')

  if (error) throw error
  if (!exps || exps.length === 0) {
    console.log('Nenhum experimento ativo. Nada a aquecer.')
    return
  }

  // Deduplica por entry_path — um curl basta pra aquecer page+checkout+ob do mesmo path.
  const paths = Array.from(new Set(exps.map(e => e.entry_path)))
  console.log(`Aquecendo ${paths.length} path(s) distinto(s) para ${exps.length} experimento(s) ativo(s).`)

  for (const path of paths) {
    const cleanPath = path.replace(/^\//, '').replace(/\/$/, '')
    const url = `${WORKER_BASE}/${cleanPath}/`
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'warm-ab-kv/1.0 (internal)' },
      })
      console.log(`  ${url} → ${res.status}`)
    } catch (e) {
      console.error(`  ${url} → ERRO`, (e as Error).message)
    }
  }

  console.log('\nWarm-up concluído. Verifique com:')
  console.log('  CLOUDFLARE_ACCOUNT_ID=SEU_CLOUDFLARE_ACCOUNT_ID \\')
  console.log('    wrangler kv key list --namespace-id SEU_KV_NAMESPACE_ID --remote')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
