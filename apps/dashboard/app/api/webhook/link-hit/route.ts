/**
 * Beacon de clique do encurtador orgânico (workers/organic-links).
 *
 * O Worker no domínio do CLIENTE não guarda segredo nosso — ele só faz
 * fire-and-forget de POST {ws, slug} pra cá e nós incrementamos o contador.
 * Rota pública (proxy libera /api/webhook/); validação = par (ws, slug)
 * existir e estar ativo; resposta sempre 200 enxuta (não vaza existência).
 *
 * Anti-spam: rate-limit por LINK (ws, slug), não por IP — o Worker faz o POST
 * server-side, então o x-forwarded-for é o edge da Cloudflare (compartilhado
 * por muitos usuários), inútil como chave. Limitar por link bota um teto na
 * velocidade de inflação do contador (o dano real) sem cortar clique legítimo.
 * Teto grosseiro por design; precisão exigiria o Worker repassar CF-Connecting-IP.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { ws?: string; slug?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }
  const ws = String(body.ws ?? '')
  const slug = String(body.slug ?? '').slice(0, 80)
  if (!/^[0-9a-f-]{36}$/i.test(ws) || !slug) return NextResponse.json({ ok: true })

  // 300 cliques/min por link é folgado pra virais reais e corta flood patológico.
  // Bloqueio silencioso (mesmo {ok:true}) pra não vazar existência do link.
  const rl = await checkRateLimit(`link-hit:${ws}:${slug}`, 300, 60)
  if (!rl.allowed) return NextResponse.json({ ok: true })

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  // incremento atômico via RPC não existe pra isso — read-modify-write é
  // suficiente pro volume de cliques de bio (não é contador financeiro)
  const { data } = await supabase.from('organic_links')
    .select('id, clicks').eq('workspace_id', ws).eq('slug', slug).eq('active', true).maybeSingle()
  if (data) {
    await supabase.from('organic_links')
      .update({ clicks: ((data as { clicks: number }).clicks ?? 0) + 1 })
      .eq('id', (data as { id: string }).id)
  }
  return NextResponse.json({ ok: true })
}
