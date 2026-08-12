import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=')
      const k = l.slice(0, i)
      const v = l.slice(i + 1).replace(/^"(.*)"$/, '$1')
      return [k, v]
    })
)
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data, error } = await sb
  .from('meta_ads')
  .select('data, ad_id, ad_name, views_3seg, views_75pct, views_95pct')
  .gte('data', '2026-05-23')
  .gt('views_3seg', 100)
  .order('views_3seg', { ascending: false })
  .limit(10)

if (error) { console.error('error:', error); process.exit(1) }
console.log('Body Rate (ads com views_3seg>100 nos últimos 3 dias):')
let totalRows = 0, withViews75 = 0
for (const r of data) {
  totalRows++
  if (r.views_75pct !== null && r.views_75pct > 0) withViews75++
  const body  = r.views_75pct && r.views_3seg ? ((r.views_75pct / r.views_3seg) * 100).toFixed(1) : 'n/a'
  const ret95 = r.views_95pct && r.views_3seg ? ((r.views_95pct / r.views_3seg) * 100).toFixed(1) : 'n/a'
  console.log(`  ${r.data} v3s=${r.views_3seg} v75=${r.views_75pct ?? 'null'} v95=${r.views_95pct}  body=${body}% ret95=${ret95}%  (${(r.ad_name ?? '?').slice(0, 50)})`)
}
console.log(`\n→ ${totalRows} linhas verificadas, ${withViews75} com views_75pct > 0`)
