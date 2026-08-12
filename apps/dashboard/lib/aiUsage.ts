/**
 * Quota counter per user/day. Persistido em ai_usage_daily.
 * Chave = (user_id, day UTC). Incremento atômico via RPC seria ideal, mas
 * fazemos read-modify-write com upsert — suficiente porque o reset é diário e
 * uma race condition vaza no máximo 1-2 perguntas.
 */
import { createClient } from '@supabase/supabase-js'

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface AiUsage {
  count: number
  day: string
}

export async function incrementAndGetAiUsage(userId: string): Promise<AiUsage> {
  const day = utcDay()
  const sb = getClient()
  const { data: existing } = await sb
    .from('ai_usage_daily')
    .select('count')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle() as { data: { count: number } | null }

  const next = (existing?.count ?? 0) + 1
  await sb
    .from('ai_usage_daily')
    .upsert({
      user_id: userId,
      day,
      count: next,
      last_at: new Date().toISOString(),
    }, { onConflict: 'user_id,day' })

  return { count: next, day }
}

export async function getAiUsage(userId: string): Promise<AiUsage> {
  const day = utcDay()
  const sb = getClient()
  const { data } = await sb
    .from('ai_usage_daily')
    .select('count')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle() as { data: { count: number } | null }
  return { count: data?.count ?? 0, day }
}
