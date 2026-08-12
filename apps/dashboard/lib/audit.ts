/**
 * Audit log centralizado. Grava em public.audit_log via service-role.
 * Fire-and-forget: nunca bloqueia a request — falha de auditoria gera warn no
 * console, não erro pro user.
 *
 * IP é truncado (último octeto v4 / últimos 80 bits v6 zerados) por requisito
 * LGPD — não precisamos do IP completo pra reconstruir tentativa de ataque.
 * UA é simplified (apenas browser+major).
 */

import { createClient } from '@supabase/supabase-js'
import { log } from './log'

export type AuditStatus = 'ok' | 'denied' | 'error'
export type AuditRole = 'admin' | 'viewer' | null

export interface AuditEvent {
  action: string                  // ex: 'login.success', 'ai.ask.canary_leak'
  status?: AuditStatus            // default 'ok'
  actorRole?: AuditRole
  actorLabel?: string | null      // email_hash ou identificador (sem PII crua)
  ip?: string | null              // será truncado aqui
  userAgent?: string | null       // será simplified aqui
  resource?: string | null
  metadata?: Record<string, unknown>
  requestId?: string | null
}

function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  // IPv4: zera o último octeto. IPv6: zera os últimos 80 bits (últimos 5 grupos).
  if (ip.includes('.')) {
    const parts = ip.split('.')
    if (parts.length !== 4) return null
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`
  }
  if (ip.includes(':')) {
    const parts = ip.split(':').slice(0, 3)
    return `${parts.join(':')}::`
  }
  return null
}

function simplifyUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null
  // Captura "Chrome/127", "Firefox/130", "Safari/17", "Edg/127"
  const m = ua.match(/\b(Chrome|Firefox|Safari|Edg|OPR|SamsungBrowser)\/(\d+)/)
  if (m) return `${m[1]}/${m[2]}`
  // Bots conhecidos
  if (/\b(curl|wget|python-requests|node-fetch|go-http-client)\b/i.test(ua)) {
    return ua.slice(0, 40)
  }
  return 'unknown'
}

// Untyped client: a tabela audit_log não está no Database types gerado, então
// não vale a pena re-gerar só pra isso. O insert é diretamente em runtime.
type UntypedClient = ReturnType<typeof createClient<unknown>>
let _sb: UntypedClient | null = null
function getSupabase(): UntypedClient | null {
  if (_sb) return _sb
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _sb = createClient<unknown>(url, key, { auth: { persistSession: false } })
  return _sb
}

export async function audit(event: AuditEvent): Promise<void> {
  const sb = getSupabase()
  if (!sb) {
    log.warn('[audit] supabase env ausente, evento perdido', { action: event.action })
    return
  }
  try {
    const row = {
      actor_role: event.actorRole ?? null,
      actor_label: event.actorLabel ?? null,
      action: event.action,
      status: event.status ?? 'ok',
      ip: truncateIp(event.ip ?? null),
      user_agent: simplifyUserAgent(event.userAgent ?? null),
      resource: event.resource ?? null,
      metadata: event.metadata ?? {},
      request_id: event.requestId ?? null,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb.from('audit_log') as any).insert(row)
  } catch (err) {
    log.warn('[audit] falha ao gravar evento', { action: event.action, err })
  }
}
