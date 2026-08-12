import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { log } from '@/lib/log'

let _sb: SupabaseClient | null = null
function sb(): SupabaseClient {
  if (_sb) return _sb
  _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  return _sb
}

interface RateLimitRow {
  allowed: boolean
  remaining: number
  reset_at: string
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date | null
}

const FAIL_OPEN: RateLimitResult = { allowed: true, remaining: -1, resetAt: null }

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const args = { p_key: key, p_limit: limit, p_window_seconds: windowSeconds }
    const { data, error } = await (sb().rpc as unknown as (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: RateLimitRow[] | RateLimitRow | null; error: { message: string } | null }>)(
      'check_rate_limit',
      args,
    )
    if (error) {
      log.warn('rateLimit.rpc.error', { key, message: error.message })
      return FAIL_OPEN
    }
    const row: RateLimitRow | null = Array.isArray(data) ? data[0] ?? null : data
    if (!row) return FAIL_OPEN
    return {
      allowed: !!row.allowed,
      remaining: typeof row.remaining === 'number' ? row.remaining : 0,
      resetAt: row.reset_at ? new Date(row.reset_at) : null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('rateLimit.exception', { key, message: msg })
    return FAIL_OPEN
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {}
  if (result.remaining >= 0) h['X-RateLimit-Remaining'] = String(result.remaining)
  if (result.resetAt) h['X-RateLimit-Reset'] = String(Math.floor(result.resetAt.getTime() / 1000))
  return h
}
