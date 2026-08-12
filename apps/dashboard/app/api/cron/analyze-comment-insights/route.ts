/**
 * Cron: SÍNTESE qualitativa dos comentários (visão do todo, não 1-a-1). Lê uma
 * amostra dos comentários analisados do workspace e pede ao LLM (DeepInfra/Gemini,
 * cadeia de lib/gemini) os padrões AGREGADOS: dores, dificuldades OCULTAS,
 * oportunidades, desejos e dúvidas — cada um com evidência + freq aprox. Sanitiza
 * (só strings/ints), grava em organic_comment_insights e revalida o cache.
 * Determinístico fica nos fetchers (lib/organico/comentarios) — aqui é só a leitura.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { generateText } from '@/lib/gemini'
import { resolveWsParam } from '@/lib/organico/resolveWs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_COMMENTS = 250
const CATS = ['dores', 'dificuldades', 'oportunidades', 'desejos', 'duvidas'] as const

function db(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}
function authOk(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

function buildPrompt(comentarios: string[]): string {
  return [
    'Você é analista de audiência de um expert. Abaixo estão comentários reais do público nas redes.',
    'Extraia PADRÕES AGREGADOS (não repita comentário a comentário; sintetize o que se repete).',
    'Responda APENAS um objeto JSON válido (sem markdown, sem texto fora do JSON) com EXATAMENTE estas chaves,',
    'cada uma um array de objetos {"titulo": string curto, "evidencia": exemplo/citação curta, "freq": inteiro aprox}:',
    '{"dores":[],"dificuldades":[],"oportunidades":[],"desejos":[],"duvidas":[]}',
    'Significado: dores = o que dói/frustra o público; dificuldades = dificuldades OCULTAS (o que tentam e não',
    'conseguem, mesmo sem dizer direto); oportunidades = brechas de conteúdo/produto/oferta que os comentários revelam;',
    'desejos = o que mais querem/desejam; duvidas = dúvidas que mais se repetem.',
    'Máximo 6 itens por categoria, ordenados por relevância. NÃO invente — baseie-se nos comentários. Em português.',
    'COMENTÁRIOS:',
    ...comentarios.map((c, i) => `${i + 1}. ${c.slice(0, 220).replace(/\n/g, ' ')}`),
  ].join('\n')
}

interface Item { titulo: string; evidencia: string; freq: number | null }
function sanitize(raw: string): Record<string, Item[]> {
  const out: Record<string, Item[]> = { dores: [], dificuldades: [], oportunidades: [], desejos: [], duvidas: [] }
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return out
  let obj: unknown
  try { obj = JSON.parse(match[0]) } catch { return out }
  if (!obj || typeof obj !== 'object') return out
  const o = obj as Record<string, unknown>
  for (const cat of CATS) {
    const arr = Array.isArray(o[cat]) ? (o[cat] as unknown[]) : []
    out[cat] = arr
      .map((it): Item | null => {
        if (!it || typeof it !== 'object') return null
        const x = it as Record<string, unknown>
        const titulo = typeof x.titulo === 'string' ? x.titulo.trim().slice(0, 120) : ''
        if (!titulo) return null
        const evidencia = typeof x.evidencia === 'string' ? x.evidencia.trim().slice(0, 200) : ''
        const freq = typeof x.freq === 'number' && Number.isFinite(x.freq) ? Math.round(x.freq) : null
        return { titulo, evidencia, freq }
      })
      .filter((v): v is Item => v != null)
      .slice(0, 6)
  }
  return out
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = db()
  const workspaceId = await resolveWsParam(new URL(req.url).searchParams.get('ws'))

  // amostra: comentários analisados com texto relevante (>12 chars), mais recentes
  const { data } = await supabase.from('organic_comments')
    .select('text').eq('workspace_id', workspaceId).not('analyzed_at', 'is', null)
    .order('published_at', { ascending: false }).limit(1200)
  const comentarios = ((data ?? []) as Array<{ text: string | null }>)
    .map((r) => (r.text ?? '').trim())
    .filter((t) => t.length > 12)
    .slice(0, MAX_COMMENTS)

  if (comentarios.length < 5) {
    return NextResponse.json({ ok: true, amostra: comentarios.length, motivo: 'poucos comentários' })
  }

  let raw: string
  try {
    raw = await generateText(buildPrompt(comentarios))
  } catch (e) {
    return NextResponse.json({ erro: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 502 })
  }
  const insights = sanitize(raw)
  const totalItens = CATS.reduce((s, c) => s + insights[c].length, 0)

  await supabase.from('organic_comment_insights').upsert({
    workspace_id: workspaceId, computed_at: new Date().toISOString(), amostra: comentarios.length, insights,
  }, { onConflict: 'workspace_id' })
  revalidateTag('sb-organico-cinsights', 'max')

  return NextResponse.json({ ok: true, amostra: comentarios.length, itens: totalItens })
}
