/**
 * Cron: classifica comentários pendentes (sentiment + temas + is_question) com
 * vocabulário FIXO. Só-emoji é resolvido SEM IA (determinístico). O resto vai
 * em lotes de 25 ao Gemini (cadeia de fallback de lib/gemini.ts), com
 * sanitização ESTRITA — valor fora do vocabulário é descartado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { generateText } from '@/lib/gemini'
import { resolveWsParam } from '@/lib/organico/resolveWs'
import {
  COMENTARIOS_PROMPT, isValidSentimento, isValidTema, isEmojiOnly,
} from '@/lib/organico/taxonomiaComentarios'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_COMMENTS = 100
const BATCH = 25
const MAX_CALLS = 4

function db(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}
function authOk(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

interface PendingComment { id: string; text: string }

function buildPrompt(batch: PendingComment[]): string {
  return [
    'Classifique cada comentário de rede social abaixo. Responda APENAS um array JSON,',
    'um objeto por comentário, no formato {"id":"<id>","sentiment":"...","themes":["..."],"is_question":true|false}.',
    COMENTARIOS_PROMPT,
    'Não escreva nada fora do array JSON.',
    'COMENTÁRIOS:',
    ...batch.map((c) => `id=${c.id}: ${c.text.slice(0, 400).replace(/\n/g, ' ')}`),
  ].join('\n')
}

function parseAndSanitize(raw: string): Map<string, { sentiment: string | null; themes: string[]; is_question: boolean | null }> {
  const out = new Map<string, { sentiment: string | null; themes: string[]; is_question: boolean | null }>()
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return out
  let arr: unknown
  try { arr = JSON.parse(match[0]) } catch { return out }
  if (!Array.isArray(arr)) return out
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    if (!id) continue
    const sentiment = isValidSentimento(o.sentiment) ? o.sentiment : null
    const themes = Array.isArray(o.themes) ? o.themes.filter(isValidTema).slice(0, 2) : []
    const is_question = typeof o.is_question === 'boolean' ? o.is_question : null
    out.set(id, { sentiment, themes, is_question })
  }
  return out
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = db()
  const wsParam = new URL(req.url).searchParams.get('ws')
  const workspaceId = await resolveWsParam(wsParam)

  const { data: pending } = await supabase.from('organic_comments')
    .select('id, text').eq('workspace_id', workspaceId).is('analyzed_at', null)
    .limit(MAX_COMMENTS)
  const comments = (pending ?? []) as PendingComment[]
  if (comments.length === 0) return NextResponse.json({ analisados: 0 })

  const now = new Date().toISOString()
  let emojiCount = 0, iaCount = 0

  // 1) só-emoji: determinístico, sem token
  const toIA: PendingComment[] = []
  for (const c of comments) {
    if (isEmojiOnly(c.text)) {
      await supabase.from('organic_comments')
        .update({ sentiment: 'neutro', themes: ['emoji_apenas'], is_question: false, analyzed_at: now })
        .eq('id', c.id)
      emojiCount++
    } else {
      toIA.push(c)
    }
  }

  // 2) resto em lotes (máx MAX_CALLS chamadas/run)
  for (let i = 0, calls = 0; i < toIA.length && calls < MAX_CALLS; i += BATCH, calls++) {
    const batch = toIA.slice(i, i + BATCH)
    let result: Map<string, { sentiment: string | null; themes: string[]; is_question: boolean | null }>
    try {
      result = parseAndSanitize(await generateText(buildPrompt(batch)))
    } catch (e) {
      console.warn('[analyze-comments] IA falhou no lote:', (e as Error).message)
      break // cota esgotada → para; continua no próximo run
    }
    for (const c of batch) {
      const r = result.get(c.id)
      // marca analyzed_at mesmo sem resultado pra não reprocessar pra sempre;
      // só grava classificação quando veio algo válido
      await supabase.from('organic_comments').update({
        sentiment: r?.sentiment ?? null,
        themes: r?.themes ?? [],
        is_question: r?.is_question ?? null,
        analyzed_at: now,
      }).eq('id', c.id)
      if (r) iaCount++
    }
  }

  revalidateTag('sb-organico', 'max')
  return NextResponse.json({ analisados: emojiCount + iaCount, emoji: emojiCount, ia: iaCount, pendentes: comments.length })
}
