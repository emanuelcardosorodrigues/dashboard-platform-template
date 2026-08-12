/**
 * Cron: classifica posts orgânicos (gancho g01–g46 + estrutura + tema) com a
 * taxonomia DEMO — mesma régua do criativo pago, pra responder "qual gancho /
 * estrutura / assunto dá mais certo" no orgânico. Base = title + caption.
 * Sanitização estrita; tema é o único campo semi-livre (normalizado).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { generateText } from '@/lib/gemini'
import { resolveWsParam } from '@/lib/organico/resolveWs'
import { isGanchoValido } from '@/lib/taxonomia-demo'
import { MECANISMOS_GANCHO } from '@/lib/taxonomia-demo'
import { ESTRUTURAS_POST, isValidEstrutura } from '@/lib/organico/taxonomiaComentarios'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BATCH = 10

function db(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}
function authOk(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

interface PendingPost { id: string; title: string | null; caption: string | null; transcricao: string | null }

function normalizeTema(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).slice(0, 3).join(' ')
  return t.length >= 2 ? t : null
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = db()
  const wsParam = new URL(req.url).searchParams.get('ws')
  const workspaceId = await resolveWsParam(wsParam)

  const { data: pending } = await supabase.from('organic_posts')
    .select('id, title, caption, transcricao').eq('workspace_id', workspaceId).is('gancho_codigo', null)
    .order('published_at', { ascending: false }).limit(BATCH)
  // base de classificação: TRANSCRIÇÃO (o que é falado) tem prioridade sobre
  // caption/título — muito mais preciso. A VPS zera gancho_codigo ao gravar a
  // transcrição, então o post é re-classificado aqui com o texto novo.
  const posts = ((pending ?? []) as PendingPost[]).filter((p) => (p.transcricao || p.title || p.caption))
  if (posts.length === 0) return NextResponse.json({ classificados: 0 })

  const prompt = [
    'Classifique cada post de rede social. Responda APENAS um array JSON, um objeto por post:',
    '{"id":"<id>","gancho":"g01..g46","estrutura":"...","tema":"..."}.',
    'GANCHO: código fixo g01–g46 (nunca invente; sem match use o mais próximo). Mecanismos de referência: ' +
      Object.entries(MECANISMOS_GANCHO).map(([s, n]) => `${s}=${n}`).join(', ') + '.',
    'ESTRUTURA: um de ' + ESTRUTURAS_POST.join(' | ') + '.',
    'TEMA: 1-3 palavras minúsculas (assunto principal).',
    'Não escreva nada fora do array JSON.',
    'POSTS:',
    ...posts.map((p) => `id=${p.id}: ${(p.transcricao ? p.transcricao : (p.title ? p.title + '. ' : '') + (p.caption ?? '')).slice(0, 1200).replace(/\n/g, ' ')}`),
  ].join('\n')

  let raw: string
  try {
    raw = await generateText(prompt)
  } catch (e) {
    return NextResponse.json({ classificados: 0, erro: (e as Error).message }, { status: 200 })
  }
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return NextResponse.json({ classificados: 0, erro: 'sem JSON' })
  let arr: unknown
  try { arr = JSON.parse(match[0]) } catch { return NextResponse.json({ classificados: 0, erro: 'JSON inválido' }) }
  if (!Array.isArray(arr)) return NextResponse.json({ classificados: 0 })

  let n = 0
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    if (!id || !posts.some((p) => p.id === id)) continue
    const gancho = typeof o.gancho === 'string' && isGanchoValido(o.gancho) ? o.gancho.trim().toLowerCase() : null
    const estrutura = isValidEstrutura(o.estrutura) ? o.estrutura : null
    const tema = normalizeTema(o.tema)
    // grava gancho mesmo se null? não — gancho_codigo NULL = "ainda não
    // classificado" e seria reprocessado. Usa placeholder 'g00'? Não existe.
    // Solução: se a IA não deu gancho válido, grava o tema/estrutura mas deixa
    // gancho_codigo com o mais próximo que ela tentou só se válido; senão usa
    // 'g01' evita? Não — preferimos marcar como classificado gravando ao menos
    // estrutura/tema e um gancho fallback explícito de "indefinido".
    await supabase.from('organic_posts').update({
      gancho_codigo: gancho ?? 'g00',
      estrutura, tema,
    }).eq('id', id).eq('workspace_id', workspaceId)
    n++
  }

  revalidateTag('sb-organico', 'max')
  return NextResponse.json({ classificados: n, lote: posts.length })
}
