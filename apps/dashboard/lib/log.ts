/**
 * Wrapper enxuto sobre console.* que redacta PII antes de imprimir.
 * Use `log.info/warn/error/debug(msg, data?)` no lugar de `console.*` em qualquer
 * código que receba ou processe dado de usuário (webhook, login, ai, etc).
 *
 * Por que não logger externo: Vercel já agrega console.* via Runtime Logs e
 * o custo de um wrapper é zero; adicionar pino/winston é overhead pra ganho zero.
 */

const EMAIL_RE = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g
// CPF 11 dígitos: cobre 000.000.000-00 / 00000000000 / 000-000-000-00
const CPF_RE = /(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2})/g
// Telefone BR
const PHONE_RE = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\s?\d{4}-?\d{4}/g
// Bearer tokens, hex secrets de 24+ chars
const BEARER_RE = /Bearer\s+[\w._-]{8,}/gi
const HEX_SECRET_RE = /\b[a-f0-9]{32,}\b/gi

const SENSITIVE_KEY_RE = /(token|secret|key|password|authorization|cookie|session|auth|hottok|sck)$/i

function redactString(s: string): string {
  return s
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(CPF_RE, '[CPF]')
    .replace(PHONE_RE, '[PHONE]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(HEX_SECRET_RE, '[REDACTED]')
}

function redact(v: unknown, depth = 0): unknown {
  if (v == null) return v
  if (depth > 4) return '[…]'
  if (typeof v === 'string') return redactString(v)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map(x => redact(x, depth + 1))
  if (v instanceof Error) {
    return { name: v.name, message: redactString(v.message) }
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[REDACTED]'
      } else if (typeof val === 'string') {
        out[k] = redactString(val)
      } else {
        out[k] = redact(val, depth + 1)
      }
    }
    return out
  }
  return v
}

type Level = 'debug' | 'info' | 'warn' | 'error'

function emit(level: Level, msg: string, data?: unknown) {
  const safeMsg = redactString(msg)
  const safeData = data === undefined ? undefined : redact(data)
  const fn = level === 'debug' ? console.debug
    : level === 'info' ? console.log
    : level === 'warn' ? console.warn
    : console.error
  if (safeData === undefined) fn(safeMsg)
  else fn(safeMsg, safeData)
}

export const log = {
  debug: (msg: string, data?: unknown) => emit('debug', msg, data),
  info:  (msg: string, data?: unknown) => emit('info', msg, data),
  warn:  (msg: string, data?: unknown) => emit('warn', msg, data),
  error: (msg: string, data?: unknown) => emit('error', msg, data),
  redact,
  redactString,
}
